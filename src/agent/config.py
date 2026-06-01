"""Shared configuration for all agents, models, middleware, and API keys."""

import logging
import os
from dataclasses import dataclass

import dotenv
from langchain.agents.middleware import ModelFallbackMiddleware
from langchain_openai import ChatOpenAI

from src.middleware.retry_middleware import ModelRetryMiddleware
from src.middleware.tool_retry_middleware import ToolRetryMiddleware

dotenv.load_dotenv()

logger = logging.getLogger(__name__)

# =============================================================================
# OpenAI-compatible endpoint configuration
#
# Reads NEXT_PUBLIC_OPENAI_* so that a single set of env vars serves both
# the Next.js frontend and this backend — no duplicate config needed.
# =============================================================================

OPENAI_COMPATIBLE_BASE_URL = (
    os.getenv("NEXT_PUBLIC_OPENAI_BASE_URL", "").strip()
    or os.getenv("OPENAI_COMPATIBLE_BASE_URL", "").strip()  # legacy fallback
)
OPENAI_COMPATIBLE_API_KEY = (
    os.getenv("NEXT_PUBLIC_OPENAI_API_KEY", "").strip()
    or os.getenv("OPENAI_COMPATIBLE_API_KEY", "").strip()  # legacy fallback
    or os.getenv("OPENAI_API_KEY", "").strip()
    or "dummy"
)
_DEFAULT_MODEL_NAME = (
    os.getenv("NEXT_PUBLIC_OPENAI_DEFAULT_MODEL", "").strip()
    or os.getenv("OPENAI_COMPATIBLE_DEFAULT_MODEL", "gpt-4o").strip()  # legacy fallback
)
# Propagate to standard OpenAI env vars so init_chat_model and other
# OpenAI-based callers also use this endpoint.
if OPENAI_COMPATIBLE_BASE_URL:
    os.environ.setdefault("OPENAI_BASE_URL", OPENAI_COMPATIBLE_BASE_URL)
if OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_API_KEY != "dummy":
    os.environ.setdefault("OPENAI_API_KEY", OPENAI_COMPATIBLE_API_KEY)


@dataclass
class ModelConfig:
    """Display and provider identifiers for a chat model."""

    id: str    # model name passed to the API, e.g. "gpt-4o" or "llama3.2"
    name: str  # display name


# Default model (used by context-summary middleware)
# id uses "openai:" prefix so init_chat_model routes through ChatOpenAI,
# which will pick up OPENAI_BASE_URL if set.
DEFAULT_MODEL = ModelConfig(
    id=f"openai:{_DEFAULT_MODEL_NAME}",
    name=_DEFAULT_MODEL_NAME,
)

logger.info(f"OpenAI base URL: {OPENAI_COMPATIBLE_BASE_URL or '(standard OpenAI)'}")
logger.info(f"Default model: {DEFAULT_MODEL.name}")

# =============================================================================
# Model Initialization
# =============================================================================

MAX_RETRIES = int(os.getenv("MODEL_MAX_RETRIES", "2"))

# Primary chat model. Generic-agent per-request model selection is handled by
# context_schema-aware middleware rather than LangGraph configurable fields.
chat_model = ChatOpenAI(
    base_url=OPENAI_COMPATIBLE_BASE_URL or None,
    api_key=OPENAI_COMPATIBLE_API_KEY,
    model=_DEFAULT_MODEL_NAME,
)

logger.info(f"Chat model initialised (default: {_DEFAULT_MODEL_NAME})")

# =============================================================================
# Middleware
# =============================================================================

model_retry_middleware = ModelRetryMiddleware(max_retries=MAX_RETRIES)
tool_retry_middleware = ToolRetryMiddleware(max_attempts=3)

# Fallback to the same default model; real resilience comes from model_retry_middleware
model_fallback_middleware = ModelFallbackMiddleware(DEFAULT_MODEL.id)

# =============================================================================
# Exports
# =============================================================================

__all__ = [
    "DEFAULT_MODEL",
    "ModelConfig",
    "OPENAI_COMPATIBLE_BASE_URL",
    "OPENAI_COMPATIBLE_API_KEY",
    "_DEFAULT_MODEL_NAME",
    "chat_model",
    "model_retry_middleware",
    "tool_retry_middleware",
    "model_fallback_middleware",
    "MAX_RETRIES",
    "logger",
]
