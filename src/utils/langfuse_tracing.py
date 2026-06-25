"""Langfuse tracing helpers for LangChain and LangGraph agents."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from langfuse.langchain import CallbackHandler

logger = logging.getLogger(__name__)


class CopyableLangfuseCallbackHandler(CallbackHandler):
    """Create a fresh handler when Aegra deep-copies graph configuration."""

    def __deepcopy__(self, memo: dict[int, Any]) -> CopyableLangfuseCallbackHandler:
        """Return an independent callback handler for one graph execution."""
        copied = type(self)()
        memo[id(self)] = copied
        return copied


def langfuse_is_configured() -> bool:
    """Return whether the required Langfuse credentials are configured."""
    return bool(
        os.getenv("LANGFUSE_PUBLIC_KEY", "").strip()
        and os.getenv("LANGFUSE_SECRET_KEY", "").strip()
    )


@lru_cache(maxsize=1)
def get_langfuse_handler() -> CopyableLangfuseCallbackHandler | None:
    """Return the shared Langfuse callback handler when tracing is configured."""
    if not langfuse_is_configured():
        logger.warning(
            "Agent tracing disabled: LANGFUSE_PUBLIC_KEY and "
            "LANGFUSE_SECRET_KEY are required"
        )
        return None
    return CopyableLangfuseCallbackHandler()


def with_langfuse_tracing(graph: Any, *, graph_name: str) -> Any:
    """Bind Langfuse tracing callbacks and metadata to an agent graph."""
    handler = get_langfuse_handler()
    if handler is None:
        return graph

    logger.info("Langfuse agent tracing enabled: graph=%s", graph_name)
    return graph.with_config(
        {
            "callbacks": [handler],
            "run_name": graph_name,
            "tags": ["agent", graph_name],
            "metadata": {"graph": graph_name},
        }
    )
