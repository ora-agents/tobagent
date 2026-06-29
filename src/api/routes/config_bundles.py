"""Configuration bundle import and export routes."""
# ruff: noqa: D103

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.workspace_utils import (
    get_active_workspace,
    get_workspace_header,
    require_workspace_manager,
)
from src.config_bundle.bundle import (
    build_export_bundle,
    execute_import,
    inspect_bundle,
    start_index_jobs,
)
from src.config_bundle.registry import (
    delete_inspection,
    get_inspection,
    get_job,
    put_inspection,
)
from src.config_bundle.schemas import (
    BundleExportRequest,
    BundleImportRequest,
    BundleImportResponse,
    BundleInspectionResponse,
    BundleJobResponse,
)
from src.utils.db import UserTable, get_db

router = APIRouter(prefix="/api/config-bundles", tags=["config-bundles"])


@router.post("/export", summary="Export a TOB configuration bundle")
async def export_config_bundle(
    request: BundleExportRequest,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    raw, warnings = build_export_bundle(db, request, workspace.owner_user_id)
    filename = "tob-config.tobconfig"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "X-TOB-Bundle-Warnings": str(len(warnings)),
    }
    return Response(raw, media_type="application/vnd.tob.config+zip", headers=headers)


@router.post(
    "/inspect",
    response_model=BundleInspectionResponse,
    summary="Inspect a TOB configuration bundle",
)
async def inspect_config_bundle(
    file: UploadFile = File(...),
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    inspection_id = f"inspection-{uuid.uuid4()}"
    response, entry = inspect_bundle(
        db, await file.read(), workspace.owner_user_id, inspection_id
    )
    put_inspection(inspection_id, entry)
    return response


@router.post(
    "/import",
    response_model=BundleImportResponse,
    summary="Import an inspected TOB configuration bundle",
)
async def import_config_bundle(
    request: BundleImportRequest,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    entry = get_inspection(request.inspectionId, workspace.owner_user_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Inspection not found or expired")
    response, jobs = execute_import(db, entry, request, workspace.owner_user_id)
    delete_inspection(request.inspectionId)
    start_index_jobs(jobs)
    return response


@router.get(
    "/jobs/{job_id}",
    response_model=BundleJobResponse,
    summary="Get a knowledge-base import job",
)
async def get_config_bundle_job(
    job_id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    job = get_job(job_id, workspace.owner_user_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return BundleJobResponse(
        id=job.id,
        status=job.status,
        resourceType=job.resource_type,
        resourceId=job.resource_id,
        processedDocuments=job.processed_documents,
        totalDocuments=job.total_documents,
        error=job.error,
    )
