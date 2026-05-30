"""Authenticate and authorize LangGraph deployment requests."""
import os

from langgraph_sdk import Auth
from langgraph_sdk.auth import is_studio_user

auth = Auth()

MAX_RECURSION_LIMIT = 100
MAX_MESSAGE_CHARS = 50_000


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

    # Extract user identity from Authorization header
    authorization = _get_header(headers, "authorization")
    if not authorization:
        return {"identity": "studio-user", "kind": "StudioUser"}

    user_id = authorization
    if authorization.lower().startswith("bearer "):
        user_id = authorization.split(" ", 1)[1]

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
    if is_studio:
        user_dict["kind"] = "StudioUser"

    return user_dict


# Default block
@auth.on
async def block_all(ctx: Auth.types.AuthContext, value: dict):
    """Reject requests without a more specific auth handler."""
    if is_studio_user(ctx.user):
        return {}
    raise Auth.exceptions.HTTPException(403, "No access permitted")


@auth.on.threads
async def add_owner(ctx: Auth.types.AuthContext, value: dict):
    """Tag threads with their owner and restrict access."""
    if is_studio_user(ctx.user):
        return {}

    user_id = ctx.user.identity
    metadata = value.setdefault("metadata", {})
    metadata["user_id"] = user_id

    return {"user_id": user_id}


@auth.on.threads.update
async def update_owner_metadata(ctx: Auth.types.AuthContext, value: dict):
    """Allow users to update metadata only on their own threads."""
    if is_studio_user(ctx.user):
        return {}

    user_id = ctx.user.identity
    metadata = value.setdefault("metadata", {})
    metadata["user_id"] = user_id

    return {"user_id": user_id}


@auth.on.threads.create_run
async def enrich_run_metadata(
    ctx: Auth.types.AuthContext, value: Auth.types.RunsCreate
):
    """Inject public Chat LangChain metadata into the root run."""
    metadata = value.setdefault("metadata", {})

    config = value["kwargs"].get("config") or value.get("config") or {}
    config_metadata = config.get("metadata") if isinstance(config, dict) else None
    if isinstance(config_metadata, dict):
        config_source_type = config_metadata.get("source_type")
        if isinstance(config_source_type, str) and config_source_type:
            metadata.setdefault("source_type", config_source_type)

    metadata.setdefault("source_type", "Chat-LangChain")

    input_has_image = validate_inputs(
        value["kwargs"].get("input"), value["kwargs"].get("command")
    )
    validate_config(
        value["kwargs"].get("config") or value.get("config"),
        input_has_image=input_has_image,
    )


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


def validate_config(config: dict | None, *, input_has_image: bool = False):
    """Validate user-controlled run config before it reaches the graph."""
    if not config:
        return
    if not isinstance(config, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized config input: {type(config)}"
        )

    cap_recursion_limit(config)

    configurable = config.get("configurable") or {}
    if not isinstance(configurable, dict):
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized configurable input: {type(configurable)}"
        )

    requested_model = configurable.get("model")
    if requested_model is None:
        return
    if not isinstance(requested_model, str) or not requested_model.strip():
        raise Auth.exceptions.HTTPException(
            422, f"Unrecognized model input: {type(requested_model)}"
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
