"""Database engine configuration and SQLAlchemy models."""

import logging
import os
from urllib.parse import quote_plus

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Float,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Database URL configuration and engine creation
# ---------------------------------------------------------------------------
def _normalize_database_url(database_url: str) -> str:
    """Return a SQLAlchemy URL using the installed PostgreSQL driver."""
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


def _database_url_from_postgres_env() -> str | None:
    """Build a PostgreSQL URL from Aegra/docker-compose POSTGRES_* settings."""
    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    database = os.getenv("POSTGRES_DB")
    host = os.getenv("POSTGRES_HOST")
    port = os.getenv("POSTGRES_PORT", "5432")

    if not all([user, password, database, host]):
        return None

    return (
        f"postgresql+psycopg://{quote_plus(user)}:{quote_plus(password)}@"
        f"{host}:{port}/{quote_plus(database)}"
    )


DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    DATABASE_URL = _normalize_database_url(DATABASE_URL)
    logger.info("Connecting to database via DATABASE_URL")
    # Add pool_pre_ping=True to prevent connection drops in long-running app
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
elif postgres_database_url := _database_url_from_postgres_env():
    logger.info("DATABASE_URL is not set. Connecting via POSTGRES_* environment variables.")
    engine = create_engine(postgres_database_url, pool_pre_ping=True)
else:
    # Fallback to local SQLite database
    logger.info("DATABASE_URL and POSTGRES_* are not set. Falling back to local SQLite database.")
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


class UserApiKeyTable(Base):
    """User-scoped API keys for remote LangGraph SDK calls."""
    __tablename__ = "user_api_keys"

    id = Column(String(255), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    key_hash = Column(String(64), unique=True, index=True, nullable=False)
    key_prefix = Column(String(32), nullable=False)
    created_at = Column(String(50), nullable=False)
    last_used_at = Column(String(50), nullable=True)



class AgentProfileTable(Base):
    """Configurable Agent Profiles."""
    __tablename__ = "agent_profiles"

    id = Column(String(255), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)
    # enabled_tools is a JSON list of builtin tool IDs, e.g., ["rag_search", "fetch"]
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
    role_template_id = Column(String(100), nullable=True)
    persona_style = Column(String(50), nullable=True)
    boundary_mode = Column(String(50), nullable=True)
    tts_voice = Column(String(100), nullable=True)
    voice_interruption_enabled = Column(Boolean, nullable=False, default=True)
    # Persisted voiceprint binding for optional per-agent speaker verification.
    speaker_verification_enabled = Column(Boolean, nullable=False, default=False)
    speaker_embedding = Column(JSON, nullable=True)
    speaker_sample_text = Column(Text, nullable=True)
    speaker_enrolled_at = Column(String(50), nullable=True)
    # Reference to a user-level voiceprint (user_voiceprints.id) for speaker verification.
    user_voiceprint_id = Column(String(50), nullable=True)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


class UserVoiceprintTable(Base):
    """User-level speaker voiceprints for speaker verification."""
    __tablename__ = "user_voiceprints"

    id = Column(String(50), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=False)
    name = Column(String(200), nullable=False, default="My Voiceprint")
    embedding = Column(JSON, nullable=False)
    sample_text = Column(Text, nullable=True)
    enrolled_at = Column(String(50), nullable=True)
    created_at = Column(String(50), nullable=False)


class SkillTable(Base):
    """Custom prompt-based system skills."""
    __tablename__ = "skills"

    id = Column(String(255), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=False)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


class McpServerTable(Base):
    """MCP Server configurations."""
    __tablename__ = "mcp_servers"

    id = Column(String(255), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)  # Always "streamable_http"; kept for compatibility.
    url = Column(String(2048), nullable=True)
    headers = Column(JSON, nullable=True, default=dict)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)



class KnowledgeBaseTable(Base):
    """Document collection for RAG capability."""
    __tablename__ = "knowledge_bases"

    id = Column(String(255), primary_key=True, index=True)
    owner_user_id = Column(String(255), index=True, nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # files is a JSON list storing files uploaded to this KB,
    # e.g., [{"name": "file.pdf", "size": 12345, "uploadedAt": "2026-05-25..."}]
    files = Column(JSON, nullable=False, default=list)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


class RobotPointTable(Base):
    """Saved robot navigation point metadata."""
    __tablename__ = "robot_points"

    id = Column(Integer, primary_key=True, autoincrement=True)
    point_name = Column(String(255), unique=True, index=True, nullable=False)
    introduction = Column(Text, nullable=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    z = Column(Float, nullable=False)
    rotation = Column(Float, nullable=False)
    position_json = Column(JSON, nullable=False)
    robot_sn = Column(String(255), nullable=True)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)


def _add_column_if_missing(table_name: str, column_name: str, column_sql: str) -> None:
    """Add a column when it is absent, using dialect-compatible DDL."""
    inspector = inspect(engine)
    if table_name not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
    if column_name in existing_columns:
        return

    ddl = f"ALTER TABLE {table_name} ADD COLUMN {column_sql}"
    with engine.begin() as conn:
        conn.execute(text(ddl))
    logger.info("Migration OK: %s", ddl)


def ensure_database_schema() -> None:
    """Create tables and apply lightweight additive schema migrations."""
    Base.metadata.create_all(bind=engine)
    logger.info("SQLAlchemy tables verified/created successfully.")

    migrations = [
        ("agent_profiles", "skill_ids", "skill_ids JSON"),
        ("agent_profiles", "mcp_ids", "mcp_ids JSON"),
        ("agent_profiles", "agent_ids", "agent_ids JSON"),
        ("mcp_servers", "headers", "headers JSON"),
        ("users", "preferences", "preferences TEXT"),
        ("users", "safety_enabled", "safety_enabled VARCHAR(10) DEFAULT 'false'"),
        ("agent_profiles", "wake_words", "wake_words JSON"),
        ("agent_profiles", "role_template_id", "role_template_id VARCHAR(100)"),
        ("agent_profiles", "persona_style", "persona_style VARCHAR(50)"),
        ("agent_profiles", "boundary_mode", "boundary_mode VARCHAR(50)"),
        ("agent_profiles", "tts_voice", "tts_voice VARCHAR(100)"),
        (
            "agent_profiles",
            "voice_interruption_enabled",
            "voice_interruption_enabled BOOLEAN DEFAULT TRUE",
        ),
        (
            "agent_profiles",
            "speaker_verification_enabled",
            "speaker_verification_enabled BOOLEAN DEFAULT FALSE",
        ),
        ("agent_profiles", "speaker_embedding", "speaker_embedding JSON"),
        ("agent_profiles", "speaker_sample_text", "speaker_sample_text TEXT"),
        ("agent_profiles", "speaker_enrolled_at", "speaker_enrolled_at VARCHAR(50)"),
        ("agent_profiles", "owner_user_id", "owner_user_id VARCHAR(255)"),
        ("skills", "owner_user_id", "owner_user_id VARCHAR(255)"),
        ("knowledge_bases", "owner_user_id", "owner_user_id VARCHAR(255)"),
        ("mcp_servers", "owner_user_id", "owner_user_id VARCHAR(255)"),
        ("agent_profiles", "user_voiceprint_id", "user_voiceprint_id VARCHAR(50)"),
    ]

    for table_name, column_name, column_sql in migrations:
        try:
            _add_column_if_missing(table_name, column_name, column_sql)
        except Exception as exc:
            logger.warning(
                "Migration skipped for %s.%s: %s",
                table_name,
                column_name,
                exc,
            )

    Base.metadata.create_all(bind=engine)
    logger.info("Database schema migration completed.")


# ---------------------------------------------------------------------------
# Dependency for FastAPI endpoints
# ---------------------------------------------------------------------------
def get_db():
    """Yield a database session for FastAPI dependency injection."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
