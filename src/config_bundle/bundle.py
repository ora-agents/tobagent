"""Export, inspect, and import `.tobconfig` archives."""

import asyncio
import copy
import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import PurePosixPath

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.api.services import (
    _create_agent_profile_version,
    _invalidate_runtime_caches,
    _new_resource_id,
)
from src.config_bundle.registry import ImportJob, InspectionEntry, put_job
from src.config_bundle.schemas import (
    RESOURCE_KEYS,
    BundleConflict,
    BundleExportRequest,
    BundleImportRequest,
    BundleImportResponse,
    BundleInspectionResponse,
    BundleMissingDependency,
)
from src.config_bundle.storage import read_document, save_document
from src.utils.db import (
    AgentProfileTable,
    FormRecordTable,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
)

FORMAT = "tob-config-bundle"
FORMAT_VERSION = 1
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
MAX_EXTRACTED_BYTES = 500 * 1024 * 1024
MAX_FILES = 2000
SENSITIVE_HEADER = re.compile(
    r"(^authorization$|^proxy-authorization$|^cookie$|^set-cookie$|token|secret|key)",
    re.IGNORECASE,
)
TABLES = {
    "agents": AgentProfileTable,
    "skills": SkillTable,
    "knowledgeBases": KnowledgeBaseTable,
    "mcpServers": McpServerTable,
    "forms": FormTable,
}
ID_MAP_KEYS = {
    "agents": "agentIds",
    "skills": "skillIds",
    "knowledgeBases": "knowledgeBaseIds",
    "mcpServers": "mcpIds",
    "forms": "formIds",
}
LINK_FIELDS = {
    "knowledgeBaseIds": "knowledgeBases",
    "skillIds": "skills",
    "mcpIds": "mcpServers",
    "agentIds": "agents",
    "formIds": "forms",
}


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")


def _owned_rows(db: Session, table, ids: list[str], owner_user_id: str) -> list:
    if not ids:
        return []
    rows = db.query(table).filter(
        table.id.in_(list(dict.fromkeys(ids))),
        table.owner_user_id == owner_user_id,
    ).all()
    if len(rows) != len(set(ids)):
        raise HTTPException(status_code=404, detail="One or more selected resources were not found")
    return rows


def _agent_payload(row: AgentProfileTable) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "systemPrompt": row.system_prompt,
        "model": row.model,
        "enabledTools": list(row.enabled_tools or []),
        "knowledgeBaseIds": list(row.knowledge_base_ids or []),
        "skillIds": list(row.skill_ids or []),
        "mcpIds": list(row.mcp_ids or []),
        "agentIds": list(row.agent_ids or []),
        "formIds": list(row.form_ids or []),
        "wakeWords": list(row.wake_words or []),
        "roleTemplateId": row.role_template_id,
        "personaStyle": row.persona_style,
        "boundaryMode": row.boundary_mode,
        "ttsVoice": row.tts_voice,
        "isHidden": bool(row.is_hidden),
        "voiceInterruptionEnabled": row.voice_interruption_enabled is not False,
        "speakerVerificationEnabled": bool(row.speaker_verification_enabled),
    }


def _collect_export_rows(
    db: Session,
    request: BundleExportRequest,
    owner_user_id: str,
) -> dict[str, list]:
    selected = request.selection.model_dump()
    rows = {
        key: _owned_rows(db, TABLES[key], selected[key], owner_user_id)
        for key in RESOURCE_KEYS
    }
    if not request.options.includeDependencies:
        return rows

    agent_queue = list(rows["agents"])
    seen_agents = {row.id for row in agent_queue}
    dependencies = {key: set(selected[key]) for key in RESOURCE_KEYS}
    while agent_queue:
        agent = agent_queue.pop()
        dependencies["knowledgeBases"].update(agent.knowledge_base_ids or [])
        dependencies["skills"].update(agent.skill_ids or [])
        dependencies["mcpServers"].update(agent.mcp_ids or [])
        dependencies["forms"].update(agent.form_ids or [])
        linked_ids = set(agent.agent_ids or []) - seen_agents
        if linked_ids:
            linked = _owned_rows(db, AgentProfileTable, list(linked_ids), owner_user_id)
            agent_queue.extend(linked)
            seen_agents.update(linked_ids)
            rows["agents"].extend(linked)
    for key in RESOURCE_KEYS[1:]:
        rows[key] = _owned_rows(db, TABLES[key], list(dependencies[key]), owner_user_id)
    return rows


def build_export_bundle(
    db: Session,
    request: BundleExportRequest,
    owner_user_id: str,
) -> tuple[bytes, list[str]]:
    """Build a validated configuration archive for owned resources."""
    rows = _collect_export_rows(db, request, owner_user_id)
    warnings: list[str] = []
    resources = {key: [row.id for row in rows[key]] for key in RESOURCE_KEYS}
    skill_metadata = {
        row.id: {"name": row.name, "description": row.description}
        for row in rows["skills"]
    }
    manifest = {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "exportedAt": _now(),
        "scope": "selection",
        "resources": resources,
        "resourceMetadata": {"skills": skill_metadata},
        "options": request.options.model_dump(),
        "security": {
            "secretsIncluded": False,
            "voiceprintsIncluded": False,
        },
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", _json_bytes(manifest))
        for row in rows["agents"]:
            archive.writestr(f"agents/{row.id}.json", _json_bytes(_agent_payload(row)))
        for row in rows["skills"]:
            archive.writestr(f"skills/{row.id}.md", row.content.encode("utf-8"))
        for row in rows["mcpServers"]:
            headers = {}
            redacted = []
            for key, value in (row.headers or {}).items():
                if SENSITIVE_HEADER.search(key):
                    redacted.append(key)
                else:
                    headers[key] = value
            archive.writestr(
                f"mcp-servers/{row.id}.json",
                _json_bytes({
                    "id": row.id,
                    "name": row.name,
                    "type": "streamable_http",
                    "url": row.url,
                    "headers": headers,
                    "redactedHeaders": redacted,
                }),
            )
        for row in rows["forms"]:
            archive.writestr(
                f"forms/{row.id}.json",
                _json_bytes({
                    "id": row.id,
                    "name": row.name,
                    "description": row.description,
                    "fields": copy.deepcopy(row.fields or []),
                }),
            )
            if request.options.includeFormRecords:
                records = db.query(FormRecordTable).filter(
                    FormRecordTable.form_id == row.id,
                    FormRecordTable.owner_user_id == owner_user_id,
                ).all()
                body = b"".join(
                    json.dumps(
                        {"id": record.id, "data": record.data or {}},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode() + b"\n"
                    for record in records
                )
                archive.writestr(f"forms/{row.id}.records.jsonl", body)
        for row in rows["knowledgeBases"]:
            files = copy.deepcopy(row.files or [])
            archive.writestr(
                f"knowledge-bases/{row.id}.json",
                _json_bytes({
                    "id": row.id,
                    "name": row.name,
                    "description": row.description,
                    "files": files,
                    "documentsIncluded": request.options.includeKnowledgeDocuments,
                }),
            )
            if request.options.includeKnowledgeDocuments:
                for file_info in files:
                    filename = str(file_info.get("name") or "")
                    raw = read_document(row.id, filename) if filename else None
                    if raw is None:
                        warnings.append(
                            f"Knowledge base {row.id} document {filename or '<unknown>'} "
                            "has no persisted source file and was omitted."
                        )
                        continue
                    safe_name = PurePosixPath(filename).name
                    archive.writestr(
                        f"knowledge-bases/{row.id}/documents/{safe_name}",
                        raw,
                    )
        if warnings:
            archive.writestr("warnings.json", _json_bytes(warnings))
    return output.getvalue(), warnings


def _safe_zip_entries(raw: bytes) -> dict[str, bytes]:
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="Configuration bundle is too large")
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="Invalid configuration bundle ZIP") from exc
    infos = archive.infolist()
    if len(infos) > MAX_FILES:
        raise HTTPException(status_code=400, detail="Configuration bundle contains too many files")
    if sum(info.file_size for info in infos) > MAX_EXTRACTED_BYTES:
        raise HTTPException(status_code=400, detail="Configuration bundle expands beyond the size limit")
    entries: dict[str, bytes] = {}
    for info in infos:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or info.is_dir():
            if info.is_dir():
                continue
            raise HTTPException(status_code=400, detail="Unsafe path in configuration bundle")
        entries[str(path)] = archive.read(info)
    return entries


def _load_json(entries: dict[str, bytes], path: str) -> dict:
    try:
        value = json.loads(entries[path])
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or missing {path}") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail=f"{path} must contain a JSON object")
    return value


def _parse_bundle(raw: bytes) -> tuple[dict, dict[str, bytes]]:
    entries = _safe_zip_entries(raw)
    manifest = _load_json(entries, "manifest.json")
    if manifest.get("format") != FORMAT:
        raise HTTPException(status_code=400, detail="Unsupported configuration bundle format")
    if manifest.get("version") != FORMAT_VERSION:
        raise HTTPException(status_code=400, detail="Unsupported configuration bundle version")
    resource_ids = manifest.get("resources")
    if not isinstance(resource_ids, dict):
        raise HTTPException(status_code=400, detail="Manifest resources are invalid")

    payload: dict[str, dict[str, dict]] = {key: {} for key in RESOURCE_KEYS}
    metadata = manifest.get("resourceMetadata") or {}
    skill_metadata = metadata.get("skills") or {}
    paths = {
        "agents": ("agents", "json"),
        "mcpServers": ("mcp-servers", "json"),
        "forms": ("forms", "json"),
        "knowledgeBases": ("knowledge-bases", "json"),
    }
    for key, (folder, suffix) in paths.items():
        for source_id in resource_ids.get(key, []):
            payload[key][source_id] = _load_json(entries, f"{folder}/{source_id}.{suffix}")
    for source_id in resource_ids.get("skills", []):
        path = f"skills/{source_id}.md"
        try:
            content = entries[path].decode("utf-8")
        except (KeyError, UnicodeDecodeError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid or missing {path}") from exc
        meta = skill_metadata.get(source_id) or {}
        payload["skills"][source_id] = {
            "id": source_id,
            "name": meta.get("name") or source_id,
            "description": meta.get("description"),
            "content": content,
        }
    for source_id in resource_ids.get("forms", []):
        records_path = f"forms/{source_id}.records.jsonl"
        records = []
        for line in entries.get(records_path, b"").splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=400, detail=f"Invalid {records_path}") from exc
            if isinstance(record, dict):
                records.append(record)
        payload["forms"][source_id]["records"] = records

    documents = {
        path: value
        for path, value in entries.items()
        if path.startswith("knowledge-bases/") and "/documents/" in path
    }
    return {"manifest": manifest, "resources": payload}, documents


def _find_conflict(db: Session, table, owner_user_id: str, source_id: str, name: str):
    existing = db.query(table).filter(
        table.id == source_id,
        table.owner_user_id == owner_user_id,
    ).first()
    if existing:
        return existing, "id"
    existing = db.query(table).filter(
        table.owner_user_id == owner_user_id,
        table.name == name,
    ).first()
    return (existing, "name") if existing else (None, None)


def inspect_bundle(
    db: Session,
    raw: bytes,
    owner_user_id: str,
    inspection_id: str,
) -> tuple[BundleInspectionResponse, InspectionEntry]:
    """Parse and inspect a bundle without modifying persistence."""
    payload, documents = _parse_bundle(raw)
    resources = payload["resources"]
    conflicts = []
    warnings = []
    redacted_fields = []
    voiceprints = []
    available = {key: list(resources[key]) for key in RESOURCE_KEYS}
    for key in RESOURCE_KEYS:
        for source_id, item in resources[key].items():
            name = str(item.get("name") or source_id)
            existing, reason = _find_conflict(
                db, TABLES[key], owner_user_id, source_id, name
            )
            if existing:
                conflicts.append(BundleConflict(
                    resourceType=key,
                    sourceId=source_id,
                    sourceName=name,
                    existingId=existing.id,
                    reason=reason,
                ))
            if key == "mcpServers":
                redacted = list(item.get("redactedHeaders") or [])
                redacted_fields.extend(f"{source_id}:{field}" for field in redacted)
            if key == "agents" and item.get("speakerVerificationEnabled"):
                voiceprints.append(source_id)
    missing = []
    for source_id, agent in resources["agents"].items():
        for field, resource_type in LINK_FIELDS.items():
            for linked_id in agent.get(field) or []:
                if linked_id not in resources[resource_type]:
                    missing.append(BundleMissingDependency(
                        agentId=source_id,
                        resourceType=resource_type,
                        resourceId=linked_id,
                    ))
    if redacted_fields:
        warnings.append("Sensitive MCP headers were removed and must be supplied again.")
    if voiceprints:
        warnings.append("Speaker verification is enabled but voiceprints must be rebound.")
    document_bytes = sum(len(value) for value in documents.values())
    response = BundleInspectionResponse(
        inspectionId=inspection_id,
        formatVersion=FORMAT_VERSION,
        exportedAt=str(payload["manifest"].get("exportedAt") or ""),
        resources={key: len(resources[key]) for key in RESOURCE_KEYS},
        availableResources=available,
        conflicts=conflicts,
        missingDependencies=missing,
        warnings=warnings,
        redactedMcpFields=redacted_fields,
        voiceprintsRequireRebinding=voiceprints,
        knowledgeDocuments=len(documents),
        knowledgeDocumentBytes=document_bytes,
    )
    return response, InspectionEntry(owner_user_id, payload, documents)


def _selected_ids(request: BundleImportRequest, resources: dict) -> dict[str, set[str]]:
    if request.selection is None:
        return {key: set(resources[key]) for key in RESOURCE_KEYS}
    selection = request.selection.model_dump()
    selected = {key: set(selection[key]) for key in RESOURCE_KEYS}
    for key in RESOURCE_KEYS:
        unknown = selected[key] - set(resources[key])
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown selected {key}: {sorted(unknown)}")
    return selected


def _target_for(
    db: Session,
    key: str,
    source_id: str,
    item: dict,
    owner_user_id: str,
    policy: str,
):
    existing, _ = _find_conflict(
        db, TABLES[key], owner_user_id, source_id, str(item.get("name") or source_id)
    )
    if not existing:
        return _new_resource_id({
            "agents": "agent",
            "skills": "skill",
            "knowledgeBases": "kb",
            "mcpServers": "mcp",
            "forms": "form",
        }[key]), None
    if policy == "skip":
        return existing.id, "skip"
    if policy == "overwrite":
        return existing.id, existing
    return _new_resource_id({
        "agents": "agent",
        "skills": "skill",
        "knowledgeBases": "kb",
        "mcpServers": "mcp",
        "forms": "form",
    }[key]), None


async def _index_documents(
    job: ImportJob,
    documents: list[tuple[str, bytes]],
    final_kb_status: str,
) -> None:
    job.status = "running"
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        from src.tools.rag_tool import (
            _get_async_db,
            _table_name,
            ingest_documents_async,
            invalidate_rag_cache,
        )
        from src.utils.document_loader import load_document_bytes

        vector_db = await _get_async_db()
        table_name = _table_name(job.resource_id)
        if table_name in await vector_db.table_names():
            await vector_db.drop_table(table_name)
            invalidate_rag_cache()
        splitter = RecursiveCharacterTextSplitter(chunk_size=512, chunk_overlap=64)
        for filename, raw in documents:
            text = await asyncio.to_thread(load_document_bytes, filename, "", raw)
            chunks = splitter.split_text(text)
            if chunks:
                await ingest_documents_async(
                    job.resource_id,
                    chunks,
                    [filename] * len(chunks),
                )
            job.processed_documents += 1
        job.status = "ready"
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
    finally:
        from src.utils.db import SessionLocal

        db = SessionLocal()
        try:
            kb = db.query(KnowledgeBaseTable).filter(
                KnowledgeBaseTable.id == job.resource_id,
                KnowledgeBaseTable.owner_user_id == job.owner_user_id,
            ).first()
            if kb:
                kb.import_status = final_kb_status if job.status == "ready" else "failed"
                kb.import_error = job.error
                kb.updated_at = _now()
                db.commit()
        finally:
            db.close()


def execute_import(
    db: Session,
    entry: InspectionEntry,
    request: BundleImportRequest,
    owner_user_id: str,
) -> tuple[
    BundleImportResponse,
    list[tuple[ImportJob, list[tuple[str, bytes]], str]],
]:
    """Write selected resources transactionally and prepare indexing jobs."""
    resources = entry.payload["resources"]
    selected = _selected_ids(request, resources)
    now = _now()
    id_map = {value: {} for value in ID_MAP_KEYS.values()}
    targets: dict[str, dict[str, tuple[str, object | str | None]]] = {
        key: {} for key in RESOURCE_KEYS
    }
    for key in RESOURCE_KEYS:
        for source_id in selected[key]:
            target_id, existing = _target_for(
                db, key, source_id, resources[key][source_id],
                owner_user_id, request.conflictPolicy,
            )
            targets[key][source_id] = (target_id, existing)
            id_map[ID_MAP_KEYS[key]][source_id] = target_id

    imported = {key: [] for key in RESOURCE_KEYS}
    warnings: list[str] = []
    pending_jobs = []
    try:
        for key in ("skills", "mcpServers", "forms", "knowledgeBases"):
            for source_id in selected[key]:
                item = resources[key][source_id]
                target_id, existing = targets[key][source_id]
                if existing == "skip":
                    warnings.append(f"Skipped conflicting {key} resource {source_id}.")
                    continue
                if key == "skills":
                    row = existing or SkillTable(
                        id=target_id, owner_user_id=owner_user_id, created_at=now
                    )
                    row.name = str(item.get("name") or source_id)
                    row.description = item.get("description")
                    row.content = str(item.get("content") or "")
                elif key == "mcpServers":
                    row = existing or McpServerTable(
                        id=target_id, owner_user_id=owner_user_id, created_at=now
                    )
                    row.name = str(item.get("name") or source_id)
                    row.type = "streamable_http"
                    row.url = item.get("url")
                    row.headers = copy.deepcopy(item.get("headers") or {})
                    if item.get("redactedHeaders"):
                        warnings.append(f"MCP server {source_id} requires credentials.")
                elif key == "forms":
                    row = existing or FormTable(
                        id=target_id, owner_user_id=owner_user_id, created_at=now
                    )
                    row.name = str(item.get("name") or source_id)
                    row.description = item.get("description")
                    row.fields = copy.deepcopy(item.get("fields") or [])
                    if existing:
                        db.query(FormRecordTable).filter(
                            FormRecordTable.form_id == target_id,
                            FormRecordTable.owner_user_id == owner_user_id,
                        ).delete()
                    for record in item.get("records") or []:
                        db.add(FormRecordTable(
                            id=_new_resource_id("record"),
                            form_id=target_id,
                            owner_user_id=owner_user_id,
                            data=copy.deepcopy(record.get("data") or {}),
                            created_at=now,
                            updated_at=now,
                        ))
                else:
                    row = existing or KnowledgeBaseTable(
                        id=target_id, owner_user_id=owner_user_id, created_at=now
                    )
                    row.name = str(item.get("name") or source_id)
                    row.description = item.get("description")
                    docs = []
                    files = []
                    for file_info in item.get("files") or []:
                        filename = PurePosixPath(str(file_info.get("name") or "")).name
                        path = f"knowledge-bases/{source_id}/documents/{filename}"
                        raw = entry.documents.get(path)
                        if raw is not None:
                            save_document(target_id, filename, raw)
                            docs.append((filename, raw))
                            files.append(copy.deepcopy(file_info))
                    row.files = files if docs else copy.deepcopy(item.get("files") or [])
                    row.import_status = "importing" if docs else "needs_upload"
                    row.import_error = None
                    if not docs and item.get("files"):
                        warnings.append(
                            f"Knowledge base {source_id} was imported without source documents "
                            "and requires document upload."
                        )
                    if docs:
                        job = ImportJob(
                            id=f"job-{uuid.uuid4()}",
                            owner_user_id=owner_user_id,
                            resource_type="knowledgeBase",
                            resource_id=target_id,
                            total_documents=len(docs),
                        )
                        put_job(job)
                        pending_jobs.append((job, docs, "ready"))
                    elif existing:
                        job = ImportJob(
                            id=f"job-{uuid.uuid4()}",
                            owner_user_id=owner_user_id,
                            resource_type="knowledgeBase",
                            resource_id=target_id,
                        )
                        put_job(job)
                        pending_jobs.append((job, [], "needs_upload"))
                row.updated_at = now
                if not existing:
                    db.add(row)
                imported[key].append(target_id)

        for source_id in selected["agents"]:
            item = resources["agents"][source_id]
            target_id, existing = targets["agents"][source_id]
            if existing == "skip":
                warnings.append(f"Skipped conflicting agents resource {source_id}.")
                continue
            row = existing or AgentProfileTable(
                id=target_id, owner_user_id=owner_user_id, created_at=now
            )
            row.name = str(item.get("name") or source_id)
            row.description = item.get("description")
            row.system_prompt = item.get("systemPrompt")
            row.model = item.get("model")
            row.enabled_tools = list(item.get("enabledTools") or [])
            for field, resource_type in LINK_FIELDS.items():
                mapped = []
                map_key = ID_MAP_KEYS[resource_type]
                for linked_id in item.get(field) or []:
                    target = id_map[map_key].get(linked_id)
                    if target:
                        mapped.append(target)
                    else:
                        warnings.append(
                            f"Agent {source_id} dependency {resource_type}:{linked_id} was skipped."
                        )
                setattr(row, {
                    "knowledgeBaseIds": "knowledge_base_ids",
                    "skillIds": "skill_ids",
                    "mcpIds": "mcp_ids",
                    "agentIds": "agent_ids",
                    "formIds": "form_ids",
                }[field], mapped)
            row.wake_words = list(item.get("wakeWords") or [])
            row.role_template_id = item.get("roleTemplateId")
            row.persona_style = item.get("personaStyle")
            row.boundary_mode = item.get("boundaryMode")
            row.tts_voice = item.get("ttsVoice")
            row.is_hidden = bool(item.get("isHidden", False))
            row.voice_interruption_enabled = item.get("voiceInterruptionEnabled", True) is not False
            row.speaker_verification_enabled = bool(item.get("speakerVerificationEnabled", False))
            row.user_voiceprint_id = None
            row.speaker_sample_text = None
            row.speaker_enrolled_at = None
            row.updated_at = now
            if not existing:
                db.add(row)
            _create_agent_profile_version(db, row, now)
            imported["agents"].append(target_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return BundleImportResponse(
        resources=imported,
        resourceIdMap=id_map,
        warnings=list(dict.fromkeys(warnings)),
        jobs=[job.id for job, _, _ in pending_jobs],
    ), pending_jobs


def start_index_jobs(
    pending_jobs: list[tuple[ImportJob, list[tuple[str, bytes]], str]],
) -> None:
    """Start asynchronous knowledge document indexing jobs."""
    for job, documents, final_kb_status in pending_jobs:
        asyncio.create_task(_index_documents(job, documents, final_kb_status))
