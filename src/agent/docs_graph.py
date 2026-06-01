"""Docs agent for LangChain customer service with docs and knowledge base tools."""

import logging
import os

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langsmith import Client

from src.agent.config import (
    DEFAULT_MODEL,
    chat_model,
    model_retry_middleware,
    tool_retry_middleware,
)
from src.prompts.context_summary_prompt import context_summary_prompt
from src.prompts.docs_agent_prompt import docs_agent_prompt as _local_prompt
from src.tools.link_check_tools import check_links
from src.tools.mcp_tools import mcp_docs_tools
from src.tools.pricing_tools import fetch_langchain_pricing

# Set up logging for this module
logger = logging.getLogger(__name__)
logger.info("Docs agent module loaded")

_USE_LOCAL_PROMPTS = os.getenv("USE_LOCAL_PROMPTS", "").lower() in {
    "1",
    "true",
    "yes",
}
_USE_STAGING = (
    os.getenv("LANGSMITH_HOST_PROJECT_NAME") == "immanuel-chat-langchain-test"
    or os.getenv("LANGSMITH_ENV") == "dev"
)
_PROMPT_HUB_NAME = (
    "public-chat-langchain-test:staging"
    if _USE_STAGING
    else "public-chat-langchain-test:production"
)

if _USE_LOCAL_PROMPTS:
    docs_agent_prompt = _local_prompt
    prompt_commit = None
    prompt_source = "local:src/prompts/docs_agent_prompt.py"
    logger.info("Using local docs prompt because USE_LOCAL_PROMPTS is enabled")
else:
    _langsmith_client = Client()
    try:
        _prompt_template = _langsmith_client.pull_prompt(_PROMPT_HUB_NAME)
        docs_agent_prompt = _prompt_template.invoke({"messages": []}).messages[0].content
        prompt_commit = (_prompt_template.metadata or {}).get("lc_hub_commit_hash")
        prompt_source = f"hub:{_PROMPT_HUB_NAME}"
        logger.info(
            f"Loaded prompt from hub: {_PROMPT_HUB_NAME} @ {(prompt_commit or '')[:8]}"
        )
    except Exception:
        logger.warning(
            f"Failed to pull prompt from hub ({_PROMPT_HUB_NAME}), falling back to local file"
        )
        docs_agent_prompt = _local_prompt
        prompt_commit = None
        prompt_source = "local:src/prompts/docs_agent_prompt.py"

context_summary_middleware = SummarizationMiddleware(
    model=DEFAULT_MODEL.id,
    trigger=("tokens", 130_000),
    keep=("tokens", 30_000),
    summary_prompt=context_summary_prompt,
    trim_tokens_to_summarize=None,
)
logger.info(
    "Context summarization enabled at 130k tokens, preserving latest 30k tokens"
)

docs_agent_tools = [
    *mcp_docs_tools,
    fetch_langchain_pricing,
    check_links,
]

docs_agent_middleware = [
    context_summary_middleware,
    tool_retry_middleware,
    model_retry_middleware,
]

docs_agent = create_agent(
    model=chat_model,
    tools=docs_agent_tools,
    system_prompt=docs_agent_prompt,
    middleware=docs_agent_middleware,
)

_prompt_metadata: dict[str, str] = {
    "prompt_source": prompt_source,
}
if prompt_commit:
    _prompt_metadata["prompt_commit"] = prompt_commit
if _revision_id := os.environ.get("LANGCHAIN_REVISION_ID"):
    _prompt_metadata["LANGSMITH_AGENT_VERSION"] = _revision_id

docs_agent = docs_agent.with_config(metadata=_prompt_metadata)
docs_agent.tools = docs_agent_tools
docs_agent.middleware = docs_agent_middleware
