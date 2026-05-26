"""Dynamic system prompt, tool filtering, and model switching middleware.

Uses wrap_model_call to intercept each model request and:
1. Replaces the system message with the one from the runtime context.
2. Filters tools to only those enabled in the context.
3. Swaps the model instance when ctx.model is set.

Note on why model override must happen here (not via ConfigurableField):
  create_agent calls request.model.bind_tools(...) before invoking the model.
  RunnableConfigurableFields delegates bind_tools via __getattr__ to the
  underlying default ChatOpenAI, which locks in the default model and discards
  the configurable wrapper. Overriding request.model in middleware runs *before*
  bind_tools is called, so the correct model is used from the start.
"""
import logging

from langchain.agents.middleware import wrap_model_call
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

from src.agent.config import (
    OPENAI_COMPATIBLE_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL,
)
from src.utils.db import AgentProfileTable, SessionLocal, SkillTable
from src.utils.mcp import McpPoolManager

logger = logging.getLogger(__name__)


@wrap_model_call
async def dynamic_config_middleware(request, handler):
    """Override system message, tool list, and model from runtime context."""
    ctx = request.runtime.context if request.runtime else None
    if ctx is None:
        return await handler(request)

    overrides = {}

    # Dynamic system prompt
    system_prompt = getattr(ctx, "system_prompt", "")
    agent_id = getattr(ctx, "agent_id", None)

    if agent_id and agent_id != "default":
        try:
            db = SessionLocal()
            try:
                agent_profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == agent_id).first()
                if agent_profile and agent_profile.skill_ids:
                    skills = db.query(SkillTable).filter(SkillTable.id.in_(agent_profile.skill_ids)).all()
                    if skills:
                        skills_instructions = (
                            "\n\nYou have access to the following custom skills. "
                            "The full details and instructions of these skills are provided below. "
                            "You MUST follow their instructions, constraints, and workflows when the user's request matches their scope.\n"
                            "Linked Skills:\n"
                        )
                        for s in skills:
                            skills_instructions += (
                                f"\n--- SKILL: {s.name} ---\n"
                                f"{s.content.strip()}\n"
                                f"--- END OF SKILL: {s.name} ---\n"
                            )
                        
                        system_prompt += skills_instructions
            except Exception as inner_e:
                logger.error(f"Error querying skills for agent {agent_id} in middleware: {inner_e}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Failed to import/initialize db for agent {agent_id} skills check: {e}")

    if system_prompt:
        overrides["system_message"] = SystemMessage(content=system_prompt)

    # Tool filtering: only keep tools whose names appear in enabled_tools
    enabled = getattr(ctx, "enabled_tools", None)
    filtered = list(request.tools)
    if enabled is not None:
        tool_set = set(enabled)
        # Always allow read_skill tool so agents can dynamically query custom skills
        tool_set.add("read_skill")
        filtered = [t for t in filtered if getattr(t, "name", "") in tool_set]

    # Dynamic MCP tools injection
    agent_id = getattr(ctx, "agent_id", None)
    if agent_id and agent_id != "default":
        try:
            mcp_tools = await McpPoolManager.get_tools_for_agent(agent_id)
            if mcp_tools:
                # Add all MCP tools to filtered list so they are bound to the model
                filtered.extend(mcp_tools)
        except Exception as e:
            logger.error(f"Failed to dynamically load MCP tools for agent {agent_id}: {e}")

    if filtered != list(request.tools):
        overrides["tools"] = filtered

    # Model override: create a fresh ChatOpenAI with the requested model name.
    # We must set request.model here rather than relying on ConfigurableField because
    # create_agent calls bind_tools on the model *after* middleware runs, and
    # bind_tools on a RunnableConfigurableFields bypasses the configurable wrapper.
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
