import logging
import os

from sqlalchemy import JSON, Column, String, Text, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Database URL configuration and engine creation
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # SQLAlchemy defaults to psycopg2. If using psycopg 3 (installed as psycopg),
    # we should use postgresql+psycopg://...
    if DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)
        
    logger.info("Connecting to database via DATABASE_URL")
    # Add pool_pre_ping=True to prevent connection drops in long-running app
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    # Fallback to local SQLite database
    logger.info("DATABASE_URL is not set. Falling back to local SQLite database.")
    sqlite_db_path = "./chat_langchain.db"
    # Need connect_args={"check_same_thread": False} for SQLite in FastAPI multi-threading
    engine = create_engine(
        f"sqlite:///{sqlite_db_path}",
        connect_args={"check_same_thread": False}
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ClientProfileTable(Base):
    """User profile metadata persistence."""
    __tablename__ = "client_profiles"

    id = Column(String(255), primary_key=True, index=True)
    label = Column(String(255), nullable=True)
    avatar_color = Column(String(50), nullable=True)
    created_at = Column(String(50), nullable=True)


class UserTable(Base):
    """User account credentials and information."""
    __tablename__ = "users"

    id = Column(String(255), primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    avatar_color = Column(String(50), nullable=True)
    # User's general preferences / instructions injected into agent system prompt
    preferences = Column(Text, nullable=True)
    # When true, agent is instructed to ask before executing dangerous actions
    safety_enabled = Column(String(10), nullable=True, default="false")
    created_at = Column(String(50), nullable=False)



class AgentProfileTable(Base):
    """Configurable Agent Profiles."""
    __tablename__ = "agent_profiles"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)
    # enabled_tools is a JSON list of builtin tool IDs, e.g., ["rag_search", "websearch"]
    enabled_tools = Column(JSON, nullable=False, default=list)
    # knowledge_base_ids is a JSON list of linked knowledge bases, e.g., ["kb_1", "kb_2"]
    knowledge_base_ids = Column(JSON, nullable=True, default=list)
    # skill_ids is a JSON list of linked skills, e.g., ["skill_1", "skill_2"]
    skill_ids = Column(JSON, nullable=True, default=list)
    # mcp_ids is a JSON list of linked MCP servers, e.g., ["mcp_1", "mcp_2"]
    mcp_ids = Column(JSON, nullable=True, default=list)
    # agent_ids is a JSON list of linked other agents, e.g., ["agent_1", "agent_2"]
    agent_ids = Column(JSON, nullable=True, default=list)
    # wake_words is a JSON list of wake word strings for KWS, e.g., ["小梯小梯", "hey assistant"]
    wake_words = Column(JSON, nullable=True, default=list)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


class SkillTable(Base):
    """Custom prompt-based system skills."""
    __tablename__ = "skills"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


class McpServerTable(Base):
    """MCP Server configurations."""
    __tablename__ = "mcp_servers"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)  # e.g. "sse" or "streamable_http"
    url = Column(String(2048), nullable=True)
    headers = Column(JSON, nullable=True, default=dict)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)



class KnowledgeBaseTable(Base):
    """Document collection for RAG capability."""
    __tablename__ = "knowledge_bases"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # files is a JSON list storing files uploaded to this KB,
    # e.g., [{"name": "file.pdf", "size": 12345, "uploadedAt": "2026-05-25..."}]
    files = Column(JSON, nullable=False, default=list)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


# ---------------------------------------------------------------------------
# Dependency for FastAPI endpoints
# ---------------------------------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
