# FastAPI server for public Chat LangChain support endpoints
import asyncio
import logging
import os
import re
import string
from contextlib import asynccontextmanager, suppress
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.api.kws_router import kws_router
from src.api.langsmith_routes import router as langsmith_router
from src.api.voice_proxy import voice_router

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_CORS_ORIGINS: list[str] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
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
        from src.utils.db import Base, engine
        Base.metadata.create_all(bind=engine)
        logger.info("SQLAlchemy tables verified/created successfully on startup.")

        # Add missing columns using IF NOT EXISTS (PostgreSQL 9.6+).
        # This avoids transaction-poisoning: a failed ALTER TABLE in PostgreSQL
        # aborts the whole transaction, but IF NOT EXISTS always succeeds (no-op
        # when the column already exists), keeping the transaction valid.
        from sqlalchemy import text

        _migrations = [
            "ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS skill_ids JSON",
            "ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS mcp_ids JSON",
            "ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS agent_ids JSON",
            "ALTER TABLE mcp_servers ADD COLUMN IF NOT EXISTS headers JSON",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS safety_enabled VARCHAR(10) DEFAULT 'false'",
            "ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS wake_words JSON",
        ]

        with engine.connect() as conn:
            for ddl in _migrations:
                try:
                    conn.execute(text(ddl))
                    logger.info(f"Migration OK: {ddl}")
                except Exception as e:
                    logger.warning(f"Migration skipped: {ddl} — {e}")
            conn.commit()

        logger.info("Database schema migration completed.")

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
    allow_origin_regex=".*",
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
    SkillTable,
    UserTable,
    get_db,
)

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
    createdAt: str
    updatedAt: str


class McpServerSchema(BaseModel):
    id: str
    name: str
    type: str  # "sse"
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
    createdAt: str
    updatedAt: str


class AgentRAGStatusResponse(BaseModel):
    """RAG knowledge base status for an agent."""

    agent_id: str
    document_count: int


# ---------------------------------------------------------------------------
# User Authentication Helpers & Routes
# ---------------------------------------------------------------------------

import hashlib
import secrets
import uuid
from datetime import datetime

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
async def get_user_profile(user_id: str, db: Session = Depends(get_db)):
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
async def update_user_profile(user_id: str, req: UserUpdateRequest, db: Session = Depends(get_db)):
    user = db.query(UserTable).filter(UserTable.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check username uniqueness if changing
    if req.username is not None and req.username != user.username:
        existing = db.query(UserTable).filter(
            UserTable.username == req.username,
            UserTable.id != user_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        user.username = req.username

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


# ---------------------------------------------------------------------------
# Client Profile CRUD
# ---------------------------------------------------------------------------

@app.get("/api/client-profiles/{id}", response_model=Optional[ClientProfileSchema])
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
async def get_agent_profiles(db: Session = Depends(get_db)):
    profiles = db.query(AgentProfileTable).all()
    return [
        AgentProfileSchema(
            id=p.id,
            name=p.name,
            description=p.description,
            systemPrompt=p.system_prompt,
            enabledTools=p.enabled_tools or [],
            knowledgeBaseIds=p.knowledge_base_ids or [],
            skillIds=p.skill_ids or [],
            mcpIds=p.mcp_ids or [],
            agentIds=p.agent_ids or [],
            wakeWords=p.wake_words or [],
            createdAt=p.created_at,
            updatedAt=p.updated_at,
        )
        for p in profiles
    ]


@app.post("/api/agent-profiles", response_model=AgentProfileSchema)
async def create_agent_profile(profile_data: AgentProfileSchema, db: Session = Depends(get_db)):
    # Check duplicate
    existing = db.query(AgentProfileTable).filter(AgentProfileTable.id == profile_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent profile already exists")
    
    new_profile = AgentProfileTable(
        id=profile_data.id,
        name=profile_data.name,
        description=profile_data.description,
        system_prompt=profile_data.systemPrompt,
        enabled_tools=profile_data.enabledTools,
        knowledge_base_ids=profile_data.knowledgeBaseIds,
        skill_ids=profile_data.skillIds,
        mcp_ids=profile_data.mcpIds,
        agent_ids=profile_data.agentIds,
        wake_words=profile_data.wakeWords,
        created_at=profile_data.createdAt,
        updated_at=profile_data.updatedAt,
    )
    db.add(new_profile)
    db.commit()
    db.refresh(new_profile)
    return AgentProfileSchema(
        id=new_profile.id,
        name=new_profile.name,
        description=new_profile.description,
        systemPrompt=new_profile.system_prompt,
        enabledTools=new_profile.enabled_tools or [],
        knowledgeBaseIds=new_profile.knowledge_base_ids or [],
        skillIds=new_profile.skill_ids or [],
        mcpIds=new_profile.mcp_ids or [],
        agentIds=new_profile.agent_ids or [],
        wakeWords=new_profile.wake_words or [],
        createdAt=new_profile.created_at,
        updatedAt=new_profile.updated_at,
    )


@app.put("/api/agent-profiles/{id}", response_model=AgentProfileSchema)
async def update_agent_profile(id: str, profile_data: AgentProfileSchema, db: Session = Depends(get_db)):
    profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    profile.name = profile_data.name
    profile.description = profile_data.description
    profile.system_prompt = profile_data.systemPrompt
    profile.enabled_tools = profile_data.enabledTools
    profile.knowledge_base_ids = profile_data.knowledgeBaseIds
    profile.skill_ids = profile_data.skillIds
    profile.mcp_ids = profile_data.mcpIds
    profile.agent_ids = profile_data.agentIds
    profile.wake_words = profile_data.wakeWords
    profile.updated_at = profile_data.updatedAt
    
    db.commit()
    db.refresh(profile)
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
        createdAt=profile.created_at,
        updatedAt=profile.updated_at,
    )


@app.delete("/api/agent-profiles/{id}")
async def delete_agent_profile(id: str, db: Session = Depends(get_db)):
    profile = db.query(AgentProfileTable).filter(AgentProfileTable.id == id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    db.delete(profile)
    db.commit()
    return {"status": "success", "message": f"Agent profile {id} deleted"}


# ---------------------------------------------------------------------------
# Skill CRUD
# ---------------------------------------------------------------------------

@app.get("/api/skills", response_model=list[SkillSchema])
async def get_skills(db: Session = Depends(get_db)):
    skills = db.query(SkillTable).all()
    return [
        SkillSchema(
            id=s.id,
            name=s.name,
            description=s.description,
            content=s.content,
            createdAt=s.created_at,
            updatedAt=s.updated_at,
        )
        for s in skills
    ]


@app.post("/api/skills", response_model=SkillSchema)
async def create_skill(skill_data: SkillSchema, db: Session = Depends(get_db)):
    existing = db.query(SkillTable).filter(SkillTable.id == skill_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Skill already exists")
    
    new_skill = SkillTable(
        id=skill_data.id,
        name=skill_data.name,
        description=skill_data.description,
        content=skill_data.content,
        created_at=skill_data.createdAt,
        updated_at=skill_data.updatedAt,
    )
    db.add(new_skill)
    db.commit()
    db.refresh(new_skill)
    return SkillSchema(
        id=new_skill.id,
        name=new_skill.name,
        description=new_skill.description,
        content=new_skill.content,
        createdAt=new_skill.created_at,
        updatedAt=new_skill.updated_at,
    )


@app.put("/api/skills/{id}", response_model=SkillSchema)
async def update_skill(id: str, skill_data: SkillSchema, db: Session = Depends(get_db)):
    skill = db.query(SkillTable).filter(SkillTable.id == id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    
    skill.name = skill_data.name
    skill.description = skill_data.description
    skill.content = skill_data.content
    skill.updated_at = skill_data.updatedAt
    
    db.commit()
    db.refresh(skill)
    return SkillSchema(
        id=skill.id,
        name=skill.name,
        description=skill.description,
        content=skill.content,
        createdAt=skill.created_at,
        updatedAt=skill.updated_at,
    )


@app.delete("/api/skills/{id}")
async def delete_skill(id: str, db: Session = Depends(get_db)):
    skill = db.query(SkillTable).filter(SkillTable.id == id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    db.delete(skill)
    db.commit()
    return {"status": "success", "message": f"Skill {id} deleted"}


# ---------------------------------------------------------------------------
# Knowledge Base CRUD & Upload
# ---------------------------------------------------------------------------

@app.get("/api/knowledge-bases", response_model=list[KnowledgeBaseSchema])
async def get_knowledge_bases(db: Session = Depends(get_db)):
    kbs = db.query(KnowledgeBaseTable).all()
    return [
        KnowledgeBaseSchema(
            id=k.id,
            name=k.name,
            description=k.description,
            files=[KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"]) for f in k.files or []],
            createdAt=k.created_at,
            updatedAt=k.updated_at,
        )
        for k in kbs
    ]


@app.post("/api/knowledge-bases", response_model=KnowledgeBaseSchema)
async def create_knowledge_base(kb_data: KnowledgeBaseSchema, db: Session = Depends(get_db)):
    existing = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Knowledge Base already exists")
    
    # Map Pydantic files models to raw JSON dict list
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    new_kb = KnowledgeBaseTable(
        id=kb_data.id,
        name=kb_data.name,
        description=kb_data.description,
        files=db_files,
        created_at=kb_data.createdAt,
        updated_at=kb_data.updatedAt,
    )
    db.add(new_kb)
    db.commit()
    db.refresh(new_kb)
    return KnowledgeBaseSchema(
        id=new_kb.id,
        name=new_kb.name,
        description=new_kb.description,
        files=[KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"]) for f in new_kb.files or []],
        createdAt=new_kb.created_at,
        updatedAt=new_kb.updated_at,
    )


@app.put("/api/knowledge-bases/{id}", response_model=KnowledgeBaseSchema)
async def update_knowledge_base(id: str, kb_data: KnowledgeBaseSchema, db: Session = Depends(get_db)):
    kb = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == id).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")
    
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    kb.name = kb_data.name
    kb.description = kb_data.description
    kb.files = db_files
    kb.updated_at = kb_data.updatedAt
    
    db.commit()
    db.refresh(kb)
    return KnowledgeBaseSchema(
        id=kb.id,
        name=kb.name,
        description=kb.description,
        files=[KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"]) for f in kb.files or []],
        createdAt=kb.created_at,
        updatedAt=kb.updated_at,
    )


@app.delete("/api/knowledge-bases/{id}")
async def delete_knowledge_base(id: str, db: Session = Depends(get_db)):
    kb = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == id).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")
    
    # Try to drop/delete matching table in LanceDB if it exists
    try:
        from src.tools.rag_tool import _get_db, _table_name
        lancedb_instance = _get_db()
        tname = _table_name(id)
        if tname in lancedb_instance.table_names():
            lancedb_instance.drop_table(tname)
            logger.info(f"Dropped LanceDB table '{tname}' for Knowledge Base {id}")
    except Exception as e:
        logger.error(f"Failed to drop LanceDB table for KB {id}: {e}")

    db.delete(kb)
    db.commit()
    return {"status": "success", "message": f"Knowledge base {id} and associated LanceDB table deleted"}


def _sync_load_document(filename: str, content_type: str, raw: bytes) -> str:
    """Synchronous helper to import loaders, write temp files, and parse.
    
    Runs completely in a thread pool via asyncio.to_thread to avoid blocking ASGI event loop.
    """
    import pathlib
    import tempfile
    
    fname_lower = filename.lower()
    
    if content_type == "application/pdf" or fname_lower.endswith(".pdf"):
        suffix = ".pdf"
        from langchain_community.document_loaders import PyPDFLoader
        loader_cls = PyPDFLoader
        loader_kwargs = {}
    elif (
        content_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        )
        or fname_lower.endswith(".docx")
        or fname_lower.endswith(".doc")
    ):
        suffix = ".docx"
        from langchain_community.document_loaders import Docx2txtLoader
        loader_cls = Docx2txtLoader
        loader_kwargs = {}
    elif fname_lower.endswith(".csv"):
        suffix = ".csv"
        from langchain_community.document_loaders import CSVLoader
        loader_cls = CSVLoader
        loader_kwargs = {}
    else:
        suffix = pathlib.Path(filename or "file.txt").suffix or ".txt"
        from langchain_community.document_loaders import TextLoader
        loader_cls = TextLoader
        loader_kwargs = {"encoding": "utf-8"}

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
        
    try:
        loader = loader_cls(tmp_path, **loader_kwargs)
        docs = loader.load()
        return "\n\n".join(d.page_content for d in docs)
    finally:
        pathlib.Path(tmp_path).unlink(missing_ok=True)


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
):
    """Upload document directly to a shared knowledge base (RAG).
    
    Extracts text, splits into chunks, embeds and saves to LanceDB.
    Also records file metadata under the KB in PostgreSQL.
    """
    kb = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_id).first()
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

        return {
            "kb_id": kb_id,
            "chunks_ingested": n,
            "filename": file.filename,
            "knowledge_base": KnowledgeBaseSchema(
                id=kb.id,
                name=kb.name,
                description=kb.description,
                files=[KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"]) for f in kb.files or []],
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
    db: Session = Depends(get_db)
):
    """Delete a file from the Knowledge Base.
    
    Removes vector data from LanceDB and deletes metadata from PostgreSQL.
    """
    kb = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_id).first()
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

        return {
            "status": "success",
            "kb_id": kb_id,
            "filename": filename,
            "knowledge_base": KnowledgeBaseSchema(
                id=kb.id,
                name=kb.name,
                description=kb.description,
                files=[KBFileSchema(name=f["name"], size=f["size"], uploadedAt=f["uploadedAt"]) for f in kb.files or []],
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
):
    """Upload a document to the agent's RAG knowledge base.

    Accepts plain text, markdown, and PDF files.
    Splits into chunks, embeds, and stores in LanceDB.
    """
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
async def rag_status(agent_id: str):
    """Return the number of documents in the agent's RAG knowledge base."""
    import asyncio

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
async def get_mcp_servers(db: Session = Depends(get_db)):
    servers = db.query(McpServerTable).all()
    return [
        McpServerSchema(
            id=s.id,
            name=s.name,
            type=s.type,
            url=s.url,
            headers=s.headers or {},
            createdAt=s.created_at,
            updatedAt=s.updated_at,
        )
        for s in servers
    ]


@app.post("/api/mcp-servers", response_model=McpServerSchema)
async def create_mcp_server(server_data: McpServerSchema, db: Session = Depends(get_db)):
    # Check duplicate
    existing = db.query(McpServerTable).filter(McpServerTable.id == server_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="MCP Server already exists")
    
    new_server = McpServerTable(
        id=server_data.id,
        name=server_data.name,
        type=server_data.type,
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
        
    return McpServerSchema(
        id=new_server.id,
        name=new_server.name,
        type=new_server.type,
        url=new_server.url,
        headers=new_server.headers or {},
        createdAt=new_server.created_at,
        updatedAt=new_server.updated_at,
    )


@app.put("/api/mcp-servers/{id}", response_model=McpServerSchema)
async def update_mcp_server(id: str, server_data: McpServerSchema, db: Session = Depends(get_db)):
    server = db.query(McpServerTable).filter(McpServerTable.id == id).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    server.name = server_data.name
    server.type = server_data.type
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

    return McpServerSchema(
        id=server.id,
        name=server.name,
        type=server.type,
        url=server.url,
        headers=server.headers or {},
        createdAt=server.created_at,
        updatedAt=server.updated_at,
    )


@app.delete("/api/mcp-servers/{id}")
async def delete_mcp_server(id: str, db: Session = Depends(get_db)):
    server = db.query(McpServerTable).filter(McpServerTable.id == id).first()
    if not server:
        raise HTTPException(status_code=404, detail="MCP Server not found")
    
    db.delete(server)
    db.commit()
    
    # Clear pool cache on updates to trigger reloading
    try:
        from src.utils.mcp import McpPoolManager
        McpPoolManager.clear_cache()
    except Exception:
        pass

    return {"status": "success", "message": f"MCP Server {id} deleted"}


# ---------------------------------------------------------------------------
# Model listing proxy (keeps API keys server-side)
# ---------------------------------------------------------------------------

@app.get("/api/models")
async def list_models():
    """Proxy to the OpenAI-compatible /models endpoint.

    Reads OPENAI base URL and API key from server-side env vars so that
    the frontend never sees the API key.
    """
    base_url = (
        os.getenv("NEXT_PUBLIC_OPENAI_BASE_URL", "").strip()
        or os.getenv("OPENAI_COMPATIBLE_BASE_URL", "").strip()
    )
    api_key = (
        os.getenv("NEXT_PUBLIC_OPENAI_API_KEY", "").strip()
        or os.getenv("OPENAI_COMPATIBLE_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )

    if not base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL is not configured on the server")

    url = f"{base_url.rstrip('/')}/models"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()
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
            "voice_tts": "/ws/voice/tts",
        },
    }
