"""Runtime feature capability flags exposed to web clients."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from src.api.local_dev import is_local_dev_request
from src.api.sms_verification import aliyun_sms_is_configured
from src.utils.langfuse_tracing import langfuse_is_configured

router = APIRouter(prefix="/api/capabilities", tags=["system"])


class RuntimeModuleCapability(BaseModel):
    """One backend module that can be enabled by environment or runtime config."""

    enabled: bool
    category: str
    label: str
    description: str
    requiredEnv: list[str] = []
    optionalEnv: list[str] = []
    defaults: dict[str, Any] = {}


class RuntimeCapabilities(BaseModel):
    """Feature flags derived from backend environment configuration."""

    modules: dict[str, RuntimeModuleCapability]
    smsAuth: bool
    langfuseTracing: bool
    localDevBypass: bool = False


def _env_is_set(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _all_env_set(*names: str) -> bool:
    return all(_env_is_set(name) for name in names)


def _model_api_is_configured() -> bool:
    return _env_is_set("OPENAI_COMPATIBLE_API_KEY") or _env_is_set("OPENAI_API_KEY")


def _model_proxy_is_configured() -> bool:
    return _env_is_set("OPENAI_COMPATIBLE_BASE_URL") and _model_api_is_configured()


def _speaker_verification_enabled() -> bool:
    return os.getenv("VOICE_SPEAKER_VERIFICATION_ENABLED", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _kws_model_available() -> bool:
    return Path(os.getenv("KWS_MODEL_DIR", "./models/kws")).exists()


def _runtime_modules() -> dict[str, RuntimeModuleCapability]:
    sms_enabled = aliyun_sms_is_configured()
    langfuse_enabled = langfuse_is_configured()
    model_proxy_enabled = _model_proxy_is_configured()
    dashscope_enabled = _env_is_set("DASHSCOPE_API_KEY")

    return {
        "core.database": RuntimeModuleCapability(
            enabled=True,
            category="core",
            label="Database",
            description="Stores users, workspaces, agent profiles, forms, skills, MCP servers, and metadata. Falls back to local SQLite when PostgreSQL is not configured.",
            requiredEnv=[],
            optionalEnv=[
                "DATABASE_URL",
                "POSTGRES_USER",
                "POSTGRES_PASSWORD",
                "POSTGRES_DB",
                "POSTGRES_HOST",
                "POSTGRES_PORT",
            ],
            defaults={"sqlitePath": "./chat_langchain.db", "postgresPort": "5432"},
        ),
        "core.model": RuntimeModuleCapability(
            enabled=_model_api_is_configured(),
            category="core",
            label="OpenAI-compatible chat model",
            description="Powers the LangGraph agent runtime and context summarization.",
            requiredEnv=["OPENAI_COMPATIBLE_API_KEY"],
            optionalEnv=[
                "OPENAI_COMPATIBLE_BASE_URL",
                "OPENAI_COMPATIBLE_DEFAULT_MODEL",
                "MODEL_MAX_RETRIES",
            ],
            defaults={
                "baseUrl": "https://api.openai.com/v1",
                "defaultModel": "gpt-4o",
                "maxRetries": 2,
            },
        ),
        "core.cors": RuntimeModuleCapability(
            enabled=True,
            category="core",
            label="CORS",
            description="Controls which browser origins may call the backend API.",
            requiredEnv=[],
            optionalEnv=["CORS_ALLOW_ORIGINS", "ALLOWED_ORIGINS"],
            defaults={"localOrigins": ["http://localhost:3000", "http://127.0.0.1:3000"]},
        ),
        "auth.password": RuntimeModuleCapability(
            enabled=True,
            category="auth",
            label="Password authentication",
            description="Enables account registration, login, profile settings, and API keys.",
            requiredEnv=[],
            optionalEnv=["SESSION_JWT_SECRET", "SESSION_COOKIE_SECURE", "SESSION_COOKIE_DOMAIN"],
            defaults={"authSecretRequired": False},
        ),
        "auth.sms": RuntimeModuleCapability(
            enabled=sms_enabled,
            category="auth",
            label="Aliyun SMS verification",
            description="Enables SMS login, registration, password reset, phone binding, and form notification hooks.",
            requiredEnv=[
                "ALIYUN_SMS_TEMPLATE_CODE",
                "ALIYUN_ACCESS_KEY_ID",
                "ALIYUN_ACCESS_KEY_SECRET",
                "ALIYUN_SMS_SIGN_NAME",
            ],
            optionalEnv=[
                "ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE",
                "ALIYUN_SMS_FORM_HOOK_TEMPLATE_CODE",
                "SMS_HOOK_KEY",
                "SMS_DEV_LOG_CODE",
                "SMS_CODE_TTL_SECONDS",
                "SMS_RESEND_INTERVAL_SECONDS",
            ],
            defaults={"ttlSeconds": 300, "resendIntervalSeconds": 60},
        ),
        "models.proxy": RuntimeModuleCapability(
            enabled=model_proxy_enabled,
            category="models",
            label="Model list proxy",
            description="Proxies the OpenAI-compatible /models endpoint without exposing server-side API keys to the browser.",
            requiredEnv=["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY"],
            optionalEnv=["MODEL_LIST_CACHE_TTL_SECONDS"],
            defaults={"cacheTtlSeconds": 300},
        ),
        "knowledge.rag": RuntimeModuleCapability(
            enabled=_model_api_is_configured(),
            category="knowledge",
            label="Knowledge base RAG",
            description="Enables document upload, LanceDB vector storage, and the rag_search agent tool.",
            requiredEnv=["OPENAI_COMPATIBLE_API_KEY"],
            optionalEnv=[
                "OPENAI_COMPATIBLE_BASE_URL",
                "OPENAI_EMBEDDING_MODEL",
                "EMBEDDING_DIM",
                "LANCEDB_PATH",
                "KNOWLEDGE_DOCUMENTS_PATH",
            ],
            defaults={
                "embeddingModel": "text-embedding-v3",
                "lanceDbPath": "/tmp/lancedb_agents",
                "documentsPath": "/tmp/tobagent_knowledge_documents",
            },
        ),
        "agent.skills": RuntimeModuleCapability(
            enabled=True,
            category="agent",
            label="Prompt skills",
            description="Enables user-managed reusable skills loaded by the read_skill tool.",
        ),
        "agent.forms": RuntimeModuleCapability(
            enabled=True,
            category="agent",
            label="Structured forms",
            description="Enables custom business forms and query/manage form agent tools.",
        ),
        "agent.mcp": RuntimeModuleCapability(
            enabled=True,
            category="agent",
            label="MCP servers",
            description="Enables user-configured streamable HTTP MCP servers and dynamic MCP tool injection.",
        ),
        "agent.subagents": RuntimeModuleCapability(
            enabled=True,
            category="agent",
            label="Linked subagents",
            description="Enables agent profiles to delegate work to linked agent profiles at runtime.",
        ),
        "observability.langfuse": RuntimeModuleCapability(
            enabled=langfuse_enabled,
            category="observability",
            label="Langfuse tracing",
            description="Exports agent and voice telemetry traces to Langfuse and enables the trace browser UI.",
            requiredEnv=["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"],
            optionalEnv=["LANGFUSE_BASE_URL", "LANGFUSE_HOST"],
            defaults={"baseUrl": "https://cloud.langfuse.com"},
        ),
        "voice.asr": RuntimeModuleCapability(
            enabled=dashscope_enabled,
            category="voice",
            label="DashScope ASR",
            description="Enables browser and WebView speech recognition through the backend voice proxy.",
            requiredEnv=["DASHSCOPE_API_KEY"],
            optionalEnv=[
                "ASR_MODEL",
                "VOICE_VAD_THRESHOLD",
                "VOICE_VAD_MIN_SILENCE_DURATION",
                "VOICE_VAD_MIN_SPEECH_DURATION",
                "VOICE_VAD_MAX_SPEECH_DURATION",
            ],
            defaults={
                "asrModel": "qwen3-asr-flash",
                "vadThreshold": 0.5,
                "vadMinSilenceDuration": 0.6,
                "vadMinSpeechDuration": 0.2,
                "vadMaxSpeechDuration": 20.0,
            },
        ),
        "voice.tts": RuntimeModuleCapability(
            enabled=dashscope_enabled,
            category="voice",
            label="DashScope TTS",
            description="Enables streaming text-to-speech playback through the backend voice proxy.",
            requiredEnv=["DASHSCOPE_API_KEY"],
            optionalEnv=["TTS_MODEL", "TTS_VOICE"],
            defaults={
                "ttsModel": "qwen3-tts-instruct-flash-realtime",
                "ttsVoice": "Cherry",
            },
        ),
        "voice.wakeWord": RuntimeModuleCapability(
            enabled=_kws_model_available(),
            category="voice",
            label="Wake word detection",
            description="Enables local KWS wake-word detection when the model directory is available.",
            requiredEnv=[],
            optionalEnv=["KWS_MODEL_DIR", "KWS_NUM_THREADS"],
            defaults={"modelDir": "./models/kws", "numThreads": 2},
        ),
        "voice.speakerVerification": RuntimeModuleCapability(
            enabled=_speaker_verification_enabled(),
            category="voice",
            label="Speaker verification",
            description="Enables voiceprint enrollment and speaker verification when explicitly enabled and the speaker service is running.",
            requiredEnv=["VOICE_SPEAKER_VERIFICATION_ENABLED"],
            optionalEnv=[
                "SPEAKER_SERVICE_URL",
                "VOICE_SPEAKER_PROFILE_THRESHOLD",
                "VOICE_SPEAKER_PROFILE_MIN_SECONDS",
                "VOICE_SPEAKER_VERIFY_MIN_SECONDS",
            ],
            defaults={
                "speakerServiceUrl": "http://speaker:8090",
                "threshold": 0.72,
                "profileMinSeconds": 1.5,
                "verifyMinSeconds": 0.5,
            },
        ),
    }


@router.get("", response_model=RuntimeCapabilities)
async def get_runtime_capabilities(request: Request) -> RuntimeCapabilities:
    """Return modules that are enabled for the current backend env."""
    modules = _runtime_modules()
    local_dev_bypass = is_local_dev_request(request)
    return RuntimeCapabilities(
        modules=modules,
        # Compatibility fields for existing frontend code.
        smsAuth=modules["auth.sms"].enabled,
        langfuseTracing=modules["observability.langfuse"].enabled,
        localDevBypass=local_dev_bypass,
    )
