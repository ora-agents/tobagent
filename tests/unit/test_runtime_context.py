from types import SimpleNamespace

from langgraph.config import CONFIG_KEY_RUNTIME

from src.utils.runtime_context import get_runtime_context_value


def test_runtime_context_reads_legacy_configurable(monkeypatch):
    monkeypatch.setattr(
        "langgraph.config.get_config",
        lambda: {"configurable": {"agent_id": "agent-config"}},
    )

    assert get_runtime_context_value("agent_id", "default") == "agent-config"


def test_runtime_context_reads_context_schema_runtime(monkeypatch):
    runtime = SimpleNamespace(
        context=SimpleNamespace(agent_id="agent-context", user_id="user-1")
    )
    monkeypatch.setattr(
        "langgraph.config.get_config",
        lambda: {"configurable": {CONFIG_KEY_RUNTIME: runtime}},
    )

    assert get_runtime_context_value("agent_id", "default") == "agent-context"
    assert get_runtime_context_value("user_id", "") == "user-1"


def test_runtime_context_prefers_context_schema_over_legacy_configurable(monkeypatch):
    runtime = SimpleNamespace(context=SimpleNamespace(agent_id="agent-context"))
    monkeypatch.setattr(
        "langgraph.config.get_config",
        lambda: {
            "configurable": {
                CONFIG_KEY_RUNTIME: runtime,
                "agent_id": "agent-config",
            }
        },
    )

    assert get_runtime_context_value("agent_id", "default") == "agent-context"
