"""Authenticate and authorize LangGraph deployment requests."""
import hashlib
import json
import os
from datetime import UTC, datetime

from langgraph_sdk import Auth
from langgraph_sdk.auth import is_studio_user

from src.utils.debug_logging import redact_secret, write_debug_event

auth = Auth()

MAX_RECURSION_LIMIT = 100
MAX_MESSAGE_CHARS = 50_000
ALLOWED_CONFIGURABLE_OVERRIDES = {
    "system_prompt",
    "enabled_tools",
    "agent_ids",
    "model",
}
ALLOWED_BUILTIN_TOOLS = {
    "rag_search",
    "fetch",
    "read_skill",
    "query_form_data",
    "manage_form_data",
    "navigate_robot_to_point",
}
GRAPH_ASSISTANT_IDS = {"generic_agent", "agent_builder"}
AGENT_ID_KEYS = ("agent_id", "agent_profile_id", "agentProfileId")


def _ensure_auth_value(value: dict | None) -> dict:
    """Return a mutable auth payload mapping."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized auth payload: {type(value)}"
        )
    return value


def _ensure_metadata(value: dict | None) -> dict:
    """Return a mutable metadata mapping from an auth payload."""
    payload = _ensure_auth_value(value)
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        payload["metadata"] = metadata
    return metadata


def _user_auth_source(user: object) -> str | None:
    """Return optional auth source carried by the authenticate callback."""
    if isinstance(user, dict):
        source = user.get("auth_source")
    else:
        source = getattr(user, "auth_source", None)
    return source if isinstance(source, str) else None


def _user_workspace_id(user: object) -> str | None:
    """Return optional workspace id carried by the authenticate callback."""
    if isinstance(user, dict):
        workspace_id = user.get("workspace_id")
    else:
        workspace_id = getattr(user, "workspace_id", None)
    return workspace_id if isinstance(workspace_id, str) and workspace_id.strip() else None


def _first_agent_id(*sources: dict | None) -> str | None:
    """Return the first non-empty agent profile id from request payload sources."""
    for source in sources:
        if not isinstance(source, dict):
            continue
        for key in AGENT_ID_KEYS:
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _assistant_id_as_agent_id(value: dict, kwargs: dict) -> str | None:
    """Treat a non-graph assistant id as an agent profile id fallback."""
    assistant_id = (
        value.get("assistant_id")
        or value.get("assistantId")
        or kwargs.get("assistant_id")
        or kwargs.get("assistantId")
    )
    if not isinstance(assistant_id, str) or not assistant_id.strip():
        return None
    assistant_id = assistant_id.strip()
    if assistant_id in GRAPH_ASSISTANT_IDS:
        return None
    return assistant_id


def _normalize_run_agent_context(value: dict, kwargs: dict, config: dict, context: dict) -> None:
    """Copy SDK-provided agent profile identity into runtime context."""
    if context.get("agent_id"):
        return

    config_metadata = config.get("metadata") if isinstance(config, dict) else None
    config_configurable = config.get("configurable") if isinstance(config, dict) else None
    kwargs_metadata = kwargs.get("metadata")
    value_metadata = value.get("metadata")

    agent_id = _first_agent_id(
        config_configurable,
        config_metadata,
        kwargs_metadata,
        value_metadata,
        kwargs,
        value,
    ) or _assistant_id_as_agent_id(value, kwargs)

    if agent_id:
        context["agent_id"] = agent_id


def _can_read_thread(thread_id: str, user_id: str) -> bool:
    """Return whether a user may read a thread or owned shared-agent record."""
    try:
        from sqlalchemy import text

        from src.utils.db import SessionLocal

        db = SessionLocal()
        try:
            row = db.execute(
                text('SELECT user_id, metadata_json FROM "thread" WHERE thread_id = :thread_id'),
                {"thread_id": thread_id},
            ).first()
        finally:
            db.close()
    except Exception:
        return False

    if not row:
        return False
    if row[0] == user_id:
        return True

    metadata = row[1]
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    if not isinstance(metadata, dict):
        return False

    return (
        metadata.get("shared_agent_owner_user_id") == user_id
        or metadata.get("shared_agent_viewer_user_id") == user_id
    )


def _inject_langfuse_metadata(
    *,
    ctx: Auth.types.AuthContext,
    value: dict,
    kwargs: dict,
    config: dict,
    context: dict,
) -> None:
    """Add authenticated Langfuse trace attributes to the run config."""
    config_metadata = config.get("metadata")
    if not isinstance(config_metadata, dict):
        config_metadata = {}
        config["metadata"] = config_metadata

    user_id = ctx.user.identity
    if isinstance(user_id, str) and user_id:
        config_metadata["langfuse_user_id"] = user_id

    thread_id = (
        kwargs.get("thread_id")
        or value.get("thread_id")
        or context.get("thread_id")
    )
    if isinstance(thread_id, str) and thread_id:
        config_metadata["langfuse_session_id"] = thread_id

    tags = config.get("tags")
    langfuse_tags = [str(tag) for tag in tags] if isinstance(tags, list) else []
    if "agent" not in langfuse_tags:
        langfuse_tags.append("agent")
    config_metadata["langfuse_tags"] = langfuse_tags


def _get_auth_secret() -> str | None:
    """Return optional auth secret for X-Auth-Key enforcement."""
    return os.getenv("LANGGRAPH_AUTH_SECRET")


def _get_header(headers: dict, name: str) -> str | None:
    """Return a request header from string or byte-keyed mappings."""
    target = name.lower()
    for key, value in headers.items():
        key_str = key.decode() if isinstance(key, bytes) else str(key)
        if key_str.lower() == target:
            return value.decode() if isinstance(value, bytes) else str(value)
    return None


def _hash_api_key(api_key: str) -> str:
    """Return stable digest for API key lookup."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _resolve_api_key_user_id(api_key: str) -> str | None:
    """Resolve a user-scoped API key to its owner user id."""
    try:
        from src.utils.db import SessionLocal, UserApiKeyTable

        db = SessionLocal()
        try:
            row = db.query(UserApiKeyTable).filter(
                UserApiKeyTable.key_hash == _hash_api_key(api_key),
            ).first()
            if not row:
                write_debug_event(
                    "auth.api_key_not_found",
                    api_key=redact_secret(api_key),
                )
                return None

            row.last_used_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            owner_user_id = row.owner_user_id
            db.commit()
            write_debug_event(
                "auth.api_key_resolved",
                api_key=redact_secret(api_key),
                owner_user_id=owner_user_id,
            )
            return owner_user_id
        finally:
            db.close()
    except Exception:
        write_debug_event(
            "auth.api_key_lookup_failed",
            api_key=redact_secret(api_key),
        )
        return None


@auth.authenticate
async def authenticate(headers: dict) -> Auth.types.MinimalUserDict:
    """Validate requests and extract user identity.

    If LANGGRAPH_AUTH_SECRET is set, requires X-Auth-Key header to match.
    If not set, allows public requests through.

    User identity is always extracted from Authorization: Bearer <user_id>.
    """
    # If auth secret is configured, validate X-Auth-Key header
    auth_secret = _get_auth_secret()
    if auth_secret:
        auth_key = _get_header(headers, "x-auth-key")
        if not auth_key:
            raise Auth.exceptions.HTTPException(
                status_code=401, detail="Authentication required"
            )
        if auth_key != auth_secret:
            raise Auth.exceptions.HTTPException(
                status_code=401, detail="Invalid auth key"
            )

    # Extract user identity from Authorization header. For compatibility with
    # existing browser sessions, Bearer user-... is still accepted as a session
    # identity. Other bearer values are treated as user-scoped API keys first.
    authorization = _get_header(headers, "authorization")
    if not authorization:
        return {"identity": "studio-user", "kind": "StudioUser"}

    user_id = authorization
    if authorization.lower().startswith("bearer "):
        user_id = authorization.split(" ", 1)[1]

    resolved_user_id = _resolve_api_key_user_id(user_id)
    if resolved_user_id:
        user_id = resolved_user_id

    # Detect if the request comes from LangGraph Studio
    is_studio = False
    if user_id == "studio-user" or (isinstance(user_id, str) and user_id.startswith("lsv2_")):
        is_studio = True
    else:
        # Check Origin and Referer headers (LangGraph Studio UI runs on smith.langchain.com)
        origin_str = _get_header(headers, "origin") or ""
        referer_str = _get_header(headers, "referer") or ""
        if "smith.langchain.com" in origin_str or "smith.langchain.com" in referer_str:
            is_studio = True

    user_dict: Auth.types.MinimalUserDict = {
        "identity": user_id or "anonymous",
        "is_authenticated": True,
    }
    if resolved_user_id:
        user_dict["auth_source"] = "api_key"
    workspace_id = _get_header(headers, "x-workspace-id")
    if workspace_id and workspace_id.strip():
        user_dict["workspace_id"] = workspace_id.strip()
    if is_studio:
        user_dict["kind"] = "StudioUser"

    write_debug_event(
        "auth.authenticate",
        identity=user_dict["identity"],
        is_studio=is_studio,
        resolved_api_key=bool(resolved_user_id),
        workspace_id=user_dict.get("workspace_id"),
    )
    return user_dict


# Default block
@auth.on
async def block_all(ctx: Auth.types.AuthContext, value: dict):
    """Reject requests without a more specific auth handler."""
    if is_studio_user(ctx.user):
        return {}
    raise Auth.exceptions.HTTPException(403, "No access permitted")


@auth.on.threads
async def add_owner(ctx: Auth.types.AuthContext, value: dict | None):
    """Tag threads with their owner and restrict access."""
    if _is_run_create_payload(value):
        return await _enrich_run_context(ctx, value)

    if is_studio_user(ctx.user):
        return {}

    user_id = ctx.user.identity
    metadata = _ensure_metadata(value)
    metadata["user_id"] = user_id
    if _user_auth_source(ctx.user) == "api_key":
        metadata.setdefault("source_type", "API Key")
        metadata["created_via_api_key"] = True

    return {"user_id": user_id}


@auth.on.threads.search
async def search_threads(ctx: Auth.types.AuthContext, value: dict | None):
    """Allow users to search own threads and shared-agent visitor records they own."""
    if is_studio_user(ctx.user):
        return {}

    user_id = ctx.user.identity
    metadata = value.get("metadata") if isinstance(value, dict) else None
    if isinstance(metadata, dict) and metadata.get("shared_agent_owner_user_id") == user_id:
        return {"metadata.shared_agent_owner_user_id": user_id}
    return {"user_id": user_id}


@auth.on.threads.read
async def read_thread(ctx: Auth.types.AuthContext, value: dict | None):
    """Allow reading own threads or visitor threads for an owned shared agent."""
    if is_studio_user(ctx.user):
        return {}

    thread_id = value.get("thread_id") if isinstance(value, dict) else None
    if not isinstance(thread_id, str) or not thread_id.strip():
        return {"user_id": ctx.user.identity}
    if _can_read_thread(thread_id.strip(), ctx.user.identity):
        return True
    raise Auth.exceptions.HTTPException(403, "Thread is not available for this user")


@auth.on.threads.update
async def update_owner_metadata(ctx: Auth.types.AuthContext, value: dict | None):
    """Allow users to update metadata only on their own threads."""
    if is_studio_user(ctx.user):
        return {}

    user_id = ctx.user.identity
    metadata = _ensure_metadata(value)
    metadata["user_id"] = user_id

    return {"user_id": user_id}


@auth.on.threads.create_run
async def enrich_run_metadata(
    ctx: Auth.types.AuthContext, value: Auth.types.RunsCreate
):
    """Inject public Chat LangChain metadata into the root run."""
    return await _enrich_run_context(ctx, value)


def _is_run_create_payload(value: dict | None) -> bool:
    """Return whether a threads auth payload is creating a run."""
    if not isinstance(value, dict):
        return False
    if isinstance(value.get("kwargs"), dict):
        return True
    if "assistant_id" in value and (
        "thread_id" in value or "input" in value or "command" in value
    ):
        return True
    return False


async def _enrich_run_context(
    ctx: Auth.types.AuthContext,
    value: Auth.types.RunsCreate | dict | None,
):
    """Validate a run payload and inject authenticated runtime context."""
    value = _ensure_auth_value(value)
    metadata = _ensure_metadata(value)

    kwargs = value.get("kwargs") or {}
    if not isinstance(kwargs, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized run kwargs: {type(kwargs)}"
        )
    value["kwargs"] = kwargs

    config = kwargs.get("config") or value.get("config") or {}
    context = kwargs.get("context") or value.get("context") or {}
    if not isinstance(context, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized context input: {type(context)}"
        )
    if not isinstance(config, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized config input: {type(config)}"
        )
    _normalize_run_agent_context(value, kwargs, config, context)
    write_debug_event(
        "auth.create_run.before_validate",
        identity=ctx.user.identity,
        is_studio=is_studio_user(ctx.user),
        context_agent_id=context.get("agent_id"),
        context_user_id=context.get("user_id"),
        config_has_configurable=isinstance(config.get("configurable"), dict),
        config_configurable_keys=sorted(config.get("configurable", {}).keys())
        if isinstance(config.get("configurable"), dict)
        else [],
    )
    config_metadata = config.get("metadata") if isinstance(config, dict) else None
    if isinstance(config_metadata, dict):
        config_source_type = config_metadata.get("source_type")
        if isinstance(config_source_type, str) and config_source_type:
            metadata.setdefault("source_type", config_source_type)
        config_conversation_source = config_metadata.get("conversation_source")
        if isinstance(config_conversation_source, str) and config_conversation_source:
            metadata.setdefault("conversation_source", config_conversation_source)

    if _user_auth_source(ctx.user) == "api_key":
        metadata.setdefault("source_type", "API Key")
        metadata["created_via_api_key"] = True
    else:
        metadata.setdefault("source_type", "Chat-LangChain")

    input_has_image = validate_inputs(
        kwargs.get("input"), kwargs.get("command")
    )
    validate_config(
        config,
        context=context,
        input_has_image=input_has_image,
        owner_user_id=None if is_studio_user(ctx.user) else ctx.user.identity,
        workspace_id=None if is_studio_user(ctx.user) else _user_workspace_id(ctx.user),
        require_agent_id=not is_studio_user(ctx.user),
    )
    _inject_langfuse_metadata(
        ctx=ctx,
        value=value,
        kwargs=kwargs,
        config=config,
        context=context,
    )
    write_debug_event(
        "auth.create_run.after_validate",
        identity=ctx.user.identity,
        context_agent_id=context.get("agent_id"),
        context_user_id=context.get("user_id"),
        context_keys=sorted(context.keys()),
        config_keys=sorted(config.keys()),
    )

    # Keep the validated payload in both locations used by LangGraph request
    # payloads so auth-injected fields reach the graph runtime.
    kwargs["config"] = config
    value["config"] = config
    kwargs["context"] = context
    value["context"] = context


@auth.on.assistants(actions=["create", "update", "delete"])
async def block_modify_assistants(
    ctx: Auth.types.AuthContext, value: Auth.types.AssistantsCreate
):
    """Block non-Studio users from modifying assistants."""
    if is_studio_user(ctx.user):
        return {}
    raise Auth.exceptions.HTTPException(403, "Modifying assistants is not allowed")


@auth.on.assistants.read
async def allow_read_assistants(
    ctx: Auth.types.AuthContext, value: Auth.types.AssistantsRead
):
    """Allow regular users to read public or owned assistants."""
    if is_studio_user(ctx.user):
        return {}

    # Allow regular users to read public assistants (such as the default global graph assistant)
    # or their own assistants without enforcing user_id restriction
    return {}


@auth.on.assistants.search
async def allow_search_assistants(
    ctx: Auth.types.AuthContext, value: dict
):
    """Allow regular users to search assistants."""
    if is_studio_user(ctx.user):
        return {}

    # Allow regular users to search for assistants
    return {}


def validate_inputs(input: dict | None, command: dict | None) -> bool:
    """Validate and normalize run input before it reaches the graph."""
    if command:
        raise Auth.exceptions.HTTPException(422, "Command not accepted")
    if input is None:
        raise Auth.exceptions.HTTPException(422, "Input is required")
    if not isinstance(input, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized input: {type(input)}"
        )
    if not input:
        raise Auth.exceptions.HTTPException(422, "Input is required")

    messages = input.get("messages")
    if messages is None:
        raise Auth.exceptions.HTTPException(422, "Messages are required")
    if isinstance(messages, str):
        if not messages.strip():
            raise Auth.exceptions.HTTPException(422, "Message content is required")
        input["messages"] = messages[:MAX_MESSAGE_CHARS]
        return False
    if not isinstance(messages, list):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized messages input: {type(messages)}"
        )
    if not messages:
        raise Auth.exceptions.HTTPException(422, "Messages are required")

    input_has_image = False
    last_role = None
    for index, msg in enumerate(messages):
        if isinstance(msg, str):
            if not msg.strip():
                raise Auth.exceptions.HTTPException(422, "Message content is required")
            messages[index] = msg[:MAX_MESSAGE_CHARS]
            last_role = "user"
            continue

        if not isinstance(msg, dict):
            raise Auth.exceptions.HTTPException(
                422, f"Unrecognized message input: {type(msg)}"
            )

        role = msg.get("role") or msg.get("type")
        if role not in ("user", "human", "assistant", "ai"):
            raise Auth.exceptions.HTTPException(
                422, f"Only user and assistant messages accepted. Got role {role}"
            )

        content = msg.get("content")
        if content is None:
            raise Auth.exceptions.HTTPException(422, "Message content is required")
        if isinstance(content, str) and not content.strip():
            raise Auth.exceptions.HTTPException(422, "Message content is required")
        if isinstance(content, list) and not content:
            raise Auth.exceptions.HTTPException(422, "Message content is required")

        msg["content"] = truncate_message_content(content)
        input_has_image = input_has_image or content_has_image(msg["content"])
        last_role = role

    if last_role not in ("user", "human"):
        raise Auth.exceptions.HTTPException(422, "Last message must be from user")

    return input_has_image


def truncate_message_content(content):
    """Trim user-provided text while preserving non-text content blocks."""
    if isinstance(content, str):
        return content[:MAX_MESSAGE_CHARS]

    if not isinstance(content, list):
        return content

    remaining = MAX_MESSAGE_CHARS
    truncated = []
    for block in content:
        if isinstance(block, str):
            text = block[:remaining]
            truncated.append(text)
            remaining -= len(text)
            continue

        if (
            isinstance(block, dict)
            and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        ):
            text = block["text"][:remaining]
            truncated.append({**block, "text": text})
            remaining -= len(text)
            continue

        truncated.append(block)

    return truncated


def content_has_image(content) -> bool:
    """Return whether message content contains an image block."""
    if not isinstance(content, list):
        return False

    for block in content:
        if not isinstance(block, dict):
            continue

        block_type = block.get("type")
        if block_type in ("image", "image_url"):
            return True

        mime_type = block.get("mime_type") or block.get("mimeType")
        if isinstance(mime_type, str) and mime_type.startswith("image/"):
            return True

        if "image_url" in block:
            return True

    return False


def validate_config(
    config: dict | None,
    *,
    context: dict | None = None,
    input_has_image: bool = False,
    owner_user_id: str | None = None,
    workspace_id: str | None = None,
    require_agent_id: bool = False,
):
    """Validate user-controlled run config before it reaches the graph."""
    if context is None:
        context = {}
    if not isinstance(context, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized context input: {type(context)}"
        )

    if not config:
        validate_agent_context(
            context,
            owner_user_id,
            workspace_id=workspace_id,
            require_agent_id=require_agent_id,
        )
        requested_model = context.get("model")
        if requested_model is not None and (
            not isinstance(requested_model, str) or not requested_model.strip()
        ):
            raise Auth.exceptions.HTTPException(
                422, f"Unrecognized model input: {type(requested_model)}"
            )
        return
    if not isinstance(config, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized config input: {type(config)}"
        )

    cap_recursion_limit(config)

    configurable = config.pop("configurable", None) or {}
    if not isinstance(configurable, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized configurable input: {type(configurable)}"
        )

    context.update(configurable)
    validate_agent_context(
        context,
        owner_user_id,
        workspace_id=workspace_id,
        require_agent_id=require_agent_id,
    )

    requested_model = context.get("model")
    if requested_model is None:
        return
    if not isinstance(requested_model, str) or not requested_model.strip():
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized model input: {type(requested_model)}"
        )


def validate_agent_context(
    configurable: dict,
    owner_user_id: str | None,
    *,
    workspace_id: str | None = None,
    require_agent_id: bool,
) -> None:
    """Validate required agent context and apply safe request overrides."""
    agent_id = configurable.get("agent_id")
    if require_agent_id and (not isinstance(agent_id, str) or not agent_id.strip()):
        raise Auth.exceptions.HTTPException(400, "context.agent_id is required")

    if not agent_id or not owner_user_id:
        return

    workspace_owner_user_id = _resolve_workspace_owner_user_id(owner_user_id, workspace_id)
    resource_owner_user_id = workspace_owner_user_id
    requested_agent_owner_user_id = configurable.get("agent_owner_user_id")
    share_token = configurable.get("share_token")
    if (
        isinstance(requested_agent_owner_user_id, str)
        and requested_agent_owner_user_id.strip()
        and requested_agent_owner_user_id.strip() != workspace_owner_user_id
    ):
        if not isinstance(share_token, str) or not share_token.strip():
            raise Auth.exceptions.HTTPException(403, "Shared agent token is required")
        agent_profile = _load_shared_agent_profile(
            agent_id,
            requested_agent_owner_user_id.strip(),
            share_token.strip(),
        )
        resource_owner_user_id = requested_agent_owner_user_id.strip()
    else:
        agent_profile = _load_workspace_agent_profile(
            agent_id,
            workspace_owner_user_id,
            workspace_id,
        )
    if not agent_profile:
        raise Auth.exceptions.HTTPException(403, "Agent is not available for this API key")

    configurable["user_id"] = resource_owner_user_id
    configurable["agent_owner_user_id"] = resource_owner_user_id
    if workspace_id:
        configurable["workspace_id"] = workspace_id

    overrides = configurable.pop("overrides", None)
    if overrides is None:
        return
    if not isinstance(overrides, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized overrides input: {type(overrides)}"
        )

    unknown = set(overrides) - ALLOWED_CONFIGURABLE_OVERRIDES
    if unknown:
        raise Auth.exceptions.HTTPException(
            422, f"Unsupported configurable override(s): {', '.join(sorted(unknown))}"
        )

    if "system_prompt" in overrides:
        system_prompt = overrides["system_prompt"]
        if not isinstance(system_prompt, str):
            raise Auth.exceptions.HTTPException(422, "system_prompt override must be a string")
        configurable["system_prompt"] = system_prompt

    if "enabled_tools" in overrides:
        enabled_tools = overrides["enabled_tools"]
        if not isinstance(enabled_tools, list) or not all(isinstance(t, str) for t in enabled_tools):
            raise Auth.exceptions.HTTPException(422, "enabled_tools override must be a string list")
        unknown_tools = set(enabled_tools) - ALLOWED_BUILTIN_TOOLS
        if unknown_tools:
            raise Auth.exceptions.HTTPException(
                403, f"Tool override contains unavailable tool(s): {', '.join(sorted(unknown_tools))}"
            )
        configurable["enabled_tools"] = enabled_tools

    if "agent_ids" in overrides:
        agent_ids = overrides["agent_ids"]
        if not isinstance(agent_ids, list) or not all(isinstance(a, str) for a in agent_ids):
            raise Auth.exceptions.HTTPException(422, "agent_ids override must be a string list")
        _require_owned_agent_ids(agent_ids, resource_owner_user_id)
        configurable["agent_ids"] = agent_ids

    if "model" in overrides:
        model = overrides["model"]
        if not isinstance(model, str) or not model.strip():
            raise Auth.exceptions.HTTPException(422, "model override must be a non-empty string")
        configurable["model"] = model


def _load_owned_agent_profile(agent_id: str, owner_user_id: str):
    """Return the agent profile if it belongs to the authenticated user."""
    try:
        from src.utils.db import AgentProfileTable, SessionLocal

        db = SessionLocal()
        try:
            return db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner_user_id,
            ).first()
        finally:
            db.close()
    except Exception as err:
        raise Auth.exceptions.HTTPException(500, f"Failed to validate agent ownership: {err}") from err


def _resolve_workspace_owner_user_id(user_id: str, workspace_id: str | None) -> str:
    """Return the resource owner for a workspace after verifying membership."""
    if not workspace_id:
        return user_id
    try:
        from src.utils.db import SessionLocal, WorkspaceMemberTable, WorkspaceTable

        db = SessionLocal()
        try:
            member = db.query(WorkspaceMemberTable).filter(
                WorkspaceMemberTable.workspace_id == workspace_id,
                WorkspaceMemberTable.user_id == user_id,
                WorkspaceMemberTable.status == "active",
            ).first()
            if not member:
                raise Auth.exceptions.HTTPException(403, "Workspace access denied")

            workspace = db.query(WorkspaceTable).filter(
                WorkspaceTable.id == workspace_id,
            ).first()
            if not workspace:
                raise Auth.exceptions.HTTPException(404, "Workspace not found")
            return workspace.owner_user_id
        finally:
            db.close()
    except Auth.exceptions.HTTPException:
        raise
    except Exception as err:
        raise Auth.exceptions.HTTPException(500, f"Failed to validate workspace access: {err}") from err


def _load_workspace_agent_profile(
    agent_id: str,
    owner_user_id: str,
    workspace_id: str | None,
):
    """Return an agent profile available in the selected workspace."""
    if not workspace_id:
        return _load_owned_agent_profile(agent_id, owner_user_id)
    try:
        from sqlalchemy import and_, or_

        from src.utils.assets_import import DEFAULT_AGENT_GRAPH_ID
        from src.utils.db import AgentProfileTable, SessionLocal

        db = SessionLocal()
        try:
            return db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner_user_id,
                or_(
                    AgentProfileTable.workspace_id == workspace_id,
                    and_(
                        AgentProfileTable.workspace_id.is_(None),
                        or_(
                            AgentProfileTable.graph_id.is_(None),
                            AgentProfileTable.graph_id != DEFAULT_AGENT_GRAPH_ID,
                        ),
                    ),
                ),
            ).first()
        finally:
            db.close()
    except Exception as err:
        raise Auth.exceptions.HTTPException(500, f"Failed to validate workspace agent: {err}") from err


def _load_shared_agent_profile(agent_id: str, owner_user_id: str, share_token: str):
    """Return an agent profile when a share token authorizes direct app use."""
    try:
        from src.utils.db import AgentProfileTable, AgentShareLinkTable, SessionLocal

        db = SessionLocal()
        try:
            share = db.query(AgentShareLinkTable).filter(
                AgentShareLinkTable.token == share_token,
                AgentShareLinkTable.owner_user_id == owner_user_id,
                AgentShareLinkTable.agent_profile_id == agent_id,
            ).first()
            if not share:
                return None
            return db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner_user_id,
            ).first()
        finally:
            db.close()
    except Exception as err:
        raise Auth.exceptions.HTTPException(500, f"Failed to validate shared agent: {err}") from err


def _require_owned_agent_ids(agent_ids: list[str], owner_user_id: str) -> None:
    """Require all linked subagent ids to belong to the API key owner."""
    unique_ids = list(dict.fromkeys(agent_ids or []))
    if not unique_ids:
        return
    try:
        from src.utils.db import AgentProfileTable, SessionLocal

        db = SessionLocal()
        try:
            count = db.query(AgentProfileTable).filter(
                AgentProfileTable.id.in_(unique_ids),
                AgentProfileTable.owner_user_id == owner_user_id,
            ).count()
        finally:
            db.close()
    except Exception as err:
        raise Auth.exceptions.HTTPException(500, f"Failed to validate linked agents: {err}") from err

    if count != len(unique_ids):
        raise Auth.exceptions.HTTPException(
            403, "agent_ids override contains agents outside this account"
        )


def cap_recursion_limit(config: dict):
    """Cap recursion limit to the deployment maximum."""
    recursion_limit = config.get("recursion_limit")
    if recursion_limit is None:
        return

    if isinstance(recursion_limit, bool) or not isinstance(recursion_limit, int):
        raise Auth.exceptions.HTTPException(
            422, "recursion_limit must be an integer"
        )

    if recursion_limit > MAX_RECURSION_LIMIT:
        config["recursion_limit"] = MAX_RECURSION_LIMIT
