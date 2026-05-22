# Prompt provenance lookup for LangSmith trace metadata.

import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

_USE_LOCAL_PROMPTS = os.getenv("USE_LOCAL_PROMPTS", "").lower() in {
    "1",
    "true",
    "yes",
}
_USE_STAGING = (
    os.getenv("LANGSMITH_HOST_PROJECT_NAME") == "immanuel-chat-langchain-test"
    or os.getenv("LANGSMITH_ENV") == "dev"
)
_HUB_PROMPTS: dict[str, str] = {
    "docs_agent": (
        "public-chat-langchain-test:staging"
        if _USE_STAGING
        else "public-chat-langchain-test:production"
    ),
}


@lru_cache(maxsize=8)
def _resolve_hub_provenance(hub_name: str) -> tuple[str, str | None]:
    """Pull the hub prompt to get its current commit hash. Cached per process."""
    try:
        from langsmith import Client

        template = Client().pull_prompt(hub_name)
        commit = (template.metadata or {}).get("lc_hub_commit_hash")
        return f"hub:{hub_name}", commit
    except Exception as exc:
        logger.warning("Failed to resolve hub provenance for %s: %s", hub_name, exc)
        return f"hub:{hub_name}", None


def get_prompt_provenance(graph_id: str) -> dict[str, str]:
    """Return prompt provenance for a graph_id."""
    if _USE_LOCAL_PROMPTS and graph_id == "docs_agent":
        return {
            "prompt_source": "local:src/prompts/docs_agent_prompt.py",
        }

    if graph_id in _HUB_PROMPTS:
        source, commit = _resolve_hub_provenance(_HUB_PROMPTS[graph_id])
        provenance = {"prompt_source": source}
        if commit:
            provenance["prompt_commit"] = commit

        return provenance

    return {}
