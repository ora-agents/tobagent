"""Tests for Langfuse agent tracing configuration."""

import copy
from unittest.mock import Mock, patch

from src.utils.langfuse_tracing import (
    CopyableLangfuseCallbackHandler,
    get_langfuse_handler,
    langfuse_is_configured,
    with_langfuse_tracing,
)


def test_langfuse_is_configured_requires_both_keys(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    assert langfuse_is_configured() is False

    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")

    assert langfuse_is_configured() is True


def test_with_langfuse_tracing_binds_callback_and_graph_metadata():
    graph = Mock()
    configured_graph = Mock()
    graph.with_config.return_value = configured_graph
    handler = Mock()

    with patch(
        "src.utils.langfuse_tracing.get_langfuse_handler",
        return_value=handler,
    ):
        result = with_langfuse_tracing(graph, graph_name="generic_agent")

    assert result is configured_graph
    graph.with_config.assert_called_once_with(
        {
            "callbacks": [handler],
            "run_name": "generic_agent",
            "tags": ["agent", "generic_agent"],
            "metadata": {"graph": "generic_agent"},
        }
    )


def test_get_langfuse_handler_returns_none_without_credentials(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    get_langfuse_handler.cache_clear()

    assert get_langfuse_handler() is None


def test_langfuse_handler_can_be_deep_copied():
    handler = object.__new__(CopyableLangfuseCallbackHandler)
    copied_handler = Mock()

    with patch.object(
        CopyableLangfuseCallbackHandler,
        "__new__",
        return_value=copied_handler,
    ):
        copied = copy.deepcopy(handler)

    assert copied is copied_handler
