"""Dynamic system prompt, tool filtering, and model switching middleware.

Intercepts model requests and tool execution to support custom system prompts,
dynamic tools filtering, subagents routing/execution, and model switching.
"""
import asyncio
import logging
import re
import traceback
from collections.abc import Awaitable, Callable
from time import monotonic
from typing import Any

from langchain.agents.middleware.types import AgentMiddleware, ToolCallRequest
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, tool
from langchain_openai import ChatOpenAI
from langgraph.types import Command
from sqlalchemy import or_, text

from src.agent.config import (
    OPENAI_COMPATIBLE_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL,
)
from src.tools.robot_control_tool import list_robot_points_for_prompt
from src.utils.db import (
    AgentProfileTable,
    FormTable,
    KnowledgeBaseTable,
    SessionLocal,
    SkillTable,
)
from src.utils.debug_logging import write_debug_event
from src.utils.mcp import McpPoolManager
from src.utils.runtime_context import get_runtime_context_value

logger = logging.getLogger(__name__)


def _extract_agent_data(agent_row: AgentProfileTable) -> dict:
    """Eagerly extract all needed attributes from an ORM row into a plain dict.

    This MUST be called while the DB session is still open to avoid
    DetachedInstanceError on lazy-loaded attributes.
    """
    system_prompt = getattr(agent_row, "system_prompt", "")
    enabled_tools = getattr(agent_row, "enabled_tools", None)
    agent_ids = getattr(agent_row, "agent_ids", None)
    form_ids = getattr(agent_row, "form_ids", None)
    knowledge_base_ids = getattr(agent_row, "knowledge_base_ids", None)
    skill_ids = getattr(agent_row, "skill_ids", None)
    model = getattr(agent_row, "model", None)
    persona_style = getattr(agent_row, "persona_style", None)
    boundary_mode = getattr(agent_row, "boundary_mode", None)
    role_template_id = getattr(agent_row, "role_template_id", None)
    updated_at = getattr(agent_row, "updated_at", None)

    return {
        "id": agent_row.id,
        "name": agent_row.name,
        "description": agent_row.description or "No description.",
        "system_prompt": system_prompt if isinstance(system_prompt, str) else "",
        "model": model.strip() if isinstance(model, str) and model.strip() else "",
        "enabled_tools": list(enabled_tools) if isinstance(enabled_tools, list) else [],
        "agent_ids": list(agent_ids) if isinstance(agent_ids, list) else [],
        "form_ids": list(form_ids) if isinstance(form_ids, list) else [],
        "knowledge_base_ids": list(knowledge_base_ids) if isinstance(knowledge_base_ids, list) else [],
        "skill_ids": list(skill_ids) if isinstance(skill_ids, list) else [],
        "role_template_id": role_template_id if isinstance(role_template_id, str) else "",
        "persona_style": persona_style if isinstance(persona_style, str) else "",
        "boundary_mode": boundary_mode if isinstance(boundary_mode, str) else "",
        "updated_at": updated_at if isinstance(updated_at, str) else "",
    }


def _role_behavior_instructions(profile: dict[str, Any]) -> str:
    """Build structured behavior guidance from role metadata."""
    persona_labels = {
        "professional": "Maintain a professional, precise tone.",
        "friendly": "Maintain a warm, approachable tone.",
        "efficient": "Be concise, action-oriented, and minimize unnecessary back-and-forth.",
        "patient": "Be patient, clear, and explain steps without rushing the user.",
    }
    boundary_labels = {
        "knowledge_only": (
            "Only answer using configured knowledge sources or explicitly provided context. "
            "If the answer is not available, say so and ask for more information or handoff."
        ),
        "business_only": (
            "Stay within the configured business workflow. Do not engage in unrelated small talk; "
            "briefly redirect the user back to the task."
        ),
        "open": (
            "Brief small talk is allowed, but keep the conversation focused on the user's task."
        ),
    }

    lines = []
    persona = persona_labels.get(profile.get("persona_style", ""))
    boundary = boundary_labels.get(profile.get("boundary_mode", ""))
    if persona:
        lines.append(f"Persona: {persona}")
    if boundary:
        lines.append(f"Boundary: {boundary}")
    if lines and profile.get("role_template_id"):
        lines.insert(0, f"Role template: {profile['role_template_id']}.")
    if not lines:
        return ""
    return "\n\n## Role Behavior\n" + "\n".join(f"- {line}" for line in lines) + "\n"


def _format_form_field_for_prompt(field: dict[str, Any]) -> str:
    """Format a form field definition for model-facing schema context."""
    field_id = str(field.get("id") or "").strip() or "unnamed"
    label = str(field.get("label") or "").strip() or field_id
    field_type = str(field.get("type") or "text").strip() or "text"
    required = "required" if bool(field.get("required")) else "optional"
    parts = [f"`{field_id}`", f"label: {label}", f"type: {field_type}", required]

    options = field.get("options")
    if isinstance(options, list):
        clean_options = [str(option) for option in options if str(option).strip()]
        if clean_options:
            parts.append(f"options: {', '.join(clean_options)}")

    return " - " + "; ".join(parts)


def _format_linked_forms_for_prompt(forms: list[dict[str, Any]]) -> str:
    """Build system prompt instructions for linked form names and schemas."""
    if not forms:
        return ""

    form_instructions = (
        "\n\nYou have access to structured form data through `query_form_data`. "
        "The linked form names and schemas are included below by default so you can "
        "choose the right `form_id`, `fields`, and filter fields without first listing forms. "
        "Use `query_form_data` when the user asks about records, rows, customers, orders, cases, "
        "or any data stored in the linked forms. You can pass `fields`, `q`, "
        "`filter_field`, `filter_value`, `filter_op`, `page`, and `page_size`.\n"
        "Linked Forms:\n"
    )
    for form in forms:
        fields = form.get("fields", [])
        category = str(form.get("category") or "").strip()
        category_suffix = f" [Type: {category}]" if category else ""
        form_instructions += (
            f"- **{form['name']}** (ID: `{form['id']}`): "
            f"{form['description']}{category_suffix}\n"
            "  Schema:\n"
        )
        if isinstance(fields, list) and fields:
            for field in fields:
                if isinstance(field, dict):
                    form_instructions += f"  {_format_form_field_for_prompt(field)}\n"
        else:
            form_instructions += "  - No custom fields configured.\n"
    return form_instructions


def _get_current_config_metadata() -> dict[str, Any]:
    """Return LangGraph run metadata from the active config."""
    try:
        from langgraph.config import get_config

        cfg = get_config()
    except Exception:
        return {}
    if not isinstance(cfg, dict):
        return {}

    metadata = cfg.get("metadata")
    if isinstance(metadata, dict):
        return metadata

    configurable = cfg.get("configurable")
    if isinstance(configurable, dict):
        metadata = configurable.get("metadata")
        if isinstance(metadata, dict):
            return metadata
    return {}


def _load_thread_owner_user_id(thread_id: str) -> str:
    """Return the authenticated owner stored on a LangGraph thread."""
    if not isinstance(thread_id, str) or not thread_id.strip():
        return ""

    try:
        db = SessionLocal()
        try:
            row = db.execute(
                text('SELECT user_id, metadata_json FROM "thread" WHERE thread_id = :thread_id'),
                {"thread_id": thread_id.strip()},
            ).first()
        finally:
            db.close()
    except Exception as err:
        write_debug_event(
            "middleware.thread_owner.lookup_error",
            thread_id=thread_id,
            error=str(err),
        )
        return ""

    if not row:
        write_debug_event("middleware.thread_owner.not_found", thread_id=thread_id)
        return ""

    user_id = row[0]
    if isinstance(user_id, str) and user_id.strip():
        return user_id.strip()

    metadata = row[1]
    if isinstance(metadata, dict):
        for key in ("user_id", "owner"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _resolve_owner_user_id(ctx: Any) -> tuple[str, dict[str, Any]]:
    """Resolve the authenticated resource owner for dynamic runtime resources."""
    context_user_id = getattr(ctx, "user_id", "") or ""
    fallback_user_id = get_runtime_context_value("user_id", "") or ""
    config_metadata = _get_current_config_metadata()
    thread_id = config_metadata.get("thread_id", "")
    thread_owner_user_id = ""
    if not context_user_id and not fallback_user_id and isinstance(thread_id, str):
        thread_owner_user_id = _load_thread_owner_user_id(thread_id)

    owner_user_id = context_user_id or fallback_user_id or thread_owner_user_id
    return owner_user_id, {
        "context_user_id": context_user_id,
        "fallback_user_id": fallback_user_id,
        "thread_id": thread_id,
        "thread_owner_user_id": thread_owner_user_id,
        "owner_user_id": owner_user_id,
    }


def _make_subagent_tool(
    agent_data: dict,
    tool_name: str,
    owner_user_id: str,
    parent_state_messages: list | None = None,
) -> BaseTool:
    """Create a dynamic ``call_agent_*`` tool that delegates to a subagent.

    Args:
        agent_data: Plain dict extracted from the ORM row (safe after session close).
        tool_name: The tool name the LLM will use to call this subagent.
        parent_state_messages: Recent messages from the parent conversation for context.
    """
    # Capture only plain-Python values — no ORM objects.
    _id = agent_data["id"]
    _name = agent_data["name"]
    _description = agent_data["description"]
    _system_prompt = agent_data["system_prompt"]
    _model = agent_data.get("model", "")
    _enabled_tools = agent_data["enabled_tools"]
    _agent_ids = agent_data["agent_ids"]

    # Serialise a lightweight summary of the parent conversation so the
    # subagent has context about what the user was discussing.
    context_lines: list[str] = []
    for msg in (parent_state_messages or [])[-10:]:
        msg_type = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", "")
        if isinstance(content, str) and content:
            context_lines.append(f"{msg_type}: {content[:300]}")
    parent_context = "\n".join(context_lines) if context_lines else ""

    tool_description = (
        f"Use this tool to delegate tasks or ask questions to the specialised agent "
        f"'{_name}'. Agent description: {_description} "
        f"Input query must be a clear, detailed message describing the task or question."
    )

    # NOTE: langchain_core.tools.tool accepts the name as the FIRST POSITIONAL arg
    # (name_or_callable). Using keyword `name=` raises TypeError in this version.
    @tool(tool_name, description=tool_description)
    async def call_agent(query: str) -> str:
        """Delegate a task to a specialised subagent."""
        from src.agent.generic_agent import generic_agent

        enriched_query = query
        if parent_context:
            enriched_query = (
                f"[Parent conversation context]\n{parent_context}\n\n"
                f"[Delegated task]\n{query}"
            )

        sub_context = {
            "system_prompt": _system_prompt,
            "enabled_tools": _enabled_tools,
            "agent_id": _id,
            "user_id": owner_user_id,
            "agent_ids": _agent_ids,
        }
        if _model:
            sub_context["model"] = _model

        logger.info(
            "[DynamicConfigMiddleware] Executing subagent '%s' (id=%s) with query: %.80s...",
            _name, _id, query,
        )
        try:
            res = await generic_agent.ainvoke(
                {"messages": [("user", enriched_query)]},
                context=sub_context,
                config={
                    "tags": ["subagent", f"subagent:{_id}"],
                    "metadata": {
                        "stream_scope": "subagent",
                        "parent_agent_id": agent_data.get("parent_agent_id", ""),
                        "subagent_id": _id,
                        "subagent_name": _name,
                    },
                    # Do not forward nested agent token streams to the parent
                    # run consumer. The parent still receives this tool's final
                    # string result and can produce the single user-facing reply.
                    "callbacks": [],
                },
            )
            messages = res.get("messages", [])
            if messages:
                result = messages[-1].content
                logger.info(
                    "[DynamicConfigMiddleware] Subagent '%s' returned %d chars.",
                    _name, len(str(result)),
                )
                return result
            return f"No response from agent {_name}."
        except Exception as err:
            logger.error(
                "[DynamicConfigMiddleware] Subagent '%s' execution failed: %s\n%s",
                _name, err, traceback.format_exc(),
            )
            return f"Error executing agent {_name}: {err}"

    return call_agent


def _context_field_was_set(ctx: Any, field_name: str) -> bool:
    """Return whether a LangGraph context field was explicitly provided."""
    if isinstance(ctx, dict):
        return field_name in ctx

    fields_set = getattr(ctx, "model_fields_set", None)
    if isinstance(fields_set, (set, frozenset)):
        return field_name in fields_set

    fields_set = getattr(ctx, "__fields_set__", None)
    if isinstance(fields_set, (set, frozenset)):
        return field_name in fields_set

    return False


def _load_agent_runtime_resources(
    agent_id: str,
    owner_user_id: str,
    agent_ids_override: list[str] | None = None,
) -> dict[str, Any]:
    """Load agent-linked skills and subagents in a worker thread."""
    db = None
    try:
        db = SessionLocal()
        agent_profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id,
            AgentProfileTable.owner_user_id == owner_user_id,
        ).first()

        if not agent_profile:
            return {
                "found": False,
                "profile": None,
                "skills": [],
                "knowledge_bases": [],
                "linked_agents": [],
                "forms": [],
                "linked_ids": [],
            }

        profile_data = _extract_agent_data(agent_profile)

        skill_rows = []
        if agent_profile.skill_ids:
            skill_rows = db.query(SkillTable).filter(
                SkillTable.id.in_(agent_profile.skill_ids),
                SkillTable.owner_user_id == owner_user_id,
            ).all()

        skills = [
            {
                "name": s.name,
                "description": s.description or "No description.",
            }
            for s in skill_rows
        ]

        knowledge_base_ids = list(agent_profile.knowledge_base_ids or [])
        knowledge_base_rows = []
        if knowledge_base_ids:
            knowledge_base_rows = db.query(KnowledgeBaseTable).filter(
                KnowledgeBaseTable.id.in_(knowledge_base_ids),
                or_(
                    KnowledgeBaseTable.owner_user_id == owner_user_id,
                    KnowledgeBaseTable.owner_user_id.is_(None),
                ),
            ).all()
            order = {kb_id: idx for idx, kb_id in enumerate(knowledge_base_ids)}
            knowledge_base_rows = sorted(
                knowledge_base_rows,
                key=lambda kb: order.get(kb.id, len(order)),
            )

        knowledge_bases = [
            {
                "id": kb.id,
                "name": kb.name,
                "description": kb.description or "No description.",
            }
            for kb in knowledge_base_rows
        ]

        form_ids = list(agent_profile.form_ids or [])
        form_rows = []
        if form_ids:
            form_rows = db.query(FormTable).filter(
                FormTable.id.in_(form_ids),
                FormTable.owner_user_id == owner_user_id,
            ).all()
            order = {form_id: idx for idx, form_id in enumerate(form_ids)}
            form_rows = sorted(form_rows, key=lambda form: order.get(form.id, len(order)))

        forms = [
            {
                "id": form.id,
                "name": form.name,
                "description": form.description or "No description.",
                "category": form.category or "",
                "fields": form.fields or [],
            }
            for form in form_rows
        ]

        linked_ids = (
            list(agent_ids_override)
            if agent_ids_override is not None
            else list(agent_profile.agent_ids or [])
        )
        linked_agent_rows = []
        if linked_ids:
            linked_agent_rows = db.query(AgentProfileTable).filter(
                AgentProfileTable.id.in_(linked_ids),
                AgentProfileTable.owner_user_id == owner_user_id,
            ).all()

        return {
            "found": True,
            "profile": profile_data,
            "skills": skills,
            "knowledge_bases": knowledge_bases,
            "forms": forms,
            "linked_agents": [_extract_agent_data(a) for a in linked_agent_rows],
            "linked_ids": linked_ids,
        }
    finally:
        if db:
            db.close()


def _load_linked_agent_data(agent_id: str, owner_user_id: str) -> list[dict[str, Any]]:
    """Load linked subagent data for cold-start dynamic tool execution."""
    db = None
    try:
        db = SessionLocal()
        agent_profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id,
            AgentProfileTable.owner_user_id == owner_user_id,
        ).first()

        if not agent_profile or not agent_profile.agent_ids:
            return []

        linked_agents = db.query(AgentProfileTable).filter(
            AgentProfileTable.id.in_(agent_profile.agent_ids),
            AgentProfileTable.owner_user_id == owner_user_id,
        ).all()
        return [_extract_agent_data(a) for a in linked_agents]
    finally:
        if db:
            db.close()


class DynamicConfigMiddleware(AgentMiddleware):
    """Middleware class handling dynamic agent configurations.

    Implements both awrap_model_call and awrap_tool_call to support dynamic
    subagents registration and runtime execution without graph compilation issues.
    """

    # Per-agent cache of dynamic subagent tools: {(owner_user_id, parent_agent_id): {tool_name: BaseTool}}
    # Populated in awrap_model_call, reused in awrap_tool_call to avoid
    # redundant DB queries and DetachedInstanceError.
    _tools_cache: dict[tuple[str, str], dict[str, BaseTool]] = {}
    _resources_cache: dict[
        tuple[str, str, tuple[str, ...] | None],
        tuple[dict[str, Any], float, str],
    ] = {}
    _RESOURCES_CACHE_TTL_SECONDS = 30

    @classmethod
    def clear_cache(
        cls,
        agent_id: str | None = None,
        owner_user_id: str | None = None,
    ) -> None:
        """Clear cached dynamic tools and profile resources."""
        if agent_id is None and owner_user_id is None:
            cls._tools_cache.clear()
            cls._resources_cache.clear()
            return

        tool_keys_to_delete = []
        for key in cls._tools_cache:
            key_owner_user_id, key_agent_id = key
            if owner_user_id is not None and key_owner_user_id != owner_user_id:
                continue
            if agent_id is not None and key_agent_id != agent_id:
                continue
            tool_keys_to_delete.append(key)

        for key in tool_keys_to_delete:
            cls._tools_cache.pop(key, None)

        resource_keys_to_delete = []
        for key in cls._resources_cache:
            key_owner_user_id, key_agent_id, _override = key
            if owner_user_id is not None and key_owner_user_id != owner_user_id:
                continue
            if agent_id is not None and key_agent_id != agent_id:
                continue
            resource_keys_to_delete.append(key)

        for key in resource_keys_to_delete:
            cls._resources_cache.pop(key, None)

    async def _load_runtime_resources_cached(
        self,
        agent_id: str,
        owner_user_id: str,
        agent_ids_override: list[str] | None,
    ) -> dict[str, Any]:
        """Load dynamic runtime resources with a short per-process cache."""
        override_key = (
            tuple(agent_ids_override)
            if agent_ids_override is not None
            else None
        )
        cache_key = (owner_user_id, agent_id, override_key)
        now = monotonic()
        cached = self._resources_cache.get(cache_key)
        if cached and now - cached[1] < self._RESOURCES_CACHE_TTL_SECONDS:
            return cached[0]

        resources = await asyncio.to_thread(
            _load_agent_runtime_resources,
            agent_id,
            owner_user_id,
            agent_ids_override,
        )

        profile_updated_at = (resources.get("profile") or {}).get("updated_at", "")
        if resources.get("found") and isinstance(profile_updated_at, str) and profile_updated_at:
            self._resources_cache[cache_key] = (resources, now, profile_updated_at)
        return resources

    async def awrap_model_call(self, request, handler):
        """Override system message, tool list, and model from runtime context."""
        ctx = request.runtime.context if request.runtime else None
        if ctx is None:
            write_debug_event("middleware.model_call.skip", reason="missing_runtime_context")
            return await handler(request)

        overrides = {}

        # Dynamic system prompt
        system_prompt = getattr(ctx, "system_prompt", "")
        agent_id = getattr(ctx, "agent_id", None)
        owner_user_id, owner_resolution = _resolve_owner_user_id(ctx)
        enabled_tools = getattr(ctx, "enabled_tools", None)
        robot_environment = bool(getattr(ctx, "robot_environment", False))
        linked_agent_tools: list[BaseTool] = []
        has_linked_skills = False
        has_linked_forms = False

        write_debug_event(
            "middleware.model_call.context",
            agent_id=agent_id,
            **owner_resolution,
            system_prompt_set=_context_field_was_set(ctx, "system_prompt"),
            enabled_tools_set=_context_field_was_set(ctx, "enabled_tools"),
            agent_ids_set=_context_field_was_set(ctx, "agent_ids"),
            requested_model=getattr(ctx, "model", "") or "",
            robot_environment=robot_environment,
        )

        if agent_id and agent_id != "default" and owner_user_id:
            try:
                agent_ids_override = None
                if _context_field_was_set(ctx, "agent_ids"):
                    agent_ids_override = list(getattr(ctx, "agent_ids", []) or [])

                resources = await self._load_runtime_resources_cached(
                    agent_id,
                    owner_user_id,
                    agent_ids_override,
                )
                if resources["found"]:
                    profile = resources["profile"] or {}
                    write_debug_event(
                        "middleware.resources.loaded",
                        agent_id=agent_id,
                        owner_user_id=owner_user_id,
                        profile_name=profile.get("name", ""),
                        profile_enabled_tools=profile.get("enabled_tools", []),
                        profile_agent_ids=profile.get("agent_ids", []),
                        skills_count=len(resources.get("skills", [])),
                        linked_agents_count=len(resources.get("linked_agents", [])),
                        forms_count=len(resources.get("forms", [])),
                        linked_ids=resources.get("linked_ids", []),
                    )
                    if not _context_field_was_set(ctx, "system_prompt"):
                        system_prompt = profile.get("system_prompt", "") or system_prompt
                    if not _context_field_was_set(ctx, "enabled_tools"):
                        enabled_tools = profile.get("enabled_tools", [])
                    if not _context_field_was_set(ctx, "model") and profile.get("model"):
                        overrides["model"] = ChatOpenAI(
                            base_url=OPENAI_COMPATIBLE_BASE_URL or None,
                            api_key=OPENAI_COMPATIBLE_API_KEY,
                            model=profile["model"],
                        )
                    system_prompt += _role_behavior_instructions(profile)

                    # ---- Linked knowledge bases ----
                    knowledge_bases = resources.get("knowledge_bases", [])
                    if knowledge_bases:
                        kb_instructions = (
                            "\n\nYou have access to the following linked knowledge bases for `rag_search`. "
                            "When the user asks to search a specific knowledge base or the request clearly maps "
                            "to one listed below, pass its id in `knowledge_base_ids`. "
                            "Leave `knowledge_base_ids` empty when the request should search all linked knowledge bases.\n"
                            "Linked Knowledge Bases:\n"
                        )
                        for kb in knowledge_bases:
                            kb_instructions += (
                                f"- **{kb['name']}** (ID: `{kb['id']}`): {kb['description']}\n"
                            )
                        system_prompt += kb_instructions

                    # ---- Linked forms ----
                    forms = resources.get("forms", [])
                    if forms:
                        has_linked_forms = True
                        system_prompt += _format_linked_forms_for_prompt(forms)

                    # ---- Linked skills ----
                    skills = resources["skills"]
                    if skills:
                        has_linked_skills = True
                        skills_instructions = (
                            "\n\nYou have access to the following custom skills. "
                            "Only a summary (name + description) is listed below. "
                            "When the user's request matches a skill's scope, you MUST call the `read_skill` tool "
                            "with the skill's name to retrieve its full content and instructions before acting on it.\n"
                            "Linked Skills:\n"
                        )
                        for s in skills:
                            skills_instructions += (
                                f"- **{s['name']}**: {s['description']}\n"
                            )
                        skills_instructions += (
                            "\nUse `read_skill(skill_name=\"<name>\")` to load the full details of any skill above.\n"
                        )
                        system_prompt += skills_instructions

                    # ---- Linked subagents ----
                    linked_ids = resources["linked_ids"]
                    if linked_ids:
                        agents_data = resources["linked_agents"]

                        if agents_data:
                            logger.info(
                                "[DynamicConfigMiddleware] Agent '%s': found %d linked subagent(s): %s",
                                agent_id, len(agents_data),
                                [a["name"] for a in agents_data],
                            )

                            # Build system prompt instructions for the LLM.
                            agents_instructions = (
                                "\n\nYou are part of a multi-agent system and have access to the following "
                                "specialised subagents. When the user's request matches a subagent's description "
                                "or expertise, or when you need assistance in their domain, you MUST delegate the "
                                "task by calling the corresponding tool listed below. "
                                "Provide a detailed, self-contained query so the subagent can work independently.\n"
                                "Linked Subagents:\n"
                            )

                            parent_messages = list(request.state.get("messages", []))
                            tools_for_agent: dict[str, BaseTool] = {}

                            for agent_data in agents_data:
                                clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', agent_data["name"]).lower()
                                tool_name = f"call_agent_{clean_name}_{agent_data['id'][:4]}"

                                agents_instructions += (
                                    f"- **{agent_data['name']}** (Tool: `{tool_name}`): "
                                    f"{agent_data['description']}\n"
                                )

                                dynamic_tool = _make_subagent_tool(
                                    agent_data=agent_data,
                                    tool_name=tool_name,
                                    owner_user_id=owner_user_id,
                                    parent_state_messages=parent_messages,
                                )
                                linked_agent_tools.append(dynamic_tool)
                                tools_for_agent[tool_name] = dynamic_tool

                            # Cache tools for awrap_tool_call reuse.
                            self._tools_cache[(owner_user_id, agent_id)] = tools_for_agent
                            system_prompt += agents_instructions

                            logger.info(
                                "[DynamicConfigMiddleware] Agent '%s': injected %d subagent tool(s): %s",
                                agent_id, len(linked_agent_tools),
                                list(tools_for_agent.keys()),
                            )
                        else:
                            logger.info(
                                "[DynamicConfigMiddleware] Agent '%s': agent_ids=%s but no matching profiles found.",
                                agent_id, linked_ids,
                            )
                    else:
                        logger.info(
                            "[DynamicConfigMiddleware] Agent '%s': no agent_ids configured.",
                            agent_id,
                        )
                else:
                    write_debug_event(
                        "middleware.resources.not_found",
                        agent_id=agent_id,
                        owner_user_id=owner_user_id,
                    )
                    logger.warning(
                        "[DynamicConfigMiddleware] Agent profile not found in DB for agent_id='%s'.",
                        agent_id,
                    )
            except Exception as e:
                write_debug_event(
                    "middleware.resources.error",
                    agent_id=agent_id,
                    owner_user_id=owner_user_id,
                    error=str(e),
                )
                logger.warning(
                    "[DynamicConfigMiddleware] Failed to load resources for agent '%s': %s\n%s",
                    agent_id, e, traceback.format_exc(),
                )
        else:
            write_debug_event(
                "middleware.model_call.skip",
                reason="missing_agent_or_owner",
                agent_id=agent_id,
                owner_user_id=owner_user_id,
            )

        # ---- User preferences injection ----
        user_preferences = getattr(ctx, "user_preferences", "") or ""
        if user_preferences.strip():
            system_prompt += (
                "\n\n## User Preferences\n"
                "The current user has provided the following preferences and context "
                "that you should take into account when responding:\n"
                f"{user_preferences.strip()}\n"
            )

        # ---- Safety mode injection ----
        safety_enabled = getattr(ctx, "safety_enabled", False)
        if safety_enabled:
            system_prompt += (
                "\n\n## Safety Mode (Enabled)\n"
                "You MUST ask the user for explicit confirmation before executing any "
                "potentially dangerous, destructive, or irreversible actions. This includes "
                "but is not limited to: deleting files or data, sending emails or messages, "
                "modifying system configurations, executing shell commands that alter the "
                "filesystem, making API calls that change external state, or any action that "
                "cannot be easily undone. Describe the action you intend to take and its "
                "potential consequences, then wait for the user's explicit confirmation "
                "before proceeding.\n"
            )

        if robot_environment and enabled_tools and "navigate_robot_to_point" in enabled_tools:
            system_prompt += (
                "\n\n## Robot Environment\n"
                "The current conversation is running inside the robot Android WebView. "
                "You may call `navigate_robot_to_point(point_id=...)` only when the user asks "
                "the robot to move to a saved location. Available saved locations:\n"
                f"{list_robot_points_for_prompt()}\n"
            )

        if system_prompt:
            overrides["system_message"] = SystemMessage(content=system_prompt)

        # Tool filtering: only keep tools whose names appear in enabled_tools
        filtered = list(request.tools)
        if enabled_tools is not None:
            tool_set = set(enabled_tools)
            if has_linked_skills:
                # Allow linked skills to be loaded even when the saved profile's
                # enabled_tools predates the skills feature.
                tool_set.add("read_skill")
            else:
                tool_set.discard("read_skill")
            if has_linked_forms:
                tool_set.add("query_form_data")
            else:
                tool_set.discard("query_form_data")
            if not robot_environment:
                tool_set.discard("navigate_robot_to_point")
            filtered = [t for t in filtered if getattr(t, "name", "") in tool_set]

        # Inject the linked agent tools.
        if linked_agent_tools:
            filtered.extend(linked_agent_tools)

        # Dynamic MCP tools injection.
        if agent_id and agent_id != "default" and owner_user_id:
            try:
                mcp_tools = await McpPoolManager.get_tools_for_agent(agent_id, owner_user_id)
                if mcp_tools:
                    filtered.extend(mcp_tools)
            except Exception as e:
                logger.error(
                    "[DynamicConfigMiddleware] Failed to load MCP tools for agent '%s': %s",
                    agent_id, e,
                )

        if filtered != list(request.tools):
            overrides["tools"] = filtered

        # Model override.
        model_name = getattr(ctx, "model", None)
        if model_name and "model" not in overrides:
            overrides["model"] = ChatOpenAI(
                base_url=OPENAI_COMPATIBLE_BASE_URL or None,
                api_key=OPENAI_COMPATIBLE_API_KEY,
                model=model_name,
            )

        if overrides:
            write_debug_event(
                "middleware.model_call.overrides",
                agent_id=agent_id,
                owner_user_id=owner_user_id,
                override_keys=sorted(overrides.keys()),
                tool_names=[getattr(t, "name", "") for t in overrides.get("tools", [])],
                system_message_len=len(getattr(overrides.get("system_message"), "content", "") or ""),
            )
            request = request.override(**overrides)

        return await handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        """Intercept and execute dynamically created tools."""
        ctx = request.runtime.context if request.runtime else None
        agent_id = getattr(ctx, "agent_id", None)
        owner_user_id, owner_resolution = _resolve_owner_user_id(ctx)
        tool_name = request.tool_call.get("name", "")

        write_debug_event(
            "middleware.tool_call.context",
            agent_id=agent_id,
            tool_name=tool_name,
            **owner_resolution,
        )

        if agent_id and agent_id != "default" and owner_user_id and tool_name.startswith("call_agent_"):
            # Fast path: reuse cached tool from awrap_model_call.
            cached_tools = self._tools_cache.get((owner_user_id, agent_id), {})
            if tool_name in cached_tools:
                logger.info(
                    "[DynamicConfigMiddleware] Tool call '%s' matched in cache, executing.",
                    tool_name,
                )
                return await handler(request.override(tool=cached_tools[tool_name]))

            # Cold-start fallback: build the tool from DB if cache was empty.
            logger.info(
                "[DynamicConfigMiddleware] Tool call '%s' not in cache, loading from DB.",
                tool_name,
            )
            try:
                linked_agents_data = await asyncio.to_thread(
                    _load_linked_agent_data,
                    agent_id,
                    owner_user_id,
                )
                if linked_agents_data:
                    parent_messages = list(request.state.get("messages", []))
                    tools_for_agent: dict[str, BaseTool] = {}

                    for agent_data in linked_agents_data:
                        clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', agent_data["name"]).lower()
                        expected_name = f"call_agent_{clean_name}_{agent_data['id'][:4]}"

                        dynamic_tool = _make_subagent_tool(
                            agent_data=agent_data,
                            tool_name=expected_name,
                            owner_user_id=owner_user_id,
                            parent_state_messages=parent_messages,
                        )
                        tools_for_agent[expected_name] = dynamic_tool

                    # Populate cache for subsequent calls.
                    self._tools_cache[(owner_user_id, agent_id)] = tools_for_agent

                    if tool_name in tools_for_agent:
                        logger.info(
                            "[DynamicConfigMiddleware] Tool '%s' built from DB and cached.",
                            tool_name,
                        )
                        return await handler(request.override(tool=tools_for_agent[tool_name]))

                logger.warning(
                    "[DynamicConfigMiddleware] Tool '%s' not found for agent '%s'.",
                    tool_name, agent_id,
                )
            except Exception as e:
                logger.warning(
                    "[DynamicConfigMiddleware] Failed to resolve tool '%s' for agent '%s': %s\n%s",
                    tool_name, agent_id, e, traceback.format_exc(),
                )

        if agent_id and agent_id != "default" and owner_user_id:
            try:
                mcp_tools = await McpPoolManager.get_tools_for_agent(agent_id, owner_user_id)
                for mcp_tool in mcp_tools:
                    if getattr(mcp_tool, "name", "") == tool_name:
                        logger.info(
                            "[DynamicConfigMiddleware] Tool call '%s' matched MCP tools, executing.",
                            tool_name,
                        )
                        return await handler(request.override(tool=mcp_tool))
            except Exception as e:
                logger.warning(
                    "[DynamicConfigMiddleware] Failed to resolve MCP tool '%s' for agent '%s': %s\n%s",
                    tool_name, agent_id, e, traceback.format_exc(),
                )

        # Fallback to standard execution path.
        return await handler(request)


# Instantiate the middleware so it can be imported directly
dynamic_config_middleware = DynamicConfigMiddleware()
