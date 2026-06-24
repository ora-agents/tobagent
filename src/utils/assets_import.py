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

from src.tools.rag_tool import (
    _get_async_db,
    _table_name,
    ingest_documents_async,
    invalidate_rag_cache,
)
from src.utils.db import (
    AgentProfileTable,
    KnowledgeBaseTable,
    SessionLocal,
    ensure_database_schema,
)
from src.utils.document_loader import load_document_bytes

logger = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).parents[2] / "assets"
DEFAULT_AGENT_ID_PREFIX = "default_"
DEFAULT_AGENT_GRAPH_ID = "agent_builder"
DEFAULT_AGENT_NAME = "Agent 搭建 Agent"
DEFAULT_AGENT_DESCRIPTION = "系统自带的初始配置搭建智能体，可通过对话创建、修改和关联角色、技能、知识库、表单与 MCP 服务端。"
DEFAULT_AGENT_PROMPT = (
    "你是系统自带的 Agent 搭建 Agent，专门帮助用户通过对话构建和维护智能体配置。"
    "你可以创建或修改角色配置，管理技能、知识库、表单、MCP 服务端，并把这些资源关联到目标角色。"
    "执行配置变更前先确认用户意图；变更完成后用简洁清单说明变更内容和关联关系。"
)
DEFAULT_AGENT_TOOLS = [
    "list_config_resources",
    "upsert_agent_profile",
    "upsert_skill",
    "upsert_form",
    "upsert_mcp_server",
    "upsert_knowledge_base",
    "link_agent_resources",
]


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


def _is_system_asset_kb(kb: KnowledgeBaseTable) -> bool:
    return kb.owner_user_id is None and kb.id.startswith("asset_kb_")


def _should_delete_stale_asset_kb(kb: KnowledgeBaseTable, active_kb_ids: set[str]) -> bool:
    return _is_system_asset_kb(kb) and kb.id not in active_kb_ids


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


def _asset_file_record(asset_file: Path, raw: bytes | None = None) -> dict:
    """Return stable metadata used to detect changed bundled asset files."""
    if raw is None:
        raw = asset_file.read_bytes()
    stat = asset_file.stat()
    return {
        "name": str(asset_file.relative_to(ASSETS_DIR)),
        "size": len(raw),
        "uploadedAt": _now_iso() + "Z",
        "mtimeNs": stat.st_mtime_ns,
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


async def _asset_folder_file_records(folder: Path) -> list[dict]:
    """Return file records for an assets folder without parsing document text."""
    files = await _folder_files(folder)
    return [
        await asyncio.to_thread(_asset_file_record, asset_file)
        for asset_file in files
    ]


def _asset_file_fingerprint(record: dict) -> tuple[str, int, str]:
    return (
        str(record.get("name") or ""),
        int(record.get("size") or 0),
        str(record.get("sha256") or ""),
    )


def _asset_files_unchanged(previous: object, current: list[dict]) -> bool:
    """Return whether stored asset file fingerprints match the current files."""
    if not isinstance(previous, list):
        return False
    if len(previous) != len(current):
        return False
    if any(not isinstance(record, dict) for record in previous):
        return False
    if any(not record.get("sha256") for record in previous):
        return False

    previous_fingerprints = sorted(_asset_file_fingerprint(record) for record in previous)
    current_fingerprints = sorted(_asset_file_fingerprint(record) for record in current)
    return previous_fingerprints == current_fingerprints


async def _rag_table_has_rows(kb_id: str) -> bool:
    """Return whether the LanceDB table for a KB exists and contains rows."""
    try:
        lancedb_instance = await _get_async_db()
        tname = _table_name(kb_id)
        if tname not in await lancedb_instance.table_names():
            return False
        table = await lancedb_instance.open_table(tname)
        return await table.count_rows() > 0
    except Exception:
        logger.exception("Failed to inspect LanceDB table for KB %s", kb_id)
        return False


async def _drop_rag_tables(kb_ids: set[str]) -> None:
    """Drop LanceDB tables for the given KB ids when they exist."""
    if not kb_ids:
        return

    try:
        lancedb_instance = await _get_async_db()
        table_names = set(await lancedb_instance.table_names())
        for kb_id in sorted(kb_ids):
            tname = _table_name(kb_id)
            if tname in table_names:
                await lancedb_instance.drop_table(tname)
                logger.info("Dropped LanceDB table '%s' for KB %s", tname, kb_id)
        invalidate_rag_cache()
    except Exception:
        logger.exception("Failed to drop LanceDB tables for asset KB refresh")


def _delete_stale_asset_kb_records(active_kb_ids: set[str]) -> set[str]:
    """Delete DB records for system asset KBs no longer present in assets/."""
    db = SessionLocal()
    try:
        system_asset_kbs = db.query(KnowledgeBaseTable).filter(
            KnowledgeBaseTable.owner_user_id.is_(None),
            KnowledgeBaseTable.id.like("asset_kb_%"),
        ).all()
        stale_kbs = [
            kb for kb in system_asset_kbs
            if _should_delete_stale_asset_kb(kb, active_kb_ids)
        ]
        if not stale_kbs:
            return set()

        stale_kb_ids = {kb.id for kb in stale_kbs}
        profiles = db.query(AgentProfileTable).all()
        for profile in profiles:
            _remove_stale_kb_links(profile, stale_kb_ids)

        for kb in stale_kbs:
            db.delete(kb)

        db.commit()
        logger.info("Deleted stale asset KB records: %s", ", ".join(sorted(stale_kb_ids)))
        return stale_kb_ids
    except Exception:
        db.rollback()
        logger.exception("Failed to delete stale asset KB records")
        return set()
    finally:
        db.close()


async def _load_asset_folder_chunks(folder: Path) -> tuple[list[str], list[str], list[dict]]:
    """Load an asset folder into text chunks, source labels, and file metadata."""
    files = await _folder_files(folder)
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
        file_records.append(await asyncio.to_thread(_asset_file_record, asset_file, raw))

    return chunks, sources, file_records


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
            graph_id=DEFAULT_AGENT_GRAPH_ID,
            enabled_tools=DEFAULT_AGENT_TOOLS,
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            wake_words=[],
            form_ids=[],
            created_at=now,
            updated_at=now,
        )
        db.add(profile)
    else:
        changed = False
        desired_values = {
            "name": DEFAULT_AGENT_NAME,
            "description": DEFAULT_AGENT_DESCRIPTION,
            "system_prompt": DEFAULT_AGENT_PROMPT,
            "graph_id": DEFAULT_AGENT_GRAPH_ID,
            "enabled_tools": DEFAULT_AGENT_TOOLS,
        }
        for field_name, desired_value in desired_values.items():
            if getattr(profile, field_name, None) != desired_value:
                setattr(profile, field_name, desired_value)
                changed = True
        if changed:
            profile.updated_at = now

    if knowledge_base_ids:
        existing = list(profile.knowledge_base_ids or [])
        merged = list(dict.fromkeys([*existing, *knowledge_base_ids]))
        if merged != existing:
            profile.knowledge_base_ids = merged
            profile.updated_at = now

    return profile


async def ensure_system_asset_knowledge_bases() -> list[str]:
    """Ensure each assets subfolder exists as a shared system KB."""
    await asyncio.to_thread(ensure_database_schema)
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
            current_file_records = await _asset_folder_file_records(folder)
            if (
                kb is not None
                and await _rag_table_has_rows(kb_id)
                and _asset_files_unchanged(kb.files, current_file_records)
            ):
                imported_kb_ids.append(kb_id)
                continue
            if kb is not None:
                await _drop_rag_tables({kb_id})

            chunks, sources, file_records = await _load_asset_folder_chunks(folder)
            if not chunks:
                logger.warning("No content extracted from assets folder %s", folder)
                continue

            await ingest_documents_async(kb_id, chunks, sources)
            now = _now_iso() + "Z"
            if kb is None:
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
            else:
                kb.name = folder.name
                kb.description = f"System knowledge base imported from assets/{folder.name}"
                kb.files = file_records
                kb.updated_at = now
            db.commit()
            imported_kb_ids.append(kb_id)
            logger.info("Imported assets folder '%s' into KB %s", folder.name, kb_id)
        except Exception:
            db.rollback()
            logger.exception("Failed to import assets folder '%s'", folder.name)
        finally:
            db.close()

    return imported_kb_ids


async def refresh_system_asset_knowledge_bases() -> list[str]:
    """Rebuild bundled system asset KBs from the current assets/ directory.

    This is intended for manual maintenance. It removes stale asset KB rows
    whose folders no longer exist, drops LanceDB tables for stale and active
    asset KBs, then re-imports the active asset folders.
    """
    await asyncio.to_thread(ensure_database_schema)
    folders = await _asset_folders()
    active_kb_ids = {_asset_kb_id(folder.name) for folder in folders}

    stale_kb_ids = await asyncio.to_thread(_delete_stale_asset_kb_records, active_kb_ids)
    await _drop_rag_tables(active_kb_ids | stale_kb_ids)

    if not folders:
        logger.warning("No assets folders found under %s", ASSETS_DIR)
        return []

    return await ensure_system_asset_knowledge_bases()


async def ensure_user_default_agent_assets(owner_user_id: str) -> list[str]:
    """Ensure shared system asset KBs exist without creating a default role."""
    return await ensure_system_asset_knowledge_bases()


async def import_assets_for_existing_users() -> None:
    """Import bundled system assets without creating user default roles."""
    await ensure_system_asset_knowledge_bases()


async def _main() -> None:
    """CLI entry point for manual asset KB maintenance."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Maintain bundled asset knowledge bases.")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Drop and rebuild asset KB vector tables, and delete stale asset KB DB records.",
    )
    args = parser.parse_args()

    if args.refresh:
        kb_ids = await refresh_system_asset_knowledge_bases()
    else:
        kb_ids = await ensure_system_asset_knowledge_bases()

    if kb_ids:
        sys.stdout.write("Imported asset knowledge bases:\n")
        for kb_id in kb_ids:
            sys.stdout.write(f"- {kb_id}\n")
    else:
        sys.stdout.write("No asset knowledge bases imported.\n")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main())
