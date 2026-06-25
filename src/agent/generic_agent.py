"""Generic agent using create_agent with context_schema.

The agent's system prompt and enabled tools are configured per-request
via the LangGraph runtime context:
    {
        "model": "gpt-4o",
        "system_prompt": "You are a helpful assistant.",
        "enabled_tools": ["rag_search", "fetch"],
        "agent_id": "<uuid>",   # used to scope the RAG knowledge base
    }
"""
import logging

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from pydantic import BaseModel, Field

from src.agent.config import (
    DEFAULT_MODEL,
    chat_model,
    model_retry_middleware,
    tool_retry_middleware,
)
from src.middleware.dynamic_config_middleware import dynamic_config_middleware
from src.prompts.context_summary_prompt import context_summary_prompt
from src.tools.fetch_tool import fetch
from src.tools.form_tool import ManageFormDataTool, QueryFormDataTool
from src.tools.rag_tool import RagSearchTool
from src.tools.robot_control_tool import navigate_robot_to_point
from src.tools.skill_tool import ReadSkillTool
from src.utils.langfuse_tracing import with_langfuse_tracing

logger = logging.getLogger(__name__)
logger.info("Generic agent module loaded")


# ---------------------------------------------------------------------------
# Context schema — fields passed via run context at runtime
# ---------------------------------------------------------------------------

class GenericAgentContext(BaseModel):
    """Runtime context for the generic agent.

    All fields are optional with sensible defaults so the agent works
    even when the frontend sends a partial config.
    """

    system_prompt: str = Field(
        default="You are a helpful assistant.",
        description="System prompt to use for this session.",
    )
    enabled_tools: list[str] = Field(
        default_factory=lambda: ["rag_search", "fetch", "read_skill"],
        description="Names of tools the agent may call.",
    )
    agent_id: str = Field(
        default="default",
        description="Unique agent ID; used to namespace the RAG knowledge base.",
    )
    user_id: str = Field(
        default="",
        description="Authenticated account ID used to scope user-owned resources.",
    )
    agent_ids: list[str] = Field(
        default_factory=list,
        description="List of other agent IDs linked to this agent.",
    )
    model: str = Field(
        default="",
        description="Model name to use; overrides the default when non-empty.",
    )
    user_preferences: str = Field(
        default="",
        description="User's general preferences injected into the system prompt.",
    )
    safety_enabled: bool = Field(
        default=False,
        description="When true, agent must confirm before executing dangerous actions.",
    )
    robot_environment: bool = Field(
        default=False,
        description="True when the current web client runs inside the robot Android WebView.",
    )


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

_rag_tool = RagSearchTool()
_read_skill_tool = ReadSkillTool()
_query_form_data_tool = QueryFormDataTool()
_manage_form_data_tool = ManageFormDataTool()
_all_tools = [
    _rag_tool,
    fetch,
    _read_skill_tool,
    _query_form_data_tool,
    _manage_form_data_tool,
    navigate_robot_to_point,
]
logger.info(f"Generic agent tools: {[t.name for t in _all_tools]}")

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

_context_summary_middleware = SummarizationMiddleware(
    model=DEFAULT_MODEL.id,
    trigger=("tokens", 130_000),
    keep=("tokens", 30_000),
    summary_prompt=context_summary_prompt,
    trim_tokens_to_summarize=None,
)

_middleware = [
    _context_summary_middleware,
    dynamic_config_middleware,
    tool_retry_middleware,
    model_retry_middleware,
]

# ---------------------------------------------------------------------------
# Agent graph
# ---------------------------------------------------------------------------

# system_prompt=None so dynamic_config_middleware controls the system message.
generic_agent = create_agent(
    model=chat_model,
    tools=_all_tools,
    system_prompt=None,
    middleware=_middleware,
    context_schema=GenericAgentContext,
)
generic_agent = with_langfuse_tracing(generic_agent, graph_name="generic_agent")

logger.info("Generic agent graph compiled")
