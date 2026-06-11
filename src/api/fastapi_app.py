# FastAPI server for public Chat LangChain support endpoints
import asyncio
import copy
import hashlib
import json
import logging
import os
import re
import string
import time
from contextlib import asynccontextmanager, suppress

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.api.kws_router import kws_router
from src.api.langsmith_routes import router as langsmith_router
from src.api.voice_proxy import voice_router
from src.tools.robot_control_tool import receive_robot_result, register_robot_client

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_MODEL_LIST_CACHE: dict[tuple[str, str], tuple[float, dict]] = {}
_MODEL_LIST_CACHE_LOCK = asyncio.Lock()
_DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS = 300.0

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



from fastapi import Depends
from sqlalchemy.orm import Session

from src.utils.db import (
    AgentProfileTable,
    ClientProfileTable,
    KnowledgeBaseTable,
    McpServerTable,
    RobotPointTable,
    SkillTable,
    UserApiKeyTable,
    UserTable,
    UserVoiceprintTable,
    get_db,
)
from src.utils.default_skills import ensure_default_skills

# ---------------------------------------------------------------------------
# Pydantic Schemas for persistence
# ---------------------------------------------------------------------------

class ClientProfileSchema(BaseModel):
    id: str
    label: str | None = None
    avatarColor: str | None = None


class UserRegisterRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class UserLoginRequest(BaseModel):
    username: str
    password: str


class UserUpdateRequest(BaseModel):
    model_config = {"populate_by_name": True}

    username: str | None = None
    email: str | None = None
    preferences: str | None = None
    safety_enabled: bool | None = Field(default=None, alias="safetyEnabled")


class UserResponse(BaseModel):
    id: str
    username: str
    email: str | None = None
    avatarColor: str | None = None
    preferences: str | None = None
    safetyEnabled: bool = False
    createdAt: str


class UserApiKeySchema(BaseModel):
    id: str
    name: str
    keyPrefix: str
    createdAt: str
    lastUsedAt: str | None = None


class CreateUserApiKeyRequest(BaseModel):
    name: str


class CreateUserApiKeyResponse(UserApiKeySchema):
    apiKey: str



class AgentProfileSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    systemPrompt: str | None = None
    enabledTools: list[str] = []
    knowledgeBaseIds: list[str] = []
    skillIds: list[str] = []
    mcpIds: list[str] = []
    agentIds: list[str] = []
    wakeWords: list[str] = []
    roleTemplateId: str | None = None
    personaStyle: str | None = None
    boundaryMode: str | None = None
    ttsVoice: str | None = None
    voiceInterruptionEnabled: bool = True
    speakerVerificationEnabled: bool = False
    speakerVerificationBound: bool = False
    speakerSampleText: str | None = None
    speakerEnrolledAt: str | None = None
    userVoiceprintId: str | None = None
    createdAt: str
    updatedAt: str


class McpServerSchema(BaseModel):
    id: str
    name: str
    type: str  # Always "streamable_http"; kept for API compatibility.
    url: str | None = None
    headers: dict[str, str] = {}
    createdAt: str
    updatedAt: str


class SkillSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    content: str
    createdAt: str
    updatedAt: str


class KBFileSchema(BaseModel):
    name: str
    size: int
    uploadedAt: str


class KnowledgeBaseSchema(BaseModel):
    id: str
    name: str
    description: str | None = None
    files: list[KBFileSchema] = []
    isSystem: bool = False
    createdAt: str
    updatedAt: str


class AgentRAGStatusResponse(BaseModel):
    """RAG knowledge base status for an agent."""

    agent_id: str
    document_count: int


class RobotPointRequest(BaseModel):
    model_config = {"populate_by_name": True}

    point_name: str = Field(alias="pointName")
    introduction: str
    x: float
    y: float
    z: float
    rotation: float
    position_json: dict = Field(alias="positionJson")
    robot_sn: str | None = Field(default=None, alias="robotSn")


class RobotPointResponse(BaseModel):
    model_config = {"populate_by_name": True}

    id: int
    point_name: str = Field(alias="pointName")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class RobotPointListItem(BaseModel):
    model_config = {"populate_by_name": True}

    id: int
    point_name: str = Field(alias="pointName")
    introduction: str
    x: float
    y: float
    z: float
    rotation: float
    position_json: dict = Field(alias="positionJson")
    robot_sn: str | None = Field(default=None, alias="robotSn")


class RobotCommandResultRequest(BaseModel):
    model_config = {"populate_by_name": True}

    command_id: str = Field(alias="commandId")
    ok: bool
    message: str | None = None
    result: dict | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# User Authentication Helpers & Routes
# ---------------------------------------------------------------------------

import secrets
import uuid
from datetime import UTC, datetime

AVATAR_COLORS = [
    "#cc785c", # Coral
    "#a9583e", # Dark Coral
    "#2e5b82", # Blue
    "#347a5c", # Green
    "#8e562c", # Brown
    "#6b4c9a", # Purple
    "#cc5c8a", # Rose
    "#cc995c", # Sandy Gold
]

def hash_password(password: str) -> str:
    # 16-byte random salt
    salt = secrets.token_hex(16)
    # 100k iterations PBKDF2 HMAC SHA-256
    pwd_hash = hashlib.pbkdf2_hmac(
        'sha256', 
        password.encode('utf-8'), 
        salt.encode('utf-8'), 
        100000
    ).hex()
    return f"{salt}:{pwd_hash}"

def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt, pwd_hash = hashed_password.split(':')
        compare_hash = hashlib.pbkdf2_hmac(
            'sha256', 
            password.encode('utf-8'), 
            salt.encode('utf-8'), 
            100000
        ).hex()
        return pwd_hash == compare_hash
    except Exception:
        return False


def _extract_bearer_user_id(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_id = authorization.strip()
    if user_id.lower().startswith("bearer "):
        user_id = user_id.split(" ", 1)[1].strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    if user_id == "studio-user" or user_id.startswith("lsv2_"):
        raise HTTPException(status_code=401, detail="User login required")
    return user_id


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
        speakerVerificationBound=bool(profile.speaker_embedding) or bool(profile.user_voiceprint_id),
        speakerSampleText=profile.speaker_sample_text,
        speakerEnrolledAt=profile.speaker_enrolled_at,
        userVoiceprintId=profile.user_voiceprint_id,
        createdAt=profile.created_at,
        updatedAt=profile.updated_at,
    )


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


def _api_key_schema(api_key: UserApiKeyTable) -> UserApiKeySchema:
    return UserApiKeySchema(
        id=api_key.id,
        name=api_key.name,
        keyPrefix=api_key.key_prefix,
        createdAt=api_key.created_at,
        lastUsedAt=api_key.last_used_at,
    )


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserTable:
    """Require a logged-in account and return the authenticated user."""
    user_id = _extract_bearer_user_id(authorization)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid user")
    return user


def _require_same_user(current_user: UserTable, user_id: str) -> None:
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Cannot access another account")


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


@app.post("/api/robot-points", response_model=RobotPointResponse)
async def upsert_robot_point(
    point_data: RobotPointRequest,
    db: Session = Depends(get_db),
):
    point_name = point_data.point_name.strip()
    introduction = point_data.introduction.strip()
    if not point_name:
        raise HTTPException(status_code=400, detail="pointName is required")
    if not introduction:
        raise HTTPException(status_code=400, detail="introduction is required")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    point = db.query(RobotPointTable).filter(
        RobotPointTable.point_name == point_name,
    ).first()
    if point:
        point.introduction = introduction
        point.x = point_data.x
        point.y = point_data.y
        point.z = point_data.z
        point.rotation = point_data.rotation
        point.position_json = point_data.position_json
        point.robot_sn = point_data.robot_sn
        point.updated_at = now
    else:
        point = RobotPointTable(
            point_name=point_name,
            introduction=introduction,
            x=point_data.x,
            y=point_data.y,
            z=point_data.z,
            rotation=point_data.rotation,
            position_json=point_data.position_json,
            robot_sn=point_data.robot_sn,
            created_at=now,
            updated_at=now,
        )
        db.add(point)

    db.commit()
    db.refresh(point)
    return RobotPointResponse(
        id=point.id,
        pointName=point.point_name,
        createdAt=point.created_at,
        updatedAt=point.updated_at,
    )


@app.get("/api/robot-points", response_model=list[RobotPointListItem])
async def list_robot_points(db: Session = Depends(get_db)):
    points = db.query(RobotPointTable).order_by(RobotPointTable.id.asc()).all()
    return [
        RobotPointListItem(
            id=point.id,
            pointName=point.point_name,
            introduction=point.introduction,
            x=point.x,
            y=point.y,
            z=point.z,
            rotation=point.rotation,
            positionJson=point.position_json,
            robotSn=point.robot_sn,
        )
        for point in points
    ]


@app.put("/api/robot-points/{point_id}", response_model=RobotPointResponse)
async def update_robot_point(
    point_id: int,
    point_data: RobotPointRequest,
    db: Session = Depends(get_db),
):
    point_name = point_data.point_name.strip()
    introduction = point_data.introduction.strip()
    if not point_name:
        raise HTTPException(status_code=400, detail="pointName is required")
    if not introduction:
        raise HTTPException(status_code=400, detail="introduction is required")

    point = db.query(RobotPointTable).filter(RobotPointTable.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="robot point not found")

    duplicate = db.query(RobotPointTable).filter(
        RobotPointTable.point_name == point_name,
        RobotPointTable.id != point_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="pointName already exists")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    point.point_name = point_name
    point.introduction = introduction
    point.x = point_data.x
    point.y = point_data.y
    point.z = point_data.z
    point.rotation = point_data.rotation
    point.position_json = point_data.position_json
    point.robot_sn = point_data.robot_sn
    point.updated_at = now

    db.commit()
    db.refresh(point)
    return RobotPointResponse(
        id=point.id,
        pointName=point.point_name,
        createdAt=point.created_at,
        updatedAt=point.updated_at,
    )


@app.delete("/api/robot-points/{point_id}")
async def delete_robot_point(
    point_id: int,
    db: Session = Depends(get_db),
):
    point = db.query(RobotPointTable).filter(RobotPointTable.id == point_id).first()
    if not point:
        raise HTTPException(status_code=404, detail="robot point not found")

    db.delete(point)
    db.commit()
    return {"status": "success", "message": f"Robot point {point_id} deleted"}


@app.get("/api/robot/sse")
async def robot_sse(clientId: str = "robot-display"):
    async def event_stream():
        async for event in register_robot_client(clientId.strip() or "robot-display"):
            if event.get("type") == "heartbeat":
                yield f": heartbeat {event.get('timestamp')}\n\n"
                continue
            yield f"event: {event.get('type', 'message')}\n"
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/robot/commands/{command_id}/result")
async def robot_command_result(
    command_id: str,
    result_data: RobotCommandResultRequest,
):
    if result_data.command_id != command_id:
        raise HTTPException(status_code=400, detail="commandId mismatch")

    accepted = await receive_robot_result(
        command_id,
        {
            "ok": result_data.ok,
            "message": result_data.message,
            "result": result_data.result or {},
            "error": result_data.error,
            "commandId": command_id,
        },
    )
    return {"ok": accepted}


@app.post("/api/auth/register", response_model=UserResponse)
async def register_user(req: UserRegisterRequest, db: Session = Depends(get_db)):
    # Check if username already exists
    existing_user = db.query(UserTable).filter(UserTable.username == req.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Generate UUID and a random nice avatar color
    user_id = f"user-{uuid.uuid4()}"
    avatar_color = secrets.choice(AVATAR_COLORS)
    hashed_pwd = hash_password(req.password)
    
    user = UserTable(
        id=user_id,
        username=req.username,
        password_hash=hashed_pwd,
        email=req.email,
        avatar_color=avatar_color,
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    ensure_default_skills(db, user.id)
    db.commit()
    
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@app.post("/api/auth/login", response_model=UserResponse)
async def login_user(req: UserLoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserTable).filter(UserTable.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@app.get("/api/auth/users/{user_id}", response_model=UserResponse)
async def get_user_profile(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@app.put("/api/auth/users/{user_id}", response_model=UserResponse)
async def update_user_profile(
    user_id: str,
    req: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _require_same_user(current_user, user_id)
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if req.username is not None and req.username != user.username:
        raise HTTPException(status_code=400, detail="Username cannot be changed")

    if req.email is not None:
        user.email = req.email
    if req.preferences is not None:
        user.preferences = req.preferences
    if req.safety_enabled is not None:
        user.safety_enabled = "true" if req.safety_enabled else "false"

    db.commit()
    db.refresh(user)

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatarColor=user.avatar_color,
        preferences=getattr(user, 'preferences', None),
        safetyEnabled=getattr(user, 'safety_enabled', 'false') == 'true',
        createdAt=user.created_at,
    )


@app.get("/api/auth/api-keys", response_model=list[UserApiKeySchema])
async def list_user_api_keys(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    keys = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.owner_user_id == current_user.id,
    ).all()
    return [_api_key_schema(key) for key in keys]


@app.post("/api/auth/api-keys", response_model=CreateUserApiKeyResponse)
async def create_user_api_key(
    req: CreateUserApiKeyRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    key_name = req.name.strip()
    if not key_name:
        raise HTTPException(status_code=400, detail="API key name is required")

    raw_key = f"tob_{secrets.token_urlsafe(32)}"
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    api_key = UserApiKeyTable(
        id=f"apikey-{uuid.uuid4()}",
        owner_user_id=current_user.id,
        name=key_name,
        key_hash=hash_api_key(raw_key),
        key_prefix=f"{raw_key[:8]}...",
        created_at=now,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    return CreateUserApiKeyResponse(
        **_api_key_schema(api_key).model_dump(),
        apiKey=raw_key,
    )


@app.delete("/api/auth/api-keys/{key_id}")
async def delete_user_api_key(
    key_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    api_key = db.query(UserApiKeyTable).filter(
        UserApiKeyTable.id == key_id,
        UserApiKeyTable.owner_user_id == current_user.id,
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    db.delete(api_key)
    db.commit()
    return {"ok": True}


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
    
    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, current_user.id)
    return _agent_profile_schema(profile)


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


# ---------------------------------------------------------------------------
# Model listing proxy (keeps API keys server-side)
# ---------------------------------------------------------------------------


def _get_model_list_cache_ttl_seconds() -> float:
    """Return the configured model-list cache TTL in seconds."""
    raw_ttl = os.getenv("MODEL_LIST_CACHE_TTL_SECONDS", "").strip()
    if not raw_ttl:
        return _DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS

    try:
        return max(float(raw_ttl), 0.0)
    except ValueError:
        logger.warning("Invalid MODEL_LIST_CACHE_TTL_SECONDS=%r; using default", raw_ttl)
        return _DEFAULT_MODEL_LIST_CACHE_TTL_SECONDS


def _get_model_list_cache_key(base_url: str, api_key: str) -> tuple[str, str]:
    """Build a cache key without storing the raw API key."""
    api_key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest() if api_key else ""
    return (base_url.rstrip("/"), api_key_hash)


def clear_model_list_cache() -> None:
    """Clear the backend model-list cache."""
    _MODEL_LIST_CACHE.clear()


@app.get("/api/models")
async def list_models():
    """Proxy to the OpenAI-compatible /models endpoint.

    Reads OPENAI base URL and API key from server-side env vars so that
    the frontend never sees the API key.
    """
    base_url = (
        os.getenv("OPENAI_COMPATIBLE_BASE_URL", "").strip()
        or os.getenv("NEXT_PUBLIC_OPENAI_BASE_URL", "").strip()
    )
    api_key = (
        os.getenv("OPENAI_COMPATIBLE_API_KEY", "").strip()
        or os.getenv("NEXT_PUBLIC_OPENAI_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )

    if not base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL is not configured on the server")

    cache_ttl_seconds = _get_model_list_cache_ttl_seconds()
    cache_key = _get_model_list_cache_key(base_url, api_key)
    now = time.monotonic()
    if cache_ttl_seconds > 0:
        cached = _MODEL_LIST_CACHE.get(cache_key)
        if cached and now - cached[0] < cache_ttl_seconds:
            return copy.deepcopy(cached[1])

    url = f"{base_url.rstrip('/')}/models"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with _MODEL_LIST_CACHE_LOCK:
            if cache_ttl_seconds > 0:
                cached = _MODEL_LIST_CACHE.get(cache_key)
                now = time.monotonic()
                if cached and now - cached[0] < cache_ttl_seconds:
                    return copy.deepcopy(cached[1])

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                payload = resp.json()

            if cache_ttl_seconds > 0:
                _MODEL_LIST_CACHE[cache_key] = (time.monotonic(), copy.deepcopy(payload))

            return payload
    except httpx.HTTPStatusError as e:
        logger.error(f"Upstream /models returned {e.response.status_code}: {e.response.text[:200]}")
        raise HTTPException(status_code=e.response.status_code, detail="Upstream model list request failed")
    except Exception as e:
        logger.error(f"Failed to proxy /models: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to reach model API: {e}")


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
