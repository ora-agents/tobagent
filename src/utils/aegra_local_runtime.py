"""Local SQLite-backed runtime adapter for Aegra desktop builds."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import aiosqlite
from sqlalchemy import event, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.schema import DefaultClause

logger = logging.getLogger(__name__)


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(_type: JSONB, _compiler: Any, **_kw: Any) -> str:
    """Compile Aegra's PostgreSQL JSONB columns as SQLite JSON columns."""
    return "JSON"


def _patch_aegra_sqlite_metadata_defaults() -> None:
    """Replace PostgreSQL-only ORM defaults with SQLite-compatible defaults."""
    from aegra_api.core.orm import Base

    replacements = {
        "gen_random_uuid": "lower(hex(randomblob(16)))",
        "now()": "CURRENT_TIMESTAMP",
        "'{}'::jsonb": "'{}'",
    }

    for table in Base.metadata.tables.values():
        for column in table.columns:
            default = column.server_default
            if default is None:
                continue

            raw = str(getattr(default, "arg", ""))
            replacement = None
            for needle, value in replacements.items():
                if needle in raw:
                    replacement = value
                    break
            if replacement is None and raw == "true":
                replacement = "1"

            if replacement is not None:
                column.server_default = DefaultClause(text(replacement))


class LocalAegraDatabaseManager:
    """Aegra db_manager replacement backed by local SQLite files."""

    def __init__(self, data_dir: Path) -> None:
        """Create a manager rooted at the given local data directory."""
        self.data_dir = data_dir
        self.metadata_path = data_dir / "aegra_metadata.db"
        self.checkpoint_path = data_dir / "aegra_checkpoints.db"
        self.store_path = data_dir / "aegra_store.db"
        self.engine: AsyncEngine | None = None
        self._checkpoint_conn: aiosqlite.Connection | None = None
        self._store_conn: aiosqlite.Connection | None = None
        self._checkpointer: Any | None = None
        self._store: Any | None = None

    async def initialize(self) -> None:
        """Initialize SQLite metadata, checkpoint, and store databases."""
        if self.engine is not None:
            return

        self.data_dir.mkdir(parents=True, exist_ok=True)
        _patch_aegra_sqlite_metadata_defaults()

        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{self.metadata_path.as_posix()}",
            pool_pre_ping=True,
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def _configure_sqlite_connection(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

        from aegra_api.core.orm import Base

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from langgraph.store.sqlite.aio import AsyncSqliteStore

        self._checkpoint_conn = await aiosqlite.connect(self.checkpoint_path.as_posix())
        self._checkpointer = AsyncSqliteSaver(self._checkpoint_conn)
        await self._checkpointer.setup()

        self._store_conn = await aiosqlite.connect(
            self.store_path.as_posix(),
            isolation_level=None,
        )
        self._store = AsyncSqliteStore(self._store_conn)
        await self._store.setup()

        logger.info(
            "Initialized local Aegra SQLite runtime: metadata=%s checkpoints=%s store=%s",
            self.metadata_path,
            self.checkpoint_path,
            self.store_path,
        )

    async def close(self) -> None:
        """Close all local database connections."""
        if self.engine is not None:
            await self.engine.dispose()
            self.engine = None

        if self._checkpoint_conn is not None:
            await self._checkpoint_conn.close()
            self._checkpoint_conn = None
            self._checkpointer = None

        if self._store_conn is not None:
            await self._store_conn.close()
            self._store_conn = None
            self._store = None

    def get_engine(self) -> AsyncEngine:
        """Return the initialized SQLAlchemy engine."""
        if self.engine is None:
            raise RuntimeError("Local Aegra database is not initialized")
        return self.engine

    def get_checkpointer(self) -> Any:
        """Return the initialized SQLite checkpointer."""
        if self._checkpointer is None:
            raise RuntimeError("Local Aegra checkpointer is not initialized")
        return self._checkpointer

    def get_store(self) -> Any:
        """Return the initialized SQLite store."""
        if self._store is None:
            raise RuntimeError("Local Aegra store is not initialized")
        return self._store


def install_local_aegra_database_manager(data_dir: Path) -> LocalAegraDatabaseManager:
    """Install a local SQLite db_manager before importing aegra_api.main."""
    import aegra_api.core.database as database
    import aegra_api.core.orm as orm

    manager = LocalAegraDatabaseManager(data_dir)
    database.db_manager = manager
    orm.async_session_maker = None
    return manager
