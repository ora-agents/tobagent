"""Dynamic system prompt, tool filtering, and model switching middleware.

Intercepts model requests and tool execution to support custom system prompts,
dynamic tools filtering, subagents routing/execution, and model switching.
"""
import asyncio
import logging
import re
import traceback
from typing import Any, Awaitable, Callable

from langchain.agents.middleware.types import AgentMiddleware, ToolCallRequest
from langchain_core.messages import SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, tool
from langchain_openai import ChatOpenAI
from langgraph.types import Command

from src.agent.config import (
    OPENAI_COMPATIBLE_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL,
)
from src.utils.db import AgentProfileTable, SessionLocal, SkillTable
from src.utils.mcp import McpPoolManager

logger = logging.getLogger(__name__)


def _extract_agent_data(agent_row: AgentProfileTable) -> dict:
    """Eagerly extract all needed attributes from an ORM row into a plain dict.

    This MUST be called while the DB session is still open to avoid
    DetachedInstanceError on lazy-loaded attributes.
    """
    system_prompt = getattr(agent_row, "system_prompt", "")
    enabled_tools = getattr(agent_row, "enabled_tools", None)
    agent_ids = getattr(agent_row, "agent_ids", None)
    skill_ids = getattr(agent_row, "skill_ids", None)

    return {
        "id": agent_row.id,
        "name": agent_row.name,
        "description": agent_row.description or "No description.",
        "system_prompt": system_prompt if isinstance(system_prompt, str) else "",
        "enabled_tools": list(enabled_tools) if isinstance(enabled_tools, list) else [],
        "agent_ids": list(agent_ids) if isinstance(agent_ids, list) else [],
        "skill_ids": list(skill_ids) if isinstance(skill_ids, list) else [],
    }


def _make_subagent_tool(
    agent_data: dict,
    tool_name: str,
    parent_model: str,
    parent_state_messages: list | None = None,
) -> BaseTool:
    """Create a dynamic ``call_agent_*`` tool that delegates to a subagent.

    Args:
        agent_data: Plain dict extracted from the ORM row (safe after session close).
        tool_name: The tool name the LLM will use to call this subagent.
        parent_model: Model name from the parent agent's context.
        parent_state_messages: Recent messages from the parent conversation for context.
    """
    # Capture only plain-Python values — no ORM objects.
    _id = agent_data["id"]
    _name = agent_data["name"]
    _description = agent_data["description"]
    _system_prompt = agent_data["system_prompt"]
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

        sub_configurable = {
            "system_prompt": _system_prompt,
            "enabled_tools": _enabled_tools,
            "agent_id": _id,
            "agent_ids": _agent_ids,
            "model": parent_model,
        }

        logger.info(
            "[DynamicConfigMiddleware] Executing subagent '%s' (id=%s) with query: %.80s...",
            _name, _id, query,
        )
        try:
            res = await generic_agent.ainvoke(
                {"messages": [("user", enriched_query)]},
                config={"configurable": sub_configurable},
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
    agent_ids_override: list[str] | None = None,
) -> dict[str, Any]:
    """Load agent-linked skills and subagents in a worker thread."""
    db = None
    try:
        db = SessionLocal()
        agent_profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id
        ).first()

        if not agent_profile:
            return {
                "found": False,
                "profile": None,
                "skills": [],
                "linked_agents": [],
                "linked_ids": [],
            }

        profile_data = _extract_agent_data(agent_profile)

        skill_rows = []
        if agent_profile.skill_ids:
            skill_rows = db.query(SkillTable).filter(
                SkillTable.id.in_(agent_profile.skill_ids)
            ).all()

        skills = [
            {
                "name": s.name,
                "description": s.description or "No description.",
            }
            for s in skill_rows
        ]

        linked_ids = (
            list(agent_ids_override)
            if agent_ids_override is not None
            else list(agent_profile.agent_ids or [])
        )
        linked_agent_rows = []
        if linked_ids:
            linked_agent_rows = db.query(AgentProfileTable).filter(
                AgentProfileTable.id.in_(linked_ids)
            ).all()

        return {
            "found": True,
            "profile": profile_data,
            "skills": skills,
            "linked_agents": [_extract_agent_data(a) for a in linked_agent_rows],
            "linked_ids": linked_ids,
        }
    finally:
        if db:
            db.close()


def _load_linked_agent_data(agent_id: str) -> list[dict[str, Any]]:
    """Load linked subagent data for cold-start dynamic tool execution."""
    db = None
    try:
        db = SessionLocal()
        agent_profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id
        ).first()

        if not agent_profile or not agent_profile.agent_ids:
            return []

        linked_agents = db.query(AgentProfileTable).filter(
            AgentProfileTable.id.in_(agent_profile.agent_ids)
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

    # Per-agent cache of dynamic subagent tools: {parent_agent_id: {tool_name: BaseTool}}
    # Populated in awrap_model_call, reused in awrap_tool_call to avoid
    # redundant DB queries and DetachedInstanceError.
    _tools_cache: dict[str, dict[str, BaseTool]] = {}

    async def awrap_model_call(self, request, handler):
        """Override system message, tool list, and model from runtime context."""
        ctx = request.runtime.context if request.runtime else None
        if ctx is None:
            return await handler(request)

        overrides = {}

        # Dynamic system prompt
        system_prompt = getattr(ctx, "system_prompt", "")
        agent_id = getattr(ctx, "agent_id", None)
        enabled_tools = getattr(ctx, "enabled_tools", None)
        linked_agent_tools: list[BaseTool] = []

        if agent_id and agent_id != "default":
            try:
                agent_ids_override = None
                if _context_field_was_set(ctx, "agent_ids"):
                    agent_ids_override = list(getattr(ctx, "agent_ids", []) or [])

                resources = await asyncio.to_thread(
                    _load_agent_runtime_resources,
                    agent_id,
                    agent_ids_override,
                )
                if resources["found"]:
                    profile = resources["profile"] or {}
                    if not _context_field_was_set(ctx, "system_prompt"):
                        system_prompt = profile.get("system_prompt", "") or system_prompt
                    if not _context_field_was_set(ctx, "enabled_tools"):
                        enabled_tools = profile.get("enabled_tools", [])

                    # ---- Linked skills ----
                    skills = resources["skills"]
                    if skills:
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

                            parent_model = getattr(ctx, "model", "") or ""
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
                                    parent_model=parent_model,
                                    parent_state_messages=parent_messages,
                                )
                                linked_agent_tools.append(dynamic_tool)
                                tools_for_agent[tool_name] = dynamic_tool

                            # Cache tools for awrap_tool_call reuse.
                            self._tools_cache[agent_id] = tools_for_agent
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
                    logger.warning(
                        "[DynamicConfigMiddleware] Agent profile not found in DB for agent_id='%s'.",
                        agent_id,
                    )
            except Exception as e:
                logger.warning(
                    "[DynamicConfigMiddleware] Failed to load resources for agent '%s': %s\n%s",
                    agent_id, e, traceback.format_exc(),
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

        if system_prompt:
            overrides["system_message"] = SystemMessage(content=system_prompt)

        # Tool filtering: only keep tools whose names appear in enabled_tools
        filtered = list(request.tools)
        if enabled_tools is not None:
            tool_set = set(enabled_tools)
            # Always allow read_skill so agents can dynamically query custom skills.
            tool_set.add("read_skill")
            filtered = [t for t in filtered if getattr(t, "name", "") in tool_set]

        # Inject the linked agent tools.
        if linked_agent_tools:
            filtered.extend(linked_agent_tools)

        # Dynamic MCP tools injection.
        if agent_id and agent_id != "default":
            try:
                mcp_tools = await McpPoolManager.get_tools_for_agent(agent_id)
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
        if model_name:
            overrides["model"] = ChatOpenAI(
                base_url=OPENAI_COMPATIBLE_BASE_URL or None,
                api_key=OPENAI_COMPATIBLE_API_KEY,
                model=model_name,
            )

        if overrides:
            request = request.override(**overrides)

        return await handler(request)

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        """Intercept and execute dynamically created subagent tools."""
        ctx = request.runtime.context if request.runtime else None
        agent_id = getattr(ctx, "agent_id", None)
        tool_name = request.tool_call.get("name", "")

        if agent_id and agent_id != "default" and tool_name.startswith("call_agent_"):
            # Fast path: reuse cached tool from awrap_model_call.
            cached_tools = self._tools_cache.get(agent_id, {})
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
                linked_agents_data = await asyncio.to_thread(_load_linked_agent_data, agent_id)
                if linked_agents_data:
                    parent_model = getattr(ctx, "model", "") or ""
                    parent_messages = list(request.state.get("messages", []))
                    tools_for_agent: dict[str, BaseTool] = {}

                    for agent_data in linked_agents_data:
                        clean_name = re.sub(r'[^a-zA-Z0-9_]', '_', agent_data["name"]).lower()
                        expected_name = f"call_agent_{clean_name}_{agent_data['id'][:4]}"

                        dynamic_tool = _make_subagent_tool(
                            agent_data=agent_data,
                            tool_name=expected_name,
                            parent_model=parent_model,
                            parent_state_messages=parent_messages,
                        )
                        tools_for_agent[expected_name] = dynamic_tool

                    # Populate cache for subsequent calls.
                    self._tools_cache[agent_id] = tools_for_agent

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

        # Fallback to standard execution path.
        return await handler(request)


# Instantiate the middleware so it can be imported directly
dynamic_config_middleware = DynamicConfigMiddleware()
