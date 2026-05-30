"""Import bundled assets into shared system knowledge bases."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
import re
from datetime import datetime
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy.orm import Session

from src.tools.rag_tool import ingest_documents_async
from src.utils.db import AgentProfileTable, KnowledgeBaseTable, SessionLocal
from src.utils.document_loader import load_document_bytes

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).parents[2] / "assets"
DEFAULT_AGENT_ID_PREFIX = "default_"
DEFAULT_AGENT_NAME = "默认系统智能体"
DEFAULT_AGENT_DESCRIPTION = "预配置的文档助手智能体。"
DEFAULT_AGENT_PROMPT = "You are a helpful assistant."
DEFAULT_AGENT_TOOLS = ["rag_search", "fetch"]


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _slug(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("_").lower()
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return f"{slug}_{digest}" if slug else digest


def _owner_hash(owner_user_id: str) -> str:
    return hashlib.sha1(owner_user_id.encode("utf-8")).hexdigest()[:12]


def default_agent_profile_id(owner_user_id: str) -> str:
    """Return the stable database id for a user's editable default agent."""
    return f"{DEFAULT_AGENT_ID_PREFIX}{_owner_hash(owner_user_id)}"


def is_default_agent_profile_id(agent_id: str) -> bool:
    """Return whether an agent profile id represents an editable default agent."""
    return agent_id == "default" or agent_id.startswith(DEFAULT_AGENT_ID_PREFIX)


def _asset_kb_id(folder_name: str) -> str:
    return f"asset_kb_{_slug(folder_name)}"


def _has_files(files: object) -> bool:
    return bool(files)


def _should_delete_stale_system_kb(kb: KnowledgeBaseTable, active_kb_ids: set[str]) -> bool:
    return (
        kb.owner_user_id is None
        and kb.id not in active_kb_ids
        and not _has_files(kb.files)
    )


def _remove_stale_kb_links(profile: AgentProfileTable, stale_kb_ids: set[str]) -> bool:
    existing = list(profile.knowledge_base_ids or [])
    cleaned = [kb_id for kb_id in existing if kb_id not in stale_kb_ids]
    if cleaned == existing:
        return False

    profile.knowledge_base_ids = cleaned
    profile.updated_at = _now_iso()
    return True


def _cleanup_stale_empty_system_kbs(active_kb_ids: set[str]) -> None:
    db = SessionLocal()
    try:
        system_kbs = db.query(KnowledgeBaseTable).filter(
            KnowledgeBaseTable.owner_user_id.is_(None),
        ).all()
        stale_kbs = [
            kb for kb in system_kbs
            if _should_delete_stale_system_kb(kb, active_kb_ids)
        ]
        if not stale_kbs:
            return

        stale_kb_ids = {kb.id for kb in stale_kbs}
        profiles = db.query(AgentProfileTable).all()
        for profile in profiles:
            _remove_stale_kb_links(profile, stale_kb_ids)

        for kb in stale_kbs:
            db.delete(kb)

        db.commit()
        logger.info(
            "Removed stale empty system knowledge bases: %s",
            ", ".join(sorted(stale_kb_ids)),
        )
    except Exception:
        db.rollback()
        logger.exception("Failed to clean stale empty system knowledge bases")
    finally:
        db.close()


def _scan_asset_folders() -> list[Path]:
    if not ASSETS_DIR.exists():
        return []
    return sorted(path for path in ASSETS_DIR.iterdir() if path.is_dir())


async def _asset_folders() -> list[Path]:
    return await asyncio.to_thread(_scan_asset_folders)


def _scan_folder_files(folder: Path) -> list[Path]:
    return sorted(path for path in folder.rglob("*") if path.is_file() and not path.name.startswith("."))


async def _folder_files(folder: Path) -> list[Path]:
    return await asyncio.to_thread(_scan_folder_files, folder)


def ensure_default_agent_profile(
    db: Session,
    owner_user_id: str,
    knowledge_base_ids: list[str] | None = None,
) -> AgentProfileTable:
    """Create or update the editable default agent profile for a user."""
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == default_agent_profile_id(owner_user_id),
        AgentProfileTable.owner_user_id == owner_user_id,
    ).first()
    now = _now_iso()

    if profile is None:
        profile = AgentProfileTable(
            id=default_agent_profile_id(owner_user_id),
            owner_user_id=owner_user_id,
            name=DEFAULT_AGENT_NAME,
            description=DEFAULT_AGENT_DESCRIPTION,
            system_prompt=DEFAULT_AGENT_PROMPT,
            enabled_tools=DEFAULT_AGENT_TOOLS,
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            wake_words=[],
            created_at=now,
            updated_at=now,
        )
        db.add(profile)

    if knowledge_base_ids:
        existing = list(profile.knowledge_base_ids or [])
        merged = list(dict.fromkeys([*existing, *knowledge_base_ids]))
        if merged != existing:
            profile.knowledge_base_ids = merged
            profile.updated_at = now

    return profile


async def ensure_system_asset_knowledge_bases() -> list[str]:
    """Ensure each assets subfolder exists as a shared system KB."""
    imported_kb_ids: list[str] = []
    folders = await _asset_folders()
    if not folders:
        return imported_kb_ids

    active_kb_ids = {_asset_kb_id(folder.name) for folder in folders}
    await asyncio.to_thread(_cleanup_stale_empty_system_kbs, active_kb_ids)

    for folder in folders:
        kb_id = _asset_kb_id(folder.name)
        db = SessionLocal()
        try:
            kb = db.query(KnowledgeBaseTable).filter(
                KnowledgeBaseTable.id == kb_id,
            ).first()
            if kb is not None:
                imported_kb_ids.append(kb_id)
                continue

            files = await _folder_files(folder)
            if not files:
                continue

            chunks: list[str] = []
            sources: list[str] = []
            file_records: list[dict] = []
            splitter = RecursiveCharacterTextSplitter(chunk_size=512, chunk_overlap=64)

            for asset_file in files:
                raw = await asyncio.to_thread(asset_file.read_bytes)
                content_type = mimetypes.guess_type(asset_file.name)[0] or ""
                text = await asyncio.to_thread(
                    load_document_bytes,
                    asset_file.name,
                    content_type,
                    raw,
                )
                file_chunks = splitter.split_text(text)
                chunks.extend(file_chunks)
                sources.extend([str(asset_file.relative_to(ASSETS_DIR))] * len(file_chunks))
                file_records.append(
                    {
                        "name": str(asset_file.relative_to(ASSETS_DIR)),
                        "size": len(raw),
                        "uploadedAt": _now_iso() + "Z",
                    }
                )

            if not chunks:
                logger.warning("No content extracted from assets folder %s", folder)
                continue

            await ingest_documents_async(kb_id, chunks, sources)
            now = _now_iso() + "Z"
            kb = KnowledgeBaseTable(
                id=kb_id,
                owner_user_id=None,
                name=folder.name,
                description=f"System knowledge base imported from assets/{folder.name}",
                files=file_records,
                created_at=now,
                updated_at=now,
            )
            db.add(kb)
            db.commit()
            imported_kb_ids.append(kb_id)
            logger.info("Imported assets folder '%s' into KB %s", folder.name, kb_id)
        except Exception:
            db.rollback()
            logger.exception("Failed to import assets folder '%s'", folder.name)
        finally:
            db.close()

    return imported_kb_ids


async def ensure_user_default_agent_assets(owner_user_id: str) -> list[str]:
    """Ensure shared system asset KBs exist without creating a default role."""
    return await ensure_system_asset_knowledge_bases()


async def import_assets_for_existing_users() -> None:
    """Import bundled system assets without creating user default roles."""
    await ensure_system_asset_knowledge_bases()
