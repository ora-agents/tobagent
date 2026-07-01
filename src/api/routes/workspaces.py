"""Workspace, membership, and change-request routes."""
# ruff: noqa: D103

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    AgentProfileSchema,
    FormRecordWriteSchema,
    FormSchema,
    KnowledgeBaseSchema,
    McpServerSchema,
    SkillSchema,
    WorkspaceChangeRequestCreate,
    WorkspaceChangeRequestReview,
    WorkspaceChangeRequestSchema,
    WorkspaceCreateRequest,
    WorkspaceMemberRoleUpdateRequest,
    WorkspaceMemberSchema,
    WorkspaceMemberUpsertRequest,
    WorkspaceSchema,
    WorkspaceUpdateRequest,
)
from src.api.services import (
    _create_agent_profile_version,
    _invalidate_runtime_caches,
    _remove_agent_profile_links,
    _validate_agent_profile_links,
)
from src.api.workspace_utils import (
    MANAGER_ROLES,
    create_workspace_change_request_row,
    ensure_default_workspace,
    get_active_workspace,
    require_workspace_manager,
    utc_now,
)
from src.utils.db import (
    AgentProfileTable,
    FormRecordTable,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
    UserTable,
    WorkspaceChangeRequestTable,
    WorkspaceMemberTable,
    WorkspaceTable,
    get_db,
)
from src.utils.form_hooks import trigger_form_hooks
from src.utils.form_permissions import normalize_form_permissions
from src.utils.form_records import FormRecordValidationError, normalize_form_record_data
from src.utils.skill_validation import SkillValidationError, skill_identity_from_content

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def _workspace_schema(
    workspace: WorkspaceTable,
    member: WorkspaceMemberTable,
) -> WorkspaceSchema:
    return WorkspaceSchema(
        id=workspace.id,
        name=workspace.name,
        ownerUserId=workspace.owner_user_id,
        currentUserRole=member.role,
        createdAt=workspace.created_at,
        updatedAt=workspace.updated_at,
    )


def _member_schema(db: Session, member: WorkspaceMemberTable) -> WorkspaceMemberSchema:
    user = db.query(UserTable).filter(UserTable.id == member.user_id).first()
    return WorkspaceMemberSchema(
        userId=member.user_id,
        username=user.username if user else None,
        role=member.role,
        status=member.status,
        createdAt=member.created_at,
        updatedAt=member.updated_at,
    )


def _change_request_schema(
    db: Session,
    change: WorkspaceChangeRequestTable,
) -> WorkspaceChangeRequestSchema:
    requester = db.query(UserTable).filter(UserTable.id == change.requester_user_id).first()
    return WorkspaceChangeRequestSchema(
        id=change.id,
        workspaceId=change.workspace_id,
        requesterUserId=change.requester_user_id,
        requesterUsername=requester.username if requester else None,
        targetType=change.target_type,
        targetId=change.target_id,
        action=change.action,
        payload=change.payload or {},
        status=change.status,
        reviewerUserId=change.reviewer_user_id,
        reviewNote=change.review_note,
        createdAt=change.created_at,
        reviewedAt=change.reviewed_at,
    )


def _resolve_member_user(db: Session, request: WorkspaceMemberUpsertRequest) -> UserTable:
    user = None
    if request.userId:
        user = db.query(UserTable).filter(UserTable.id == request.userId).first()
    if not user and request.username:
        user = db.query(UserTable).filter(UserTable.username == request.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("", response_model=list[WorkspaceSchema], summary="List workspaces")
async def list_workspaces(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    ensure_default_workspace(db, current_user)
    db.commit()
    rows = db.query(WorkspaceTable, WorkspaceMemberTable).join(
        WorkspaceMemberTable,
        WorkspaceMemberTable.workspace_id == WorkspaceTable.id,
    ).filter(
        WorkspaceMemberTable.user_id == current_user.id,
        WorkspaceMemberTable.status == "active",
    ).all()
    return [_workspace_schema(workspace, member) for workspace, member in rows]


@router.post("", response_model=WorkspaceSchema, summary="Create a workspace")
async def create_workspace(
    request: WorkspaceCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workspace name is required")
    now = utc_now()
    workspace = WorkspaceTable(
        id=f"workspace-{uuid.uuid4()}",
        name=name,
        owner_user_id=current_user.id,
        created_at=now,
        updated_at=now,
    )
    member = WorkspaceMemberTable(
        id=f"workspace-member-{uuid.uuid4()}",
        workspace_id=workspace.id,
        user_id=current_user.id,
        role="owner",
        status="active",
        created_at=now,
        updated_at=now,
    )
    db.add(workspace)
    db.add(member)
    db.commit()
    db.refresh(workspace)
    db.refresh(member)
    return _workspace_schema(workspace, member)


@router.get("/{workspace_id}", response_model=WorkspaceSchema, summary="Get a workspace")
async def get_workspace(
    workspace_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    return _workspace_schema(workspace, member)


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceSchema | WorkspaceChangeRequestSchema,
    summary="Update a workspace",
)
async def update_workspace(
    workspace_id: str,
    request: WorkspaceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workspace name is required")
    if member.role not in MANAGER_ROLES:
        payload = request.model_dump(mode="json")
        payload["previousValues"] = {"name": workspace.name}
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="workspace",
            target_id=workspace.id,
            action="update",
            payload=payload,
        )
        return _change_request_schema(db, change)
    workspace.name = name
    workspace.updated_at = utc_now()
    db.commit()
    db.refresh(workspace)
    return _workspace_schema(workspace, member)


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberSchema])
async def list_workspace_members(
    workspace_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    get_active_workspace(db, current_user, workspace_id)
    members = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace_id,
        WorkspaceMemberTable.status == "active",
    ).all()
    return [_member_schema(db, member) for member in members]


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberSchema)
async def upsert_workspace_member(
    workspace_id: str,
    request: WorkspaceMemberUpsertRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, actor = require_workspace_manager(db, current_user, workspace_id)
    if actor.role != "owner" and request.role == "admin":
        raise HTTPException(status_code=403, detail="Only the owner can assign admins")
    user = _resolve_member_user(db, request)
    if user.id == workspace.owner_user_id and request.role != "owner":
        raise HTTPException(status_code=400, detail="Owner role cannot be downgraded here")
    now = utc_now()
    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace_id,
        WorkspaceMemberTable.user_id == user.id,
    ).first()
    if member:
        member.role = request.role
        member.status = "active"
        member.updated_at = now
    else:
        member = WorkspaceMemberTable(
            id=f"workspace-member-{uuid.uuid4()}",
            workspace_id=workspace_id,
            user_id=user.id,
            role=request.role,
            status="active",
            created_at=now,
            updated_at=now,
        )
        db.add(member)
    db.commit()
    db.refresh(member)
    return _member_schema(db, member)


@router.patch("/{workspace_id}/members/{user_id}", response_model=WorkspaceMemberSchema)
async def update_workspace_member_role(
    workspace_id: str,
    user_id: str,
    request: WorkspaceMemberRoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, actor = require_workspace_manager(db, current_user, workspace_id)
    if actor.role != "owner" and request.role == "admin":
        raise HTTPException(status_code=403, detail="Only the owner can assign admins")
    if user_id == workspace.owner_user_id:
        raise HTTPException(status_code=400, detail="Owner role cannot be changed here")
    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace_id,
        WorkspaceMemberTable.user_id == user_id,
        WorkspaceMemberTable.status == "active",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Workspace member not found")
    member.role = request.role
    member.updated_at = utc_now()
    db.commit()
    db.refresh(member)
    return _member_schema(db, member)


@router.delete("/{workspace_id}/members/{user_id}")
async def remove_workspace_member(
    workspace_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, actor = require_workspace_manager(db, current_user, workspace_id)
    if user_id == workspace.owner_user_id:
        raise HTTPException(status_code=400, detail="Owner cannot be removed")
    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace_id,
        WorkspaceMemberTable.user_id == user_id,
        WorkspaceMemberTable.status == "active",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Workspace member not found")
    if member.role == "admin" and actor.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can remove admins")
    member.status = "removed"
    member.updated_at = utc_now()
    db.commit()
    return {"status": "success"}


@router.get("/{workspace_id}/change-requests", response_model=list[WorkspaceChangeRequestSchema])
async def list_workspace_change_requests(
    workspace_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    _, member = get_active_workspace(db, current_user, workspace_id)
    query = db.query(WorkspaceChangeRequestTable).filter(
        WorkspaceChangeRequestTable.workspace_id == workspace_id,
    )
    if member.role not in MANAGER_ROLES:
        query = query.filter(WorkspaceChangeRequestTable.requester_user_id == current_user.id)
    changes = query.order_by(WorkspaceChangeRequestTable.created_at.desc()).all()
    return [_change_request_schema(db, change) for change in changes]


@router.post("/{workspace_id}/change-requests", response_model=WorkspaceChangeRequestSchema)
async def create_workspace_change_request(
    workspace_id: str,
    request: WorkspaceChangeRequestCreate,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    get_active_workspace(db, current_user, workspace_id)
    change = create_workspace_change_request_row(
        db,
        workspace_id=workspace_id,
        requester_user_id=current_user.id,
        target_type=request.targetType,
        target_id=request.targetId,
        action=request.action,
        payload=request.payload,
    )
    return _change_request_schema(db, change)


def _apply_workspace_change(
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.action != "update":
        raise HTTPException(status_code=400, detail="Workspace changes only support update")
    name = str(change.payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workspace name is required")
    workspace.name = name
    workspace.updated_at = now


def _apply_agent_profile_change(
    db: Session,
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.action == "delete":
        if not change.target_id:
            raise HTTPException(status_code=400, detail="targetId is required")
        profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == change.target_id,
            AgentProfileTable.workspace_id == workspace.id,
        ).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Agent profile not found")
        db.delete(profile)
        _invalidate_runtime_caches(change.target_id, workspace.owner_user_id)
        return

    data = AgentProfileSchema.model_validate(change.payload)
    _validate_agent_profile_links(db, data, workspace.owner_user_id, data.id)
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == data.id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.owner_user_id == workspace.owner_user_id,
        ),
    ).first()
    if change.action == "create" and profile:
        raise HTTPException(status_code=400, detail="Agent profile already exists")
    if change.action == "update" and not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    if not profile:
        profile = AgentProfileTable(id=data.id, created_at=data.createdAt)
        db.add(profile)
    profile.owner_user_id = workspace.owner_user_id
    profile.workspace_id = workspace.id
    profile.name = data.name
    profile.description = data.description
    profile.system_prompt = data.systemPrompt
    profile.model = (data.model or "").strip() or None
    profile.model_temperature = data.modelTemperature
    profile.graph_id = (data.graphId or "").strip() or None
    profile.enabled_tools = data.enabledTools
    profile.knowledge_base_ids = data.knowledgeBaseIds
    profile.skill_ids = data.skillIds
    profile.skill_category_ids = data.skillCategoryIds
    profile.mcp_ids = data.mcpIds
    profile.agent_ids = data.agentIds
    profile.form_ids = data.formIds
    profile.form_category_ids = data.formCategoryIds
    profile.form_permissions = normalize_form_permissions(data.formIds, data.formPermissions)
    profile.wake_words = data.wakeWords
    profile.role_template_id = data.roleTemplateId
    profile.persona_style = data.personaStyle
    profile.boundary_mode = data.boundaryMode
    profile.tts_voice = data.ttsVoice
    profile.is_hidden = data.isHidden
    profile.voice_interruption_enabled = data.voiceInterruptionEnabled
    profile.speaker_verification_enabled = data.speakerVerificationEnabled
    profile.user_voiceprint_id = data.userVoiceprintId
    profile.updated_at = now
    _create_agent_profile_version(db, profile, now)
    _invalidate_runtime_caches(profile.id, workspace.owner_user_id)


def _apply_skill_change(
    db: Session,
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.action == "delete":
        if not change.target_id:
            raise HTTPException(status_code=400, detail="targetId is required")
        skill = db.query(SkillTable).filter(
            SkillTable.id == change.target_id,
            SkillTable.workspace_id == workspace.id,
        ).first()
        if not skill:
            raise HTTPException(status_code=404, detail="Skill not found")
        _remove_agent_profile_links(db, workspace.owner_user_id, "skill_ids", [change.target_id])
        db.delete(skill)
        _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)
        return
    data = SkillSchema.model_validate(change.payload)
    try:
        skill_name, skill_description = skill_identity_from_content(
            data.content,
            fallback_name=data.name,
            fallback_description=data.description or "",
        )
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    skill = db.query(SkillTable).filter(
        SkillTable.id == data.id,
        or_(SkillTable.workspace_id == workspace.id, SkillTable.owner_user_id == workspace.owner_user_id),
    ).first()
    if change.action == "create" and skill:
        raise HTTPException(status_code=400, detail="Skill already exists")
    if change.action == "update" and not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    if not skill:
        skill = SkillTable(id=data.id, created_at=data.createdAt)
        db.add(skill)
    skill.owner_user_id = workspace.owner_user_id
    skill.workspace_id = workspace.id
    skill.name = skill_name
    skill.description = skill_description
    skill.content = data.content
    skill.updated_at = now
    _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)


def _apply_form_change(
    db: Session,
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.action == "delete":
        if not change.target_id:
            raise HTTPException(status_code=400, detail="targetId is required")
        form = db.query(FormTable).filter(
            FormTable.id == change.target_id,
            FormTable.owner_user_id == workspace.owner_user_id,
            FormTable.workspace_id == workspace.id,
        ).first()
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")
        _remove_agent_profile_links(db, workspace.owner_user_id, "form_ids", [change.target_id])
        db.query(FormRecordTable).filter(
            FormRecordTable.form_id == change.target_id,
            FormRecordTable.owner_user_id == workspace.owner_user_id,
        ).delete()
        db.delete(form)
        _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)
        return

    data = FormSchema.model_validate(change.payload)
    form = db.query(FormTable).filter(
        FormTable.id == data.id,
        FormTable.owner_user_id == workspace.owner_user_id,
        or_(FormTable.workspace_id == workspace.id, FormTable.workspace_id.is_(None)),
    ).first()
    if change.action == "create" and form:
        raise HTTPException(status_code=400, detail="Form already exists")
    if change.action == "update" and not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if not form:
        form = FormTable(id=data.id, created_at=data.createdAt)
        db.add(form)
    form.owner_user_id = workspace.owner_user_id
    form.workspace_id = workspace.id
    form.name = data.name
    form.description = data.description
    form.category = data.category.strip()
    form.fields = [field.model_dump(mode="json") for field in data.fields]
    form.hooks = [hook.model_dump(mode="json") for hook in data.hooks]
    form.updated_at = now
    _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)


async def _apply_form_record_change(
    db: Session,
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    form_id = change.payload.get("formId") or change.payload.get("form_id")
    if not isinstance(form_id, str) or not form_id.strip():
        raise HTTPException(status_code=400, detail="formId is required")
    form = db.query(FormTable).filter(
        FormTable.id == form_id,
        FormTable.owner_user_id == workspace.owner_user_id,
        or_(FormTable.workspace_id == workspace.id, FormTable.workspace_id.is_(None)),
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    if change.action == "delete":
        record_id = change.target_id or change.payload.get("id")
        if not isinstance(record_id, str) or not record_id.strip():
            raise HTTPException(status_code=400, detail="targetId is required")
        record = db.query(FormRecordTable).filter(
            FormRecordTable.id == record_id,
            FormRecordTable.form_id == form_id,
            FormRecordTable.owner_user_id == workspace.owner_user_id,
        ).first()
        if not record:
            raise HTTPException(status_code=404, detail="Form record not found")
        db.delete(record)
        return

    data = FormRecordWriteSchema.model_validate(change.payload)
    record_id = data.id or change.target_id or str(uuid.uuid4())
    record = db.query(FormRecordTable).filter(
        FormRecordTable.id == record_id,
        FormRecordTable.form_id == form_id,
        FormRecordTable.owner_user_id == workspace.owner_user_id,
    ).first()
    if change.action == "create" and record:
        raise HTTPException(status_code=400, detail="Form record already exists")
    if change.action == "update" and not record:
        raise HTTPException(status_code=404, detail="Form record not found")

    old_data = dict(record.data or {}) if record else {}
    try:
        new_data = normalize_form_record_data(form.fields, data.data)
    except FormRecordValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not record:
        record = FormRecordTable(
            id=record_id,
            form_id=form_id,
            owner_user_id=workspace.owner_user_id,
            workspace_id=workspace.id,
            data=new_data,
            created_at=data.createdAt or now,
            updated_at=data.updatedAt or now,
        )
        db.add(record)
        db.flush()
    else:
        record.workspace_id = workspace.id
        record.data = new_data
        record.updated_at = data.updatedAt or now
    await trigger_form_hooks(form, record, old_data, new_data)


def _apply_simple_metadata_change(
    db: Session,
    workspace: WorkspaceTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.target_type == "knowledge_base":
        table = KnowledgeBaseTable
        schema = KnowledgeBaseSchema
        not_found = "Knowledge Base not found"
    elif change.target_type == "mcp_server":
        table = McpServerTable
        schema = McpServerSchema
        not_found = "MCP Server not found"
    else:
        raise HTTPException(status_code=400, detail="Unsupported change target")

    if change.action == "delete":
        if not change.target_id:
            raise HTTPException(status_code=400, detail="targetId is required")
        row = db.query(table).filter(table.id == change.target_id, table.workspace_id == workspace.id).first()
        if not row:
            raise HTTPException(status_code=404, detail=not_found)
        if change.target_type == "knowledge_base":
            _remove_agent_profile_links(db, workspace.owner_user_id, "knowledge_base_ids", [change.target_id])
        if change.target_type == "mcp_server":
            _remove_agent_profile_links(db, workspace.owner_user_id, "mcp_ids", [change.target_id])
        db.delete(row)
        _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)
        return

    data = schema.model_validate(change.payload)
    row = db.query(table).filter(
        table.id == data.id,
        or_(table.workspace_id == workspace.id, table.owner_user_id == workspace.owner_user_id),
    ).first()
    if change.action == "create" and row:
        raise HTTPException(status_code=400, detail=f"{change.target_type} already exists")
    if change.action == "update" and not row:
        raise HTTPException(status_code=404, detail=not_found)
    if not row:
        row = table(id=data.id, created_at=data.createdAt)
        db.add(row)
    row.owner_user_id = workspace.owner_user_id
    row.workspace_id = workspace.id
    row.name = data.name
    row.description = getattr(data, "description", None)
    row.updated_at = now
    if change.target_type == "knowledge_base":
        row.files = [f.model_dump(mode="json") for f in data.files]
        row.import_status = data.importStatus
        row.import_error = data.importError
    else:
        row.type = "streamable_http"
        row.url = data.url
        row.headers = data.headers
        row.tools = data.tools
        row.resources = data.resources
        row.prompts = data.prompts
    _invalidate_runtime_caches(owner_user_id=workspace.owner_user_id)


def _apply_workspace_member_change(
    db: Session,
    workspace: WorkspaceTable,
    reviewer: WorkspaceMemberTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.action != "update":
        raise HTTPException(status_code=400, detail="Workspace member changes only support update")
    user_id = change.target_id or change.payload.get("userId")
    role = change.payload.get("role")
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(status_code=400, detail="targetId is required")
    if role not in {"admin", "member"}:
        raise HTTPException(status_code=400, detail="Invalid workspace member role")
    if user_id == workspace.owner_user_id:
        raise HTTPException(status_code=400, detail="Owner role cannot be changed here")
    if role == "admin" and reviewer.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can approve admin role changes")

    member = db.query(WorkspaceMemberTable).filter(
        WorkspaceMemberTable.workspace_id == workspace.id,
        WorkspaceMemberTable.user_id == user_id,
        WorkspaceMemberTable.status == "active",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Workspace member not found")
    member.role = role
    member.updated_at = now


async def _apply_change_request(
    db: Session,
    workspace: WorkspaceTable,
    reviewer: WorkspaceMemberTable,
    change: WorkspaceChangeRequestTable,
    now: str,
) -> None:
    if change.target_type == "workspace":
        _apply_workspace_change(workspace, change, now)
    elif change.target_type == "agent_profile":
        _apply_agent_profile_change(db, workspace, change, now)
    elif change.target_type == "skill":
        _apply_skill_change(db, workspace, change, now)
    elif change.target_type in {"knowledge_base", "mcp_server"}:
        _apply_simple_metadata_change(db, workspace, change, now)
    elif change.target_type == "form":
        _apply_form_change(db, workspace, change, now)
    elif change.target_type == "form_record":
        await _apply_form_record_change(db, workspace, change, now)
    elif change.target_type == "workspace_member":
        _apply_workspace_member_change(db, workspace, reviewer, change, now)
    else:
        raise HTTPException(status_code=400, detail="This change target cannot be applied yet")


@router.post("/{workspace_id}/change-requests/{request_id}/approve", response_model=WorkspaceChangeRequestSchema)
async def approve_workspace_change_request(
    workspace_id: str,
    request_id: str,
    review: WorkspaceChangeRequestReview,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, reviewer = require_workspace_manager(db, current_user, workspace_id)
    change = db.query(WorkspaceChangeRequestTable).filter(
        WorkspaceChangeRequestTable.id == request_id,
        WorkspaceChangeRequestTable.workspace_id == workspace_id,
    ).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change request not found")
    if change.status != "pending":
        raise HTTPException(status_code=400, detail="Change request is already reviewed")
    now = utc_now()
    await _apply_change_request(db, workspace, reviewer, change, now)
    change.status = "applied"
    change.reviewer_user_id = current_user.id
    change.review_note = review.note
    change.reviewed_at = now
    db.commit()
    db.refresh(change)
    return _change_request_schema(db, change)


@router.post("/{workspace_id}/change-requests/{request_id}/reject", response_model=WorkspaceChangeRequestSchema)
async def reject_workspace_change_request(
    workspace_id: str,
    request_id: str,
    review: WorkspaceChangeRequestReview,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    require_workspace_manager(db, current_user, workspace_id)
    change = db.query(WorkspaceChangeRequestTable).filter(
        WorkspaceChangeRequestTable.id == request_id,
        WorkspaceChangeRequestTable.workspace_id == workspace_id,
    ).first()
    if not change:
        raise HTTPException(status_code=404, detail="Change request not found")
    if change.status != "pending":
        raise HTTPException(status_code=400, detail="Change request is already reviewed")
    change.status = "rejected"
    change.reviewer_user_id = current_user.id
    change.review_note = review.note
    change.reviewed_at = utc_now()
    db.commit()
    db.refresh(change)
    return _change_request_schema(db, change)
