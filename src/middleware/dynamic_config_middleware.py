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
from langchain.agents.middleware import wrap_model_call
from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

from src.agent.config import (
    OPENAI_COMPATIBLE_API_KEY,
    OPENAI_COMPATIBLE_BASE_URL,
    _base_model,
)


@wrap_model_call
async def dynamic_config_middleware(request, handler):
    """Override system message, tool list, and model from runtime context."""
    ctx = request.runtime.context if request.runtime else None
    if ctx is None:
        return await handler(request)

    overrides = {}

    # Dynamic system prompt
    if getattr(ctx, "system_prompt", None):
        overrides["system_message"] = SystemMessage(content=ctx.system_prompt)

    # Tool filtering: only keep tools whose names appear in enabled_tools
    enabled = getattr(ctx, "enabled_tools", None)
    if enabled is not None:
        tool_set = set(enabled)
        filtered = [t for t in request.tools if getattr(t, "name", "") in tool_set]
        if filtered:
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
