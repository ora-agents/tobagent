"""Knowledge base and RAG upload routes."""
# ruff: noqa: D103,D401

import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    AgentRAGStatusResponse,
    KnowledgeBaseSchema,
    WorkspaceChangeRequestSchema,
)
from src.api.services import (
    _invalidate_runtime_caches,
    _kb_schema,
    _remove_agent_profile_links,
    _schema_files,
    _workspace_change_request_schema,
)
from src.api.workspace_utils import (
    MANAGER_ROLES,
    create_workspace_change_request_row,
    get_active_workspace,
    get_workspace_header,
    require_workspace_manager,
    workspace_scoped_resource_filter,
)
from src.utils.db import AgentProfileTable, KnowledgeBaseTable, UserTable, get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["knowledge-bases"])


# ---------------------------------------------------------------------------
# Knowledge Base CRUD & Upload
# ---------------------------------------------------------------------------

@router.get(
    "/api/knowledge-bases",
    response_model=list[KnowledgeBaseSchema],
    summary="List knowledge bases",
    description="Lists system knowledge bases and knowledge bases owned by the authenticated user.",
)
async def get_knowledge_bases(
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    kbs = db.query(KnowledgeBaseTable).filter(
        or_(
            and_(
                KnowledgeBaseTable.owner_user_id == owner_user_id,
                workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
            ),
            and_(
                KnowledgeBaseTable.owner_user_id.is_(None),
                KnowledgeBaseTable.workspace_id.is_(None),
            ),
        ),
    ).order_by(KnowledgeBaseTable.owner_user_id.isnot(None), KnowledgeBaseTable.name).all()
    return [_kb_schema(k) for k in kbs]


@router.post(
    "/api/knowledge-bases",
    response_model=KnowledgeBaseSchema | WorkspaceChangeRequestSchema,
    summary="Create a knowledge base",
    description="Creates knowledge base metadata for later document upload and RAG retrieval.",
)
async def create_knowledge_base(
    kb_data: KnowledgeBaseSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="knowledge_base",
            target_id=kb_data.id,
            action="create",
            payload=kb_data.model_dump(mode="json"),
        )
        return _workspace_change_request_schema(db, change)
    existing = db.query(KnowledgeBaseTable).filter(KnowledgeBaseTable.id == kb_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Knowledge Base already exists")
    
    # Map Pydantic files models to raw JSON dict list
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    new_kb = KnowledgeBaseTable(
        id=kb_data.id,
        owner_user_id=owner_user_id,
        workspace_id=workspace.id,
        name=kb_data.name,
        description=kb_data.description,
        files=db_files,
        import_status="ready",
        created_at=kb_data.createdAt,
        updated_at=kb_data.updatedAt,
    )
    db.add(new_kb)
    db.commit()
    db.refresh(new_kb)
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return _kb_schema(new_kb)


@router.put(
    "/api/knowledge-bases/{id}",
    response_model=KnowledgeBaseSchema | WorkspaceChangeRequestSchema,
    summary="Update a knowledge base",
    description="Updates metadata and file metadata for an owned knowledge base.",
)
async def update_knowledge_base(
    id: str,
    kb_data: KnowledgeBaseSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        existing_kb = db.query(KnowledgeBaseTable).filter(
            KnowledgeBaseTable.id == id,
            KnowledgeBaseTable.owner_user_id == owner_user_id,
            workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
        ).first()
        payload = kb_data.model_dump(mode="json")
        if existing_kb:
            payload["previousValues"] = _kb_schema(existing_kb).model_dump(mode="json")
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="knowledge_base",
            target_id=id,
            action="update",
            payload=payload,
        )
        return _workspace_change_request_schema(db, change)
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == id,
        KnowledgeBaseTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")
    
    db_files = [{"name": f.name, "size": f.size, "uploadedAt": f.uploadedAt} for f in kb_data.files]
    kb.name = kb_data.name
    kb.workspace_id = workspace.id
    kb.description = kb_data.description
    kb.files = db_files
    kb.updated_at = kb_data.updatedAt
    
    db.commit()
    db.refresh(kb)
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return _kb_schema(kb)


@router.delete(
    "/api/knowledge-bases/{id}",
    summary="Delete a knowledge base",
    description="Deletes an owned knowledge base, drops its LanceDB table when present, and removes agent links to it.",
)
async def delete_knowledge_base(
    id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="knowledge_base",
            target_id=id,
            action="delete",
            payload={},
        )
        return _workspace_change_request_schema(db, change)
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == id,
        KnowledgeBaseTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
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

    from src.config_bundle.storage import delete_knowledge_base_documents

    delete_knowledge_base_documents(id)
    _remove_agent_profile_links(db, owner_user_id, "knowledge_base_ids", [id])
    db.delete(kb)
    db.commit()
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return {"status": "success", "message": f"Knowledge base {id} and associated LanceDB table deleted"}


def _sync_load_document(filename: str, content_type: str, raw: bytes) -> str:
    """Synchronous helper to import loaders, write temp files, and parse.
    
    Runs completely in a thread pool via asyncio.to_thread to avoid blocking ASGI event loop.
    """
    from src.utils.document_loader import load_document_bytes

    return load_document_bytes(filename, content_type, raw)


async def _load_document_content(file: UploadFile, raw: bytes) -> str:
    """Helper to parse uploaded document using LangChain document loaders."""
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


@router.post(
    "/api/knowledge-bases/{kb_id}/upload",
    summary="Upload a document to a knowledge base",
    description=(
        "Accepts multipart form data with a document file, chunk size, and chunk overlap. "
        "The backend extracts text, chunks it, embeds it, stores vectors in LanceDB, and updates file metadata."
    ),
)
async def upload_kb_document(
    kb_id: str,
    file: UploadFile = File(...),
    chunk_size: int = Form(default=512),
    chunk_overlap: int = Form(default=64),
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Upload document directly to a shared knowledge base (RAG).
    
    Extracts text, splits into chunks, embeds and saves to LanceDB.
    Also records file metadata under the KB in PostgreSQL.
    """
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == kb_id,
        KnowledgeBaseTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
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
        from src.config_bundle.storage import save_document

        save_document(kb_id, _filename or "upload", raw)

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
        kb.workspace_id = workspace.id
        kb.import_status = "ready"
        kb.import_error = None
        kb.updated_at = datetime.utcnow().isoformat() + "Z"
        db.commit()
        db.refresh(kb)
        _invalidate_runtime_caches(owner_user_id=owner_user_id)

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


@router.delete(
    "/api/knowledge-bases/{kb_id}/files/{filename}",
    summary="Delete a knowledge base file",
    description="Removes one file's vectors from LanceDB and deletes its metadata from the knowledge base.",
)
async def delete_kb_file(
    kb_id: str,
    filename: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Delete a file from the Knowledge Base.
    
    Removes vector data from LanceDB and deletes metadata from PostgreSQL.
    """
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    kb = db.query(KnowledgeBaseTable).filter(
        KnowledgeBaseTable.id == kb_id,
        KnowledgeBaseTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(KnowledgeBaseTable, owner_user_id, workspace.id),
    ).first()
    if not kb:
        raise HTTPException(status_code=404, detail="Knowledge Base not found")

    try:
        from datetime import datetime

        from src.config_bundle.storage import delete_document
        from src.tools.rag_tool import delete_documents_async

        # 1. Delete from LanceDB (async native)
        await delete_documents_async(agent_id=kb_id, source=filename)
        delete_document(kb_id, filename)

        # 2. Update PostgreSQL files JSON
        files_list = list(kb.files or [])
        updated_files = [f for f in files_list if f["name"] != filename]
        
        kb.files = updated_files
        kb.workspace_id = workspace.id
        kb.updated_at = datetime.utcnow().isoformat() + "Z"
        db.commit()
        db.refresh(kb)
        _invalidate_runtime_caches(owner_user_id=owner_user_id)

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

@router.post(
    "/agents/{agent_id}/upload",
    summary="Upload a legacy agent RAG document",
    description=(
        "Backward-compatible document upload endpoint keyed by agent profile id. "
        "New integrations should prefer `/api/knowledge-bases/{kb_id}/upload`."
    ),
)
async def upload_document(
    agent_id: str,
    file: UploadFile = File(...),
    chunk_size: int = Form(default=512),
    chunk_overlap: int = Form(default=64),
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Upload a document to the agent's RAG knowledge base.

    Accepts plain text, markdown, and PDF files.
    Splits into chunks, embeds, and stores in LanceDB.
    """
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    agent_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(AgentProfileTable, owner_user_id, workspace.id),
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


@router.get(
    "/agents/{agent_id}/rag-status",
    response_model=AgentRAGStatusResponse,
    summary="Get legacy agent RAG status",
    description="Returns the number of indexed rows in the legacy agent RAG LanceDB table.",
)
async def rag_status(
    agent_id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    """Return the number of documents in the agent's RAG knowledge base."""
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    agent_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(AgentProfileTable, owner_user_id, workspace.id),
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
