"""FastAPI server for public Chat LangChain support endpoints."""
# ruff: noqa: D103,D401

import asyncio
import logging
import os
import re
import string
from contextlib import asynccontextmanager, suppress

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.api import deps as api_deps
from src.api import schemas as api_schemas
from src.api import services as api_services
from src.api.kws_router import kws_router
from src.api.langsmith_routes import router as langsmith_router
from src.api.routes import agent_profiles as agent_profile_routes
from src.api.routes import models as model_routes
from src.api.routes.agent_profiles import router as agent_profiles_router
from src.api.routes.auth import router as auth_router
from src.api.routes.capabilities import router as capabilities_router
from src.api.routes.client_profiles import router as client_profiles_router
from src.api.routes.config_bundles import router as config_bundles_router
from src.api.routes.forms import router as forms_router
from src.api.routes.knowledge_bases import router as knowledge_bases_router
from src.api.routes.mcp_servers import router as mcp_servers_router
from src.api.routes.model_gateway import router as model_gateway_router
from src.api.routes.models import router as models_router
from src.api.routes.payments import router as payments_router
from src.api.routes.site_testimonials import router as site_testimonials_router
from src.api.routes.skills import router as skills_router
from src.api.routes.sms_hooks import router as sms_hooks_router
from src.api.routes.traces import router as traces_router
from src.api.routes.workspaces import router as workspaces_router
from src.api.voice_proxy import voice_router
from src.utils.voice_telemetry import init_voice_telemetry

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

AVATAR_COLORS = api_deps.AVATAR_COLORS
_extract_bearer_user_id = api_deps._extract_bearer_user_id
_require_same_user = api_deps._require_same_user
get_current_user = api_deps.get_current_user
hash_api_key = api_deps.hash_api_key
hash_password = api_deps.hash_password
verify_password = api_deps.verify_password

clear_model_list_cache = model_routes.clear_model_list_cache
httpx = model_routes.httpx
list_models = model_routes.list_models

CreateUserApiKeyRequest = api_schemas.CreateUserApiKeyRequest
CreateUserApiKeyResponse = api_schemas.CreateUserApiKeyResponse
UserLoginRequest = api_schemas.UserLoginRequest
UserRegisterRequest = api_schemas.UserRegisterRequest
UserResponse = api_schemas.UserResponse
UserUpdateRequest = api_schemas.UserUpdateRequest
UserBindPhoneRequest = api_schemas.UserBindPhoneRequest
UserPasswordUpdateRequest = api_schemas.UserPasswordUpdateRequest
SmsCodeRequest = api_schemas.SmsCodeRequest
SmsCodeResponse = api_schemas.SmsCodeResponse
SmsCodeVerifyRequest = api_schemas.SmsCodeVerifyRequest
AgentShareImportRequest = api_schemas.AgentShareImportRequest
AgentShareLinkRequest = api_schemas.AgentShareLinkRequest
AgentShareOptions = api_schemas.AgentShareOptions

_copy_kb_vector_table_best_effort = api_services._copy_kb_vector_table_best_effort
_remove_agent_profile_links = api_services._remove_agent_profile_links

DEFAULT_CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://wsrtob.s.odn.cc",
    "https://smith.langchain.com",
    "https://chat.langchain.com",
    "https://support.langchain.com",
    "https://reference.langchain.com",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "https://chat-lang-chain-v2.vercel.app",
    "https://chat-langchain-alpha.vercel.app",
    "https://public-chat-langchain-test.vercel.app",
    "https://public-chat-langchain-test-b5cwr3ocz-langchain.vercel.app",
]

DESKTOP_CORS_ORIGIN_PATTERN = re.compile(
    r"^(tauri://localhost|https?://tauri\.localhost(?::\d+)?|https?://localhost(?::\d+)?|"
    r"https?://127\.0\.0\.1(?::\d+)?)$"
)


def _get_cors_origins() -> list[str]:
    """Get CORS allowed origins from defaults plus environment overrides."""
    origins = DEFAULT_CORS_ORIGINS.copy()
    additional = os.getenv("ALLOWED_ORIGINS", "")
    if additional:
        origins.extend([o.strip() for o in additional.split(",") if o.strip()])
    
    # Also support CORS_ALLOW_ORIGINS which is commonly used by LangGraph
    cors_additional = os.getenv("CORS_ALLOW_ORIGINS", "")
    if cors_additional:
        origins.extend([o.strip() for o in cors_additional.split(",") if o.strip()])
        
    return list(set(origins))


def _is_desktop_cors_origin(origin: str | None) -> bool:
    """Return whether an Origin belongs to the packaged desktop app or localhost."""
    return bool(origin and DESKTOP_CORS_ORIGIN_PATTERN.fullmatch(origin))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_voice_telemetry()

    try:
        from src.utils.db import ensure_database_schema

        ensure_database_schema()

        async def _import_assets_on_startup() -> None:
            try:
                from src.utils.assets_import import import_assets_for_existing_users

                await import_assets_for_existing_users()
            except Exception as e:
                logger.error("Assets startup import failed: %s", e)

        app.state.assets_import_task = asyncio.create_task(_import_assets_on_startup())

    except Exception as e:
        logger.error(f"Failed to initialize database tables: {e}")

    app.state.kws_spotter = None
    app.state.kws_processor = None
    app.state.kws_loading_task = asyncio.create_task(_initialize_kws(app))

    try:
        yield
    finally:
        loading_task = getattr(app.state, "kws_loading_task", None)
        if loading_task and not loading_task.done():
            loading_task.cancel()
            with suppress(asyncio.CancelledError):
                await loading_task
        assets_import_task = getattr(app.state, "assets_import_task", None)
        if assets_import_task and not assets_import_task.done():
            assets_import_task.cancel()
            with suppress(asyncio.CancelledError):
                await assets_import_task


async def _initialize_kws(app: FastAPI) -> None:
    """Initialize KWS without delaying application readiness."""
    try:
        from src.api.kws_model import (
            KeywordProcessor,
            create_kws_spotter,
            ensure_kws_model,
        )

        model_dir = await asyncio.to_thread(ensure_kws_model)
        app.state.kws_spotter = await asyncio.to_thread(create_kws_spotter, model_dir)
        app.state.kws_processor = KeywordProcessor(model_dir)
        logger.info("KWS model loaded successfully")
    except Exception as e:
        logger.warning("KWS model not available, wake word detection disabled: %s", e)
        app.state.kws_spotter = None
        app.state.kws_processor = None


app = FastAPI(
    title="TOB Agent API",
    description=(
        "Backend API for the LangGraph documentation agent, management UI, "
        "voice services and LangSmith sharing helpers.\n\n"
        "External callers should pass `Authorization: Bearer <api-key>`. "
        "The web UI authenticates with an HttpOnly session cookie.\n\n"
        "Interactive Swagger documentation is available at `/docs`; ReDoc is "
        "available at `/redoc`; the raw OpenAPI schema is available at `/openapi.json`."
    ),
    version="0.1.0",
    lifespan=lifespan,
    openapi_tags=[
        {"name": "system", "description": "Service health, root metadata, and utility endpoints."},
        {"name": "auth", "description": "User registration, login, profile settings, and API keys."},
        {"name": "workspaces", "description": "Workspace membership, roles, and change approval."},
        {"name": "agent-profiles", "description": "Custom agent profile CRUD, version restore, and share import."},
        {"name": "forms", "description": "Custom structured forms and records exposed to configured agents."},
        {"name": "knowledge-bases", "description": "Knowledge base metadata, document upload, and RAG status."},
        {"name": "skills", "description": "User-owned system prompt skill CRUD."},
        {"name": "mcp-servers", "description": "User-owned MCP server configuration."},
        {"name": "models", "description": "Server-side proxy for OpenAI-compatible model listings."},
        {"name": "voice", "description": "ASR, TTS, voice telemetry, voiceprint enrollment, and speaker verification."},
        {"name": "client-profiles", "description": "Lightweight client profile metadata used by the web UI."},
        {"name": "config-bundles", "description": "Unified configuration archive inspection, import, and export."},
        {"name": "sms-hooks", "description": "External callback endpoints that trigger SMS notifications."},
        {"name": "langsmith", "description": "LangSmith run lookup and share helpers."},
        {"name": "traces", "description": "Read-only Langfuse trace browsing for agent conversations."},
        {"name": "site-testimonials", "description": "Public homepage testimonials from authenticated users."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def desktop_cors_preflight_middleware(request: Request, call_next):
    """Allow packaged Tauri app preflight requests against local or remote backends."""
    origin = request.headers.get("origin")
    if (
        request.method == "OPTIONS"
        and request.headers.get("access-control-request-method")
        and _is_desktop_cors_origin(origin)
    ):
        headers = {
            "Access-Control-Allow-Origin": origin or "",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT",
            "Access-Control-Allow-Headers": request.headers.get(
                "access-control-request-headers",
                "authorization,content-type",
            ),
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }
        if request.headers.get("access-control-request-private-network"):
            headers["Access-Control-Allow-Private-Network"] = "true"
        return Response("OK", status_code=200, headers=headers)

    response = await call_next(request)
    if _is_desktop_cors_origin(origin) and not response.headers.get("access-control-allow-origin"):
        response.headers["Access-Control-Allow-Origin"] = origin or ""
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers.add_vary_header("Origin")
    return response


app.include_router(langsmith_router)
app.include_router(capabilities_router)
app.include_router(voice_router)
app.include_router(kws_router)
app.include_router(auth_router)
app.include_router(models_router)
app.include_router(client_profiles_router)
app.include_router(workspaces_router)
app.include_router(config_bundles_router)
app.include_router(agent_profiles_router)
app.include_router(payments_router)
app.include_router(site_testimonials_router)
app.include_router(forms_router)
app.include_router(skills_router)
app.include_router(sms_hooks_router)
app.include_router(knowledge_bases_router)
app.include_router(mcp_servers_router)
app.include_router(model_gateway_router)
app.include_router(traces_router)


class TitleGenerationRequest(BaseModel):
    """Request model for title generation."""

    userMessage: str
    assistantResponse: str | None = None
    maxLength: int | None = 60


class TitleGenerationResponse(BaseModel):
    """Response model for title generation."""

    title: str


def truncate_title(message: str, max_length: int = 60) -> str:
    """Generate a deterministic fallback conversation title."""
    title = message.strip()
    title = re.sub(
        r"^(how do i|how to|can you|please|help me with|i need help with)\s+",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = title.rstrip(string.punctuation)
    if title:
        title = title[0].upper() + title[1:]
    if len(title) > max_length:
        title = title[: max_length - 3] + "..."
    return title


@app.get(
    "/health",
    tags=["system"],
    summary="Check API health",
    description="Returns a lightweight health payload for uptime checks and load balancers.",
)
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "chat-langchain"}


@app.post(
    "/generate-title",
    response_model=TitleGenerationResponse,
    tags=["system"],
    summary="Generate a deterministic conversation title",
    description=(
        "Creates a short title from the latest user message and optional assistant response. "
        "This endpoint uses deterministic truncation and does not call a model."
    ),
)
async def generate_conversation_title(request: TitleGenerationRequest):
    """Generate a simple conversation title for the frontend."""
    return TitleGenerationResponse(
        title=truncate_title(request.userMessage, request.maxLength or 60)
    )

create_agent_share_link = agent_profile_routes.create_agent_share_link


async def import_agent_share(*args, **kwargs):
    """Compatibility wrapper for tests importing from fastapi_app."""
    api_services._copy_kb_vector_table_best_effort = _copy_kb_vector_table_best_effort
    return await agent_profile_routes.import_agent_share(*args, **kwargs)


@app.get(
    "/",
    tags=["system"],
    summary="Get API root metadata",
    description="Returns service metadata and links to the generated API documentation.",
)
async def root():
    """Root endpoint."""
    return {
        "message": "Chat LangChain API Server",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "openapi": "/openapi.json",
        "endpoints": {
            "health": "/health",
            "generate_title": "/generate-title",
            "langsmith": "/langsmith",
            "agent_upload": "/agents/{agent_id}/upload",
            "agent_rag_status": "/agents/{agent_id}/rag-status",
            "agent_profiles": "/api/agent-profiles",
            "agent_shares": "/api/agent-shares/{token}",
            "skills": "/api/skills",
            "knowledge_bases": "/api/knowledge-bases",
            "mcp_servers": "/api/mcp-servers",
            "models": "/api/models",
            "traces": "/api/traces",
            "voice_asr": "/api/asr/transcribe",
            "voice_session": "/ws/voice/session",
            "voice_asr_stream": "/ws/voice/asr",
            "voice_tts": "/ws/voice/tts",
        },
    }
