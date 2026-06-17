"""FastAPI server for public Chat LangChain support endpoints."""
# ruff: noqa: D103,D401

import asyncio
import copy
import logging
import os
import re
import secrets
import string
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api import deps as api_deps
from src.api import schemas as api_schemas
from src.api.kws_router import kws_router
from src.api.langsmith_routes import router as langsmith_router
from src.api.routes import models as model_routes
from src.api.routes.auth import router as auth_router
from src.api.routes.models import router as models_router
from src.api.routes.robot import router as robot_router
from src.api.schemas import (
    AgentProfileSchema,
    AgentProfileVersionSchema,
    AgentRAGStatusResponse,
    AgentShareImportRequest,
    AgentShareImportResponse,
    AgentShareLinkRequest,
    AgentShareLinkSchema,
    AgentShareOptions,
    AgentSharePreview,
    ClientProfileSchema,
    KBFileSchema,
    KnowledgeBaseSchema,
    McpServerSchema,
    SkillSchema,
)
from src.api.voice_proxy import voice_router
from src.utils.db import (
    AgentProfileTable,
    AgentProfileVersionTable,
    AgentShareLinkTable,
    ClientProfileTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
    UserTable,
    UserVoiceprintTable,
    get_db,
)
from src.utils.default_skills import ensure_default_skills
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
    "https://chat-lang-chain-v2.vercel.app",
    "https://chat-langchain-alpha.vercel.app",
    "https://public-chat-langchain-test.vercel.app",
    "https://public-chat-langchain-test-b5cwr3ocz-langchain.vercel.app",
]


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
    title="Chat LangChain API Server",
    description="Public Chat LangChain support endpoints",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(langsmith_router)
app.include_router(voice_router)
app.include_router(kws_router)
app.include_router(auth_router)
app.include_router(models_router)
app.include_router(robot_router)


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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "chat-langchain"}


@app.post("/generate-title", response_model=TitleGenerationResponse)
async def generate_conversation_title(request: TitleGenerationRequest):
    """Generate a simple conversation title for the frontend."""
    return TitleGenerationResponse(
        title=truncate_title(request.userMessage, request.maxLength or 60)
    )

def _schema_files(files: list[dict] | None) -> list[KBFileSchema]:
    return [
        KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"])
        for f in files or []
    ]


def _agent_profile_schema(profile: AgentProfileTable) -> AgentProfileSchema:
    return AgentProfileSchema(
        id=profile.id,
        name=profile.name,
        description=profile.description,
        systemPrompt=profile.system_prompt,
        model=profile.model,
        enabledTools=profile.enabled_tools or [],
        knowledgeBaseIds=profile.knowledge_base_ids or [],
        skillIds=profile.skill_ids or [],
        mcpIds=profile.mcp_ids or [],
        agentIds=profile.agent_ids or [],
        wakeWords=profile.wake_words or [],
        roleTemplateId=profile.role_template_id,
        personaStyle=profile.persona_style,
        boundaryMode=profile.boundary_mode,
        ttsVoice=profile.tts_voice,
        voiceInterruptionEnabled=profile.voice_interruption_enabled is not False,
        speakerVerificationEnabled=bool(profile.speaker_verification_enabled),
        speakerVerificationBound=bool(profile.user_voiceprint_id),
        speakerSampleText=profile.speaker_sample_text,
        speakerEnrolledAt=profile.speaker_enrolled_at,
        userVoiceprintId=profile.user_voiceprint_id,
        createdAt=profile.created_at,
        updatedAt=profile.updated_at,
    )


def _agent_profile_snapshot(profile: AgentProfileTable) -> dict:
    return _agent_profile_schema(profile).model_dump(mode="json")


def _agent_profile_version_schema(version: AgentProfileVersionTable) -> AgentProfileVersionSchema:
    return AgentProfileVersionSchema(
        id=version.id,
        agentProfileId=version.agent_profile_id,
        version=version.version,
        snapshot=AgentProfileSchema.model_validate(version.snapshot),
        createdAt=version.created_at,
    )


def _create_agent_profile_version(
    db: Session,
    profile: AgentProfileTable,
    created_at: str | None = None,
) -> AgentProfileVersionTable:
    latest_version = (
        db.query(AgentProfileVersionTable.version)
        .filter(
            AgentProfileVersionTable.agent_profile_id == profile.id,
            AgentProfileVersionTable.owner_user_id == profile.owner_user_id,
        )
        .order_by(AgentProfileVersionTable.version.desc())
        .first()
    )
    next_version = (latest_version[0] if latest_version else 0) + 1
    version = AgentProfileVersionTable(
        id=str(uuid.uuid4()),
        agent_profile_id=profile.id,
        owner_user_id=profile.owner_user_id,
        version=next_version,
        snapshot=_agent_profile_snapshot(profile),
        created_at=created_at or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    )
    db.add(version)
    return version


def _skill_schema(skill: SkillTable) -> SkillSchema:
    return SkillSchema(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        content=skill.content,
        createdAt=skill.created_at,
        updatedAt=skill.updated_at,
    )


def _kb_schema(kb: KnowledgeBaseTable) -> KnowledgeBaseSchema:
    return KnowledgeBaseSchema(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        files=_schema_files(kb.files),
        isSystem=kb.owner_user_id is None,
        createdAt=kb.created_at,
        updatedAt=kb.updated_at,
    )


def _mcp_schema(server: McpServerTable) -> McpServerSchema:
    return McpServerSchema(
        id=server.id,
        name=server.name,
        type="streamable_http",
        url=server.url,
        headers=server.headers or {},
        createdAt=server.created_at,
        updatedAt=server.updated_at,
    )


def _share_options_from_row(share: AgentShareLinkTable) -> AgentShareOptions:
    return AgentShareOptions.model_validate(share.include_options or {})


def _share_link_schema(share: AgentShareLinkTable) -> AgentShareLinkSchema:
    return AgentShareLinkSchema(
        token=share.token,
        agentProfileId=share.agent_profile_id,
        include=_share_options_from_row(share),
        createdAt=share.created_at,
        updatedAt=share.updated_at,
    )


def _require_owned_ids(
    db: Session,
    table,
    ids: list[str],
    owner_user_id: str,
    label: str,
) -> None:
    unique_ids = list(dict.fromkeys(ids or []))
    if not unique_ids:
        return
    count = db.query(table).filter(
        table.id.in_(unique_ids),
        table.owner_user_id == owner_user_id,
    ).count()
    if count != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail=f"{label} contains resources that do not belong to the current user",
        )


def _require_accessible_knowledge_base_ids(
    db: Session,
    ids: list[str],
    owner_user_id: str,
) -> None:
    """Require KB ids to be owned by the user or provided by the system."""
    from sqlalchemy import or_

    unique_ids = list(dict.fromkeys(ids or []))
    if not unique_ids:
        return
    count = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id.in_(unique_ids),
        or_(
            KnowledgeBaseTable.owner_user_id == owner_user_id,
            KnowledgeBaseTable.owner_user_id.is_(None),
        ),
    ).count()
    if count != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail="knowledgeBaseIds contains resources that do not belong to the current user",
        )


def _validate_agent_profile_links(
    db: Session,
    profile_data: AgentProfileSchema,
    owner_user_id: str,
    current_profile_id: str | None = None,
) -> None:
    _require_accessible_knowledge_base_ids(db, profile_data.knowledgeBaseIds, owner_user_id)
    _require_owned_ids(db, SkillTable, profile_data.skillIds, owner_user_id, "skillIds")
    _require_owned_ids(db, McpServerTable, profile_data.mcpIds, owner_user_id, "mcpIds")
    if profile_data.userVoiceprintId:
        _require_owned_ids(
            db,
            UserVoiceprintTable,
            [profile_data.userVoiceprintId],
            owner_user_id,
            "userVoiceprintId",
        )

    agent_ids = list(profile_data.agentIds or [])
    if current_profile_id:
        agent_ids = [agent_id for agent_id in agent_ids if agent_id != current_profile_id]
    _require_owned_ids(db, AgentProfileTable, agent_ids, owner_user_id, "agentIds")


def _remove_agent_profile_links(
    db: Session,
    owner_user_id: str,
    field_name: str,
    deleted_ids: list[str],
) -> int:
    """Remove deleted resource ids from all owned agent profile link arrays."""
    ids_to_remove = set(deleted_ids)
    if not ids_to_remove:
        return 0

    changed_count = 0
    profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
    ).all()
    for profile in profiles:
        current_ids = getattr(profile, field_name, None)
        if not isinstance(current_ids, list):
            continue

        updated_ids = [
            resource_id
            for resource_id in current_ids
            if resource_id not in ids_to_remove
        ]
        if updated_ids == current_ids:
            continue

        setattr(profile, field_name, updated_ids)
        profile.updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        changed_count += 1

    return changed_count


def _invalidate_runtime_caches(
    agent_id: str | None = None,
    owner_user_id: str | None = None,
) -> None:
    """Best-effort invalidation for request-time agent/RAG metadata caches."""
    try:
        from src.middleware.dynamic_config_middleware import DynamicConfigMiddleware

        DynamicConfigMiddleware.clear_cache(agent_id=agent_id, owner_user_id=owner_user_id)
    except Exception:
        pass

    try:
        from src.tools.rag_tool import invalidate_rag_cache

        invalidate_rag_cache(agent_id=agent_id, owner_user_id=owner_user_id)
    except Exception:
        pass


def _new_resource_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


def _copy_kb_vector_table_best_effort(source_kb_id: str, target_kb_id: str) -> str | None:
    """Copy LanceDB rows for a shared KB when the local vector store is available."""
    try:
        from src.tools.rag_tool import _get_db, _table_name, invalidate_rag_cache

        vector_db = _get_db()
        source_table_name = _table_name(source_kb_id)
        target_table_name = _table_name(target_kb_id)
        if source_table_name not in vector_db.table_names():
            return None

        source_table = vector_db.open_table(source_table_name)
        if hasattr(source_table, "to_arrow"):
            data = source_table.to_arrow()
        elif hasattr(source_table, "to_lance"):
            data = source_table.to_lance().to_table()
        else:
            return "Knowledge base vectors could not be copied by this LanceDB version."

        if target_table_name in vector_db.table_names():
            vector_db.drop_table(target_table_name)
        vector_db.create_table(target_table_name, data=data)
        invalidate_rag_cache()
        return None
    except Exception as exc:
        logger.warning("Failed to copy shared KB vectors %s -> %s: %s", source_kb_id, target_kb_id, exc)
        return "Knowledge base metadata was copied, but vector rows could not be copied."


def _copy_shared_agent_resources(
    db: Session,
    source_profile: AgentProfileTable,
    target_owner_user_id: str,
    include: AgentShareOptions,
    now: str,
) -> tuple[dict[str, list[str]], dict[str, dict[str, str]], list[str]]:
    """Copy selected linked resources and return rewritten id lists."""
    source_ids = {
        "knowledgeBaseIds": list(source_profile.knowledge_base_ids or []),
        "skillIds": list(source_profile.skill_ids or []),
        "mcpIds": list(source_profile.mcp_ids or []),
        "agentIds": list(source_profile.agent_ids or []),
    }
    target_ids = {key: [] for key in source_ids}
    id_map: dict[str, dict[str, str]] = {
        "knowledgeBaseIds": {},
        "skillIds": {},
        "mcpIds": {},
        "agentIds": {},
    }
    warnings: list[str] = []

    if include.knowledgeBases:
        from sqlalchemy import or_

        kbs = db.query(KnowledgeBaseTable).filter(
            KnowledgeBaseTable.id.in_(source_ids["knowledgeBaseIds"]),
            or_(
                KnowledgeBaseTable.owner_user_id == source_profile.owner_user_id,
                KnowledgeBaseTable.owner_user_id.is_(None),
            ),
        ).all()
        by_id = {kb.id: kb for kb in kbs}
        for source_id in source_ids["knowledgeBaseIds"]:
            kb = by_id.get(source_id)
            if not kb:
                warnings.append(f"Knowledge base {source_id} was not found and was skipped.")
                continue
            if kb.owner_user_id is None:
                target_ids["knowledgeBaseIds"].append(kb.id)
                id_map["knowledgeBaseIds"][source_id] = kb.id
                continue

            target_id = _new_resource_id("kb")
            db.add(KnowledgeBaseTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{kb.name} (shared)",
                description=kb.description,
                files=copy.deepcopy(kb.files or []),
                created_at=now,
                updated_at=now,
            ))
            target_ids["knowledgeBaseIds"].append(target_id)
            id_map["knowledgeBaseIds"][source_id] = target_id
            warning = _copy_kb_vector_table_best_effort(kb.id, target_id)
            if warning:
                warnings.append(warning)

    if include.skills:
        skills = db.query(SkillTable).filter(
            SkillTable.id.in_(source_ids["skillIds"]),
            SkillTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {skill.id: skill for skill in skills}
        for source_id in source_ids["skillIds"]:
            skill = by_id.get(source_id)
            if not skill:
                warnings.append(f"Skill {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("skill")
            db.add(SkillTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{skill.name} (shared)",
                description=skill.description,
                content=skill.content,
                created_at=now,
                updated_at=now,
            ))
            target_ids["skillIds"].append(target_id)
            id_map["skillIds"][source_id] = target_id

    if include.mcpServers:
        servers = db.query(McpServerTable).filter(
            McpServerTable.id.in_(source_ids["mcpIds"]),
            McpServerTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {server.id: server for server in servers}
        for source_id in source_ids["mcpIds"]:
            server = by_id.get(source_id)
            if not server:
                warnings.append(f"MCP server {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("mcp")
            db.add(McpServerTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{server.name} (shared)",
                type="streamable_http",
                url=server.url,
                headers=copy.deepcopy(server.headers or {}),
                created_at=now,
                updated_at=now,
            ))
            target_ids["mcpIds"].append(target_id)
            id_map["mcpIds"][source_id] = target_id

    if include.agents:
        linked_agents = db.query(AgentProfileTable).filter(
            AgentProfileTable.id.in_(source_ids["agentIds"]),
            AgentProfileTable.owner_user_id == source_profile.owner_user_id,
        ).all()
        by_id = {agent.id: agent for agent in linked_agents}
        for source_id in source_ids["agentIds"]:
            agent = by_id.get(source_id)
            if not agent:
                warnings.append(f"Linked agent {source_id} was not found and was skipped.")
                continue
            target_id = _new_resource_id("agent")
            linked_profile = AgentProfileTable(
                id=target_id,
                owner_user_id=target_owner_user_id,
                name=f"{agent.name} (shared)",
                description=agent.description,
                system_prompt=agent.system_prompt,
                model=agent.model,
                enabled_tools=copy.deepcopy(agent.enabled_tools or []),
                knowledge_base_ids=[],
                skill_ids=[],
                mcp_ids=[],
                agent_ids=[],
                wake_words=copy.deepcopy(agent.wake_words or []),
                role_template_id=agent.role_template_id,
                persona_style=agent.persona_style,
                boundary_mode=agent.boundary_mode,
                tts_voice=agent.tts_voice,
                voice_interruption_enabled=agent.voice_interruption_enabled is not False,
                speaker_verification_enabled=False,
                created_at=now,
                updated_at=now,
            )
            db.add(linked_profile)
            _create_agent_profile_version(db, linked_profile, now)
            target_ids["agentIds"].append(target_id)
            id_map["agentIds"][source_id] = target_id

    return target_ids, id_map, warnings


# ---------------------------------------------------------------------------
# Client Profile CRUD
# ---------------------------------------------------------------------------

@app.get("/api/client-profiles/{id}", response_model=ClientProfileSchema | None)
async def get_client_profile(id: str, db: Session = Depends(get_db)):
    profile = db.query(ClientProfileTable).filter(ClientProfileTable.id == id).first()
    if not profile:
        return None
    return ClientProfileSchema(
        id=profile.id,
        label=profile.label,
        avatarColor=profile.avatar_color,
    )


@app.post("/api/client-profiles", response_model=ClientProfileSchema)
async def upsert_client_profile(profile_data: ClientProfileSchema, db: Session = Depends(get_db)):
    from datetime import datetime
    profile = db.query(ClientProfileTable).filter(ClientProfileTable.id == profile_data.id).first()
    if profile:
        profile.label = profile_data.label
        profile.avatar_color = profile_data.avatarColor
    else:
        profile = ClientProfileTable(
            id=profile_data.id,
            label=profile_data.label,
            avatar_color=profile_data.avatarColor,
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(profile)
    db.commit()
    db.refresh(profile)
    return ClientProfileSchema(
        id=profile.id,
        label=profile.label,
        avatarColor=profile.avatar_color,
    )


# ---------------------------------------------------------------------------
# Agent Profile CRUD
# ---------------------------------------------------------------------------

@app.get("/api/agent-profiles", response_model=list[AgentProfileSchema])
async def get_agent_profiles(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    from src.utils.assets_import import is_default_agent_profile_id

    ensure_default_skills(db, current_user.id)
    default_profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == current_user.id,
    ).all()
    default_profile_ids = [
        profile.id
        for profile in default_profiles
        if is_default_agent_profile_id(profile.id)
    ]
    if default_profile_ids:
        _remove_agent_profile_links(db, current_user.id, "agent_ids", default_profile_ids)
        for profile in default_profiles:
            if profile.id in default_profile_ids:
                db.delete(profile)
    db.commit()

    profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == current_user.id
    ).all()
    return [_agent_profile_schema(p) for p in profiles]


@app.post("/api/agent-profiles", response_model=AgentProfileSchema)
async def create_agent_profile(
    profile_data: AgentProfileSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    # Check duplicate
    existing = db.query(AgentProfileTable).filter(AgentProfileTable.id == profile_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent profile already exists")
    _validate_agent_profile_links(db, profile_data, current_user.id, profile_data.id)
    
    new_profile = AgentProfileTable(
        id=profile_data.id,
        owner_user_id=current_user.id,
        name=profile_data.name,
        description=profile_data.description,
        system_prompt=profile_data.systemPrompt,
        model=(profile_data.model or "").strip() or None,
        enabled_tools=profile_data.enabledTools,
        knowledge_base_ids=profile_data.knowledgeBaseIds,
        skill_ids=profile_data.skillIds,
        mcp_ids=profile_data.mcpIds,
        agent_ids=profile_data.agentIds,
        wake_words=profile_data.wakeWords,
        role_template_id=profile_data.roleTemplateId,
        persona_style=profile_data.personaStyle,
        boundary_mode=profile_data.boundaryMode,
        tts_voice=profile_data.ttsVoice,
        voice_interruption_enabled=profile_data.voiceInterruptionEnabled,
        speaker_verification_enabled=profile_data.speakerVerificationEnabled,
        user_voiceprint_id=profile_data.userVoiceprintId,
        created_at=profile_data.createdAt,
        updated_at=profile_data.updatedAt,
    )
    db.add(new_profile)
    _create_agent_profile_version(db, new_profile, profile_data.createdAt)
    db.commit()
    db.refresh(new_profile)
    _invalidate_runtime_caches(new_profile.id, current_user.id)
    return _agent_profile_schema(new_profile)


@app.put("/api/agent-profiles/{id}", response_model=AgentProfileSchema)
async def update_agent_profile(
    id: str,
    profile_data: AgentProfileSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _validate_agent_profile_links(db, profile_data, current_user.id, id)

    profile.name = profile_data.name
    profile.description = profile_data.description
    profile.system_prompt = profile_data.systemPrompt
    profile.model = (profile_data.model or "").strip() or None
    profile.enabled_tools = profile_data.enabledTools
    profile.knowledge_base_ids = profile_data.knowledgeBaseIds
    profile.skill_ids = profile_data.skillIds
    profile.mcp_ids = profile_data.mcpIds
    profile.agent_ids = profile_data.agentIds
    profile.wake_words = profile_data.wakeWords
    profile.role_template_id = profile_data.roleTemplateId
    profile.persona_style = profile_data.personaStyle
    profile.boundary_mode = profile_data.boundaryMode
    profile.tts_voice = profile_data.ttsVoice
    profile.voice_interruption_enabled = profile_data.voiceInterruptionEnabled
    profile.speaker_verification_enabled = profile_data.speakerVerificationEnabled
    profile.user_voiceprint_id = profile_data.userVoiceprintId
    profile.updated_at = profile_data.updatedAt
    _create_agent_profile_version(db, profile, profile.updated_at)
    
    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, current_user.id)
    return _agent_profile_schema(profile)


@app.get(
    "/api/agent-profiles/{id}/versions",
    response_model=list[AgentProfileVersionSchema],
)
async def get_agent_profile_versions(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    versions = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == current_user.id,
    ).order_by(AgentProfileVersionTable.version.desc()).all()
    return [_agent_profile_version_schema(version) for version in versions]


@app.post(
    "/api/agent-profiles/{id}/versions/{version_id}/restore",
    response_model=AgentProfileSchema,
)
async def restore_agent_profile_version(
    id: str,
    version_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    version = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.id == version_id,
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == current_user.id,
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Agent profile version not found")

    restored = AgentProfileSchema.model_validate(version.snapshot)
    _validate_agent_profile_links(db, restored, current_user.id, id)

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    profile.name = restored.name
    profile.description = restored.description
    profile.system_prompt = restored.systemPrompt
    profile.model = (restored.model or "").strip() or None
    profile.enabled_tools = restored.enabledTools
    profile.knowledge_base_ids = restored.knowledgeBaseIds
    profile.skill_ids = restored.skillIds
    profile.mcp_ids = restored.mcpIds
    profile.agent_ids = restored.agentIds
    profile.wake_words = restored.wakeWords
    profile.role_template_id = restored.roleTemplateId
    profile.persona_style = restored.personaStyle
    profile.boundary_mode = restored.boundaryMode
    profile.tts_voice = restored.ttsVoice
    profile.voice_interruption_enabled = restored.voiceInterruptionEnabled
    profile.speaker_verification_enabled = restored.speakerVerificationEnabled
    profile.user_voiceprint_id = restored.userVoiceprintId
    profile.updated_at = now
    _create_agent_profile_version(db, profile, now)

    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, current_user.id)
    return _agent_profile_schema(profile)


@app.post("/api/agent-profiles/{id}/share", response_model=AgentShareLinkSchema)
async def create_agent_share_link(
    id: str,
    share_data: AgentShareLinkRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    existing = db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == current_user.id,
    ).first()
    include_options = share_data.include.model_dump(mode="json")
    if existing:
        existing.include_options = include_options
        existing.updated_at = now
        share = existing
    else:
        share = AgentShareLinkTable(
            id=f"share-{uuid.uuid4()}",
            token=secrets.token_urlsafe(24),
            owner_user_id=current_user.id,
            agent_profile_id=id,
            include_options=include_options,
            created_at=now,
            updated_at=now,
        )
        db.add(share)

    db.commit()
    db.refresh(share)
    return _share_link_schema(share)


@app.get("/api/agent-shares/{token}", response_model=AgentSharePreview)
async def get_agent_share_preview(
    token: str,
    db: Session = Depends(get_db),
):
    share = db.query(AgentShareLinkTable).filter(AgentShareLinkTable.token == token).first()
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")

    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == share.agent_profile_id,
        AgentProfileTable.owner_user_id == share.owner_user_id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Shared agent profile not found")

    include = _share_options_from_row(share)
    resources = {
        "knowledgeBases": len(profile.knowledge_base_ids or []) if include.knowledgeBases else 0,
        "skills": len(profile.skill_ids or []) if include.skills else 0,
        "mcpServers": len(profile.mcp_ids or []) if include.mcpServers else 0,
        "agents": len(profile.agent_ids or []) if include.agents else 0,
    }
    preview_agent = _agent_profile_schema(profile)
    preview_agent.knowledgeBaseIds = []
    preview_agent.skillIds = []
    preview_agent.mcpIds = []
    preview_agent.agentIds = []
    preview_agent.userVoiceprintId = None
    preview_agent.speakerVerificationEnabled = False
    preview_agent.speakerVerificationBound = False

    return AgentSharePreview(
        token=share.token,
        agent=preview_agent,
        include=include,
        resources=resources,
        createdAt=share.created_at,
    )


@app.post("/api/agent-shares/{token}/import", response_model=AgentShareImportResponse)
async def import_agent_share(
    token: str,
    import_data: AgentShareImportRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    share = db.query(AgentShareLinkTable).filter(AgentShareLinkTable.token == token).first()
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")

    source_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == share.agent_profile_id,
        AgentProfileTable.owner_user_id == share.owner_user_id,
    ).first()
    if not source_profile:
        raise HTTPException(status_code=404, detail="Shared agent profile not found")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    include = _share_options_from_row(share)
    copied_ids, id_map, warnings = _copy_shared_agent_resources(
        db,
        source_profile,
        current_user.id,
        include,
        now,
    )
    imported_profile = AgentProfileTable(
        id=_new_resource_id("agent"),
        owner_user_id=current_user.id,
        name=(import_data.name or f"{source_profile.name} (shared)").strip(),
        description=source_profile.description,
        system_prompt=source_profile.system_prompt,
        model=source_profile.model,
        enabled_tools=copy.deepcopy(source_profile.enabled_tools or []),
        knowledge_base_ids=copied_ids["knowledgeBaseIds"],
        skill_ids=copied_ids["skillIds"],
        mcp_ids=copied_ids["mcpIds"],
        agent_ids=copied_ids["agentIds"],
        wake_words=copy.deepcopy(source_profile.wake_words or []),
        role_template_id=source_profile.role_template_id,
        persona_style=source_profile.persona_style,
        boundary_mode=source_profile.boundary_mode,
        tts_voice=source_profile.tts_voice,
        voice_interruption_enabled=source_profile.voice_interruption_enabled is not False,
        speaker_verification_enabled=False,
        created_at=now,
        updated_at=now,
    )
    db.add(imported_profile)
    _create_agent_profile_version(db, imported_profile, now)
    db.commit()
    db.refresh(imported_profile)
    _invalidate_runtime_caches(imported_profile.id, current_user.id)
    return AgentShareImportResponse(
        agent=_agent_profile_schema(imported_profile),
        resourceIdMap=id_map,
        warnings=list(dict.fromkeys(warnings)),
    )


@app.delete("/api/agent-profiles/{id}")
async def delete_agent_profile(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _remove_agent_profile_links(db, current_user.id, "agent_ids", [id])
    db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == current_user.id,
    ).delete()
    db.delete(profile)
    db.commit()
    _invalidate_runtime_caches(id, current_user.id)
    return {"status": "success", "message": f"Agent profile {id} deleted"}


# ---------------------------------------------------------------------------
# Skill CRUD
# ---------------------------------------------------------------------------

@app.get("/api/skills", response_model=list[SkillSchema])
async def get_skills(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    ensure_default_skills(db, current_user.id)
    db.commit()

    skills = db.query(SkillTable).filter(SkillTable.owner_user_id == current_user.id).all()
    return [_skill_schema(s) for s in skills]


@app.post("/api/skills", response_model=SkillSchema)
async def create_skill(
    skill_data: SkillSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    existing = db.query(SkillTable).filter(SkillTable.id == skill_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Skill already exists")
    
    new_skill = SkillTable(
        id=skill_data.id,
        owner_user_id=current_user.id,
        name=skill_data.name,
        description=skill_data.description,
        content=skill_data.content,
        created_at=skill_data.createdAt,
        updated_at=skill_data.updatedAt,
    )
    db.add(new_skill)
    db.commit()
    db.refresh(new_skill)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _skill_schema(new_skill)


@app.put("/api/skills/{id}", response_model=SkillSchema)
async def update_skill(
    id: str,
    skill_data: SkillSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == current_user.id,
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    skill.name = skill_data.name
    skill.description = skill_data.description
    skill.content = skill_data.content
    skill.updated_at = skill_data.updatedAt
    
    db.commit()
    db.refresh(skill)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _skill_schema(skill)


@app.delete("/api/skills/{id}")
async def delete_skill(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == current_user.id,
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    _remove_agent_profile_links(db, current_user.id, "skill_ids", [id])
    db.delete(skill)
    db.commit()
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return {"status": "success", "message": f"Skill {id} deleted"}


# ---------------------------------------------------------------------------
# Knowledge Base CRUD & Upload
# ---------------------------------------------------------------------------

@app.get("/api/knowledge-bases", response_model=list[KnowledgeBaseSchema])
async def get_knowledge_bases(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    from sqlalchemy import or_

    kbs = db.query(KnowledgeBaseTable).filter(
        or_(
            KnowledgeBaseTable.owner_user_id == current_user.id,
            KnowledgeBaseTable.owner_user_id.is_(None),
        )
    ).order_by(KnowledgeBaseTable.owner_user_id.isnot(None), KnowledgeBaseTable.name).all()
    return [_kb_schema(k) for k in kbs]


@app.post("/api/knowledge-bases", response_model=KnowledgeBaseSchema)
async def create_knowledge_base(
    kb_data: KnowledgeBaseSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    existing = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Knowledge Base already exists")
    
    # Map Pydantic files models to raw JSON dict list
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    new_kb = KnowledgeBaseTable(
        id=kb_data.id,
        owner_user_id=current_user.id,
        name=kb_data.name,
        description=kb_data.description,
        files=db_files,
        created_at=kb_data.createdAt,
        updated_at=kb_data.updatedAt,
    )
    db.add(new_kb)
    db.commit()
    db.refresh(new_kb)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _kb_schema(new_kb)


@app.put("/api/knowledge-bases/{id}", response_model=KnowledgeBaseSchema)
async def update_knowledge_base(
    id: str,
    kb_data: KnowledgeBaseSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == id,
        KnowledgeBaseTable.owner_user_id == current_user.id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")
    
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    kb.name = kb_data.name
    kb.description = kb_data.description
    kb.files = db_files
    kb.updated_at = kb_data.updatedAt
    
    db.commit()
    db.refresh(kb)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _kb_schema(kb)


@app.delete("/api/knowledge-bases/{id}")
async def delete_knowledge_base(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == id,
        KnowledgeBaseTable.owner_user_id == current_user.id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")
    
    # Try to drop/delete matching table in LanceDB if it exists
    try:
        from src.tools.rag_tool import _get_async_db, _table_name
        lancedb_instance = await _get_async_db()
        tname = _table_name(id)
        if tname in await lancedb_instance.table_names():
            await lancedb_instance.drop_table(tname)
            from src.tools.rag_tool import invalidate_rag_cache

            invalidate_rag_cache()
            logger.info(f"Dropped LanceDB table '{tname}' for Knowledge Base {id}")
    except Exception as e:
        logger.error(f"Failed to drop LanceDB table for KB {id}: {e}")

    _remove_agent_profile_links(db, current_user.id, "knowledge_base_ids", [id])
    db.delete(kb)
    db.commit()
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return {"status": "success", "message": f"Knowledge base {id} and associated LanceDB table deleted"}


def _sync_load_document(filename: str, content_type: str, raw: bytes) -> str:
    """Synchronous helper to import loaders, write temp files, and parse.
    
    Runs completely in a thread pool via asyncio.to_thread to avoid blocking ASGI event loop.
    """
    from src.utils.document_loader import load_document_bytes

    return load_document_bytes(filename, content_type, raw)


async def _load_document_content(file: UploadFile, raw: bytes) -> str:
    """Helper to parse uploaded document using LangChain document loaders."""
    import asyncio
    
    filename = file.filename or "unknown"
    content_type = file.content_type or ""
    
    try:
        return await asyncio.to_thread(_sync_load_document, filename, content_type, raw)
    except Exception as e:
        logger.error(f"Error loading document {filename} using LangChain: {e}")
        from fastapi import HTTPException
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(
            status_code=400,
            detail=f"无法解析文件 {filename}: {str(e)}"
        )


@app.post("/api/knowledge-bases/{kb_id}/upload")
async def upload_kb_document(
    kb_id: str,
    file: UploadFile = File(...),
    chunk_size: int = Form(default=512),
    chunk_overlap: int = Form(default=64),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Upload document directly to a shared knowledge base (RAG).
    
    Extracts text, splits into chunks, embeds and saves to LanceDB.
    Also records file metadata under the KB in PostgreSQL.
    """
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == kb_id,
        KnowledgeBaseTable.owner_user_id == current_user.id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")

    try:
        from datetime import datetime

        from langchain_text_splitters import RecursiveCharacterTextSplitter

        raw = await file.read()
        file_size = len(raw)

        full_text = await _load_document_content(file, raw)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        chunks = splitter.split_text(full_text)
        if not chunks:
            raise HTTPException(status_code=400, detail="No content extracted from file.")

        # 直接 await 原生 async 版本，无需 asyncio.to_thread
        from src.tools.rag_tool import ingest_documents_async
        _filename = file.filename
        n = await ingest_documents_async(
            kb_id,
            chunks,
            [_filename or "upload"] * len(chunks),
        )

        # Update file list in PostgreSQL
        files_list = list(kb.files or [])
        # Check if already present and replace, or append new one
        exists = False
        for f in files_list:
            if f["name"] == file.filename:
                f["size"] = file_size
                f["uploadedAt"] = datetime.utcnow().isoformat() + "Z"
                exists = True
                break
        if not exists:
            files_list.append({
                "name": file.filename or "unknown",
                "size": file_size,
                "uploadedAt": datetime.utcnow().isoformat() + "Z",
            })
        
        kb.files = files_list
        kb.updated_at = datetime.utcnow().isoformat() + "Z"
        db.commit()
        db.refresh(kb)
        _invalidate_runtime_caches(owner_user_id=current_user.id)

        return {
            "kb_id": kb_id,
            "chunks_ingested": n,
            "filename": file.filename,
            "knowledge_base": KnowledgeBaseSchema(
                id=kb.id,
                name=kb.name,
                description=kb.description,
                files=_schema_files(kb.files),
                createdAt=kb.created_at,
                updatedAt=kb.updated_at,
            )
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"KB upload failed for KB {kb_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge-bases/{kb_id}/files/{filename}")
async def delete_kb_file(
    kb_id: str,
    filename: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Delete a file from the Knowledge Base.
    
    Removes vector data from LanceDB and deletes metadata from PostgreSQL.
    """
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == kb_id,
        KnowledgeBaseTable.owner_user_id == current_user.id,
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")

    try:
        from datetime import datetime

        from src.tools.rag_tool import delete_documents_async

        # 1. Delete from LanceDB (async native)
        await delete_documents_async(agent_id=kb_id, source=filename)

        # 2. Update PostgreSQL files JSON
        files_list = list(kb.files or [])
        updated_files = [f for f in files_list if f["name"] != filename]
        
        kb.files = updated_files
        kb.updated_at = datetime.utcnow().isoformat() + "Z"
        db.commit()
        db.refresh(kb)
        _invalidate_runtime_caches(owner_user_id=current_user.id)

        return {
            "status": "success",
            "kb_id": kb_id,
            "filename": filename,
            "knowledge_base": KnowledgeBaseSchema(
                id=kb.id,
                name=kb.name,
                description=kb.description,
                files=_schema_files(kb.files),
                createdAt=kb.created_at,
                updatedAt=kb.updated_at,
            )
        }
    except Exception as e:
        logger.error(f"Failed to delete file '{filename}' from KB {kb_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Legacy agent RAG upload and statuses for backward compatibility
# ---------------------------------------------------------------------------

@app.post("/agents/{agent_id}/upload")
async def upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    chunk_size: int = Form(default=512),
    chunk_overlap: int = Form(default=64),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Upload a document to the agent's RAG knowledge base.

    Accepts plain text, markdown, and PDF files.
    Splits into chunks, embeds, and stores in LanceDB.
    """
    agent_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not agent_profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        raw = await file.read()
        full_text = await _load_document_content(file, raw)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        chunks = splitter.split_text(full_text)
        if not chunks:
            raise HTTPException(status_code=400, detail="No content extracted from file.")

        # 直接 await 原生 async 版本，无需 asyncio.to_thread
        from src.tools.rag_tool import ingest_documents_async
        _filename = file.filename
        n = await ingest_documents_async(
            agent_id,
            chunks,
            [_filename or "upload"] * len(chunks),
        )
        return {"agent_id": agent_id, "chunks_ingested": n, "filename": file.filename}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"RAG upload failed for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/agents/{agent_id}/rag-status", response_model=AgentRAGStatusResponse)
async def rag_status(
    agent_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Return the number of documents in the agent's RAG knowledge base."""
    import asyncio

    agent_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not agent_profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    def _get_count() -> int:
        from src.tools.rag_tool import _get_db, _table_name
        db = _get_db()
        tname = _table_name(agent_id)
        if tname not in db.table_names():
            return 0
        table = db.open_table(tname)
        return table.count_rows()

    try:
        # 使用 asyncio.to_thread 避免 lancedb.connect()/os.getcwd() 阻塞事件循环
        count = await asyncio.to_thread(_get_count)
        return AgentRAGStatusResponse(agent_id=agent_id, document_count=count)
    except Exception as e:
        logger.error(f"RAG status failed for agent {agent_id}: {e}")
        return AgentRAGStatusResponse(agent_id=agent_id, document_count=0)


# ---------------------------------------------------------------------------
# MCP Server CRUD
# ---------------------------------------------------------------------------

@app.get("/api/mcp-servers", response_model=list[McpServerSchema])
async def get_mcp_servers(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    servers = db.query(McpServerTable).filter(
        McpServerTable.owner_user_id == current_user.id
    ).all()
    return [_mcp_schema(s) for s in servers]


@app.post("/api/mcp-servers", response_model=McpServerSchema)
async def create_mcp_server(
    server_data: McpServerSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    # Check duplicate
    existing = db.query(McpServerTable).filter(McpServerTable.id == server_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="MCP Server already exists")
    
    new_server = McpServerTable(
        id=server_data.id,
        owner_user_id=current_user.id,
        name=server_data.name,
        type="streamable_http",
        url=server_data.url,
        headers=server_data.headers,
        created_at=server_data.createdAt,
        updated_at=server_data.updatedAt,
    )
    db.add(new_server)
    db.commit()
    db.refresh(new_server)
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)
        
    return _mcp_schema(new_server)


@app.put("/api/mcp-servers/{id}", response_model=McpServerSchema)
async def update_mcp_server(
    id: str,
    server_data: McpServerSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == current_user.id,
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    server.name = server_data.name
    server.type = "streamable_http"
    server.url = server_data.url
    server.headers = server_data.headers
    server.updated_at = server_data.updatedAt
    
    db.commit()
    db.refresh(server)
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)

    return _mcp_schema(server)


@app.delete("/api/mcp-servers/{id}")
async def delete_mcp_server(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    server = db.query(McpServerTable).filter(
        McpServerTable.id == id,
        McpServerTable.owner_user_id == current_user.id,
    ).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    _remove_agent_profile_links(db, current_user.id, "mcp_ids", [id])
    db.delete(server)
    db.commit()
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass
    _invalidate_runtime_caches(owner_user_id=current_user.id)

    return {"status": "success", "message": f"MCP Server {id} deleted"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Chat LangChain API Server",
        "version": "1.0.0",
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
            "voice_asr": "/api/asr/transcribe",
            "voice_session": "/ws/voice/session",
            "voice_asr_stream": "/ws/voice/asr",
            "voice_tts": "/ws/voice/tts",
        },
    }
