"""Helpers for reading LangGraph runtime context from tools."""

from typing import Any


def get_runtime_context_value(field_name: str, default: Any = None) -> Any:
    """Return a field from LangGraph runtime context or legacy configurable data."""
    try:
        from langgraph.config import CONFIG_KEY_RUNTIME, get_config

        cfg = get_config()
    except Exception:
        return default

    configurable = cfg.get("configurable", {}) if isinstance(cfg, dict) else {}
    runtime = configurable.get(CONFIG_KEY_RUNTIME) if isinstance(configurable, dict) else None
    context = getattr(runtime, "context", None)

    if isinstance(context, dict):
        value = context.get(field_name, default)
        if value is not None:
            return value

    if context is not None:
        value = getattr(context, field_name, default)
        if value is not None:
            return value

    if isinstance(configurable, dict) and field_name in configurable:
        return configurable.get(field_name, default)

    return default
