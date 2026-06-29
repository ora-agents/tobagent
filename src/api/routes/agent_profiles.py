"""Agent profile and sharing routes."""
# ruff: noqa: D103

import copy
import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    AgentConfigTomlImportRequest,
    AgentConfigTomlImportResponse,
    AgentProfileSchema,
    AgentProfileVersionSchema,
    AgentShareImportRequest,
    AgentShareImportResponse,
    AgentShareLinkRequest,
    AgentShareLinkSchema,
    AgentSharePreview,
    WorkspaceChangeRequestSchema,
)
from src.api.services import (
    _agent_profile_schema,
    _agent_profile_version_schema,
    _copy_shared_agent_resources,
    _create_agent_profile_version,
    _invalidate_runtime_caches,
    _new_resource_id,
    _remove_agent_profile_links,
    _share_link_schema,
    _share_options_from_row,
    _validate_agent_profile_links,
    _workspace_change_request_schema,
    agent_profiles_to_toml,
    parse_agent_config_toml,
)
from src.api.workspace_utils import (
    MANAGER_ROLES,
    create_workspace_change_request_row,
    get_active_workspace,
    get_workspace_header,
    require_workspace_manager,
)
from src.utils.db import (
    AgentProfileTable,
    AgentProfileVersionTable,
    AgentShareLinkTable,
    FormRecordTable,
    FormTable,
    UserTable,
    get_db,
)
from src.utils.default_skills import ensure_default_skills
from src.utils.form_permissions import normalize_form_permissions

router = APIRouter(tags=["agent-profiles"])


def _is_system_agent_profile(profile: AgentProfileTable) -> bool:
    from src.utils.assets_import import (
        DEFAULT_AGENT_GRAPH_ID,
        is_default_agent_profile_id,
    )

    return profile.graph_id == DEFAULT_AGENT_GRAPH_ID or is_default_agent_profile_id(profile.id)


def _reject_system_agent_profile(profile: AgentProfileTable) -> None:
    if _is_system_agent_profile(profile):
        raise HTTPException(status_code=403, detail="System agent profiles cannot be modified")


def _empty_share_resource_map() -> dict[str, dict[str, str]]:
    return {
        "knowledgeBaseIds": {},
        "skillIds": {},
        "mcpIds": {},
        "agentIds": {},
        "formIds": {},
    }


def _share_import_signature(profile: AgentProfileTable) -> tuple:
    return (
        profile.name,
        profile.description,
        profile.system_prompt,
        profile.model,
        profile.graph_id,
        tuple(profile.enabled_tools or []),
        tuple(profile.wake_words or []),
        profile.role_template_id,
        profile.persona_style,
        profile.boundary_mode,
        profile.tts_voice,
        profile.voice_interruption_enabled is not False,
    )


def _find_existing_agent_share_import(
    db: Session,
    source_profile: AgentProfileTable,
    share: AgentShareLinkTable,
    owner_user_id: str,
) -> AgentProfileTable | None:
    existing_import = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
        AgentProfileTable.imported_from_share_id == share.id,
    ).first()
    if existing_import:
        return existing_import

    existing_import = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
        AgentProfileTable.imported_from_agent_profile_id == source_profile.id,
    ).first()
    if existing_import:
        return existing_import

    source_signature = _share_import_signature(source_profile)
    candidates = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
    ).all()
    for candidate in candidates:
        if _is_system_agent_profile(candidate):
            continue
        if _share_import_signature(candidate) == source_signature:
            candidate.imported_from_share_id = share.id
            candidate.imported_from_agent_profile_id = source_profile.id
            db.commit()
            db.refresh(candidate)
            return candidate

    return None


# ---------------------------------------------------------------------------
# Agent Profile CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/api/agent-profiles",
    response_model=list[AgentProfileSchema],
    summary="List agent profiles",
    description="Lists all custom agent profiles owned by the authenticated user.",
)
async def get_agent_profiles(
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    from src.utils.assets_import import (
        DEFAULT_AGENT_GRAPH_ID,
        ensure_default_agent_profile,
    )

    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    ensure_default_skills(db, owner_user_id)
    ensure_default_agent_profile(db, owner_user_id, workspace_id=workspace.id)
    db.commit()

    profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            and_(
                AgentProfileTable.workspace_id.is_(None),
                or_(
                    AgentProfileTable.graph_id.is_(None),
                    AgentProfileTable.graph_id != DEFAULT_AGENT_GRAPH_ID,
                ),
            ),
        ),
    ).all()
    return [_agent_profile_schema(p) for p in profiles]


@router.post(
    "/api/agent-profiles",
    response_model=AgentProfileSchema | WorkspaceChangeRequestSchema,
    summary="Create an agent profile",
    description=(
        "Creates a custom agent profile, including prompt, model, enabled tools, linked "
        "knowledge bases, skills, MCP servers, wake words, TTS voice, and optional voiceprint binding."
    ),
)
async def create_agent_profile(
    profile_data: AgentProfileSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    from src.utils.assets_import import (
        DEFAULT_AGENT_GRAPH_ID,
        is_default_agent_profile_id,
    )

    if (profile_data.graphId or "").strip() == DEFAULT_AGENT_GRAPH_ID or is_default_agent_profile_id(profile_data.id):
        raise HTTPException(status_code=403, detail="System agent profiles cannot be created by users")

    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="agent_profile",
            target_id=profile_data.id,
            action="create",
            payload=profile_data.model_dump(mode="json"),
        )
        return _workspace_change_request_schema(db, change)

    existing = db.query(AgentProfileTable).filter(AgentProfileTable.id == profile_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent profile already exists")
    _validate_agent_profile_links(db, profile_data, owner_user_id, profile_data.id)
    
    new_profile = AgentProfileTable(
        id=profile_data.id,
        owner_user_id=owner_user_id,
        workspace_id=workspace.id,
        name=profile_data.name,
        description=profile_data.description,
        system_prompt=profile_data.systemPrompt,
        model=(profile_data.model or "").strip() or None,
        graph_id=(profile_data.graphId or "").strip() or None,
        enabled_tools=profile_data.enabledTools,
        knowledge_base_ids=profile_data.knowledgeBaseIds,
        skill_ids=profile_data.skillIds,
        mcp_ids=profile_data.mcpIds,
        agent_ids=profile_data.agentIds,
        form_ids=profile_data.formIds,
        form_permissions=normalize_form_permissions(
            profile_data.formIds,
            profile_data.formPermissions,
        ),
        wake_words=profile_data.wakeWords,
        role_template_id=profile_data.roleTemplateId,
        persona_style=profile_data.personaStyle,
        boundary_mode=profile_data.boundaryMode,
        tts_voice=profile_data.ttsVoice,
        is_hidden=profile_data.isHidden,
        voice_interruption_enabled=profile_data.voiceInterruptionEnabled,
        speaker_verification_enabled=profile_data.speakerVerificationEnabled,
        user_voiceprint_id=profile_data.userVoiceprintId,
        created_at=profile_data.createdAt,
        updated_at=profile_data.updatedAt,
    )
    db.add(new_profile)
    _create_agent_profile_version(db, new_profile, profile_data.createdAt)
    db.commit()
    db.refresh(new_profile)
    _invalidate_runtime_caches(new_profile.id, owner_user_id)
    return _agent_profile_schema(new_profile)


@router.put(
    "/api/agent-profiles/{id}",
    response_model=AgentProfileSchema | WorkspaceChangeRequestSchema,
    summary="Update an agent profile",
    description="Updates an owned agent profile and records a profile version snapshot.",
)
async def update_agent_profile(
    id: str,
    profile_data: AgentProfileSchema,
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
            target_type="agent_profile",
            target_id=id,
            action="update",
            payload=profile_data.model_dump(mode="json"),
        )
        return _workspace_change_request_schema(db, change)
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _reject_system_agent_profile(profile)
    _validate_agent_profile_links(db, profile_data, owner_user_id, id)

    profile.name = profile_data.name
    profile.workspace_id = workspace.id
    profile.description = profile_data.description
    profile.system_prompt = profile_data.systemPrompt
    profile.model = (profile_data.model or "").strip() or None
    profile.graph_id = (profile_data.graphId or "").strip() or None
    profile.enabled_tools = profile_data.enabledTools
    profile.knowledge_base_ids = profile_data.knowledgeBaseIds
    profile.skill_ids = profile_data.skillIds
    profile.mcp_ids = profile_data.mcpIds
    profile.agent_ids = profile_data.agentIds
    profile.form_ids = profile_data.formIds
    profile.form_permissions = normalize_form_permissions(
        profile_data.formIds,
        profile_data.formPermissions,
    )
    profile.wake_words = profile_data.wakeWords
    profile.role_template_id = profile_data.roleTemplateId
    profile.persona_style = profile_data.personaStyle
    profile.boundary_mode = profile_data.boundaryMode
    profile.tts_voice = profile_data.ttsVoice
    profile.is_hidden = profile_data.isHidden
    profile.voice_interruption_enabled = profile_data.voiceInterruptionEnabled
    profile.speaker_verification_enabled = profile_data.speakerVerificationEnabled
    profile.user_voiceprint_id = profile_data.userVoiceprintId
    profile.updated_at = profile_data.updatedAt
    _create_agent_profile_version(db, profile, profile.updated_at)
    
    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, owner_user_id)
    return _agent_profile_schema(profile)


@router.get(
    "/api/agent-profiles/{id}/versions",
    response_model=list[AgentProfileVersionSchema],
    summary="List agent profile versions",
    description="Returns immutable version snapshots for one owned agent profile, newest first.",
)
async def get_agent_profile_versions(
    id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    versions = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == owner_user_id,
    ).order_by(AgentProfileVersionTable.version.desc()).all()
    return [_agent_profile_version_schema(version) for version in versions]


@router.post(
    "/api/agent-profiles/{id}/versions/{version_id}/restore",
    response_model=AgentProfileSchema,
    summary="Restore an agent profile version",
    description="Restores an owned agent profile from a saved version snapshot and creates a new version.",
)
async def restore_agent_profile_version(
    id: str,
    version_id: str,
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
            target_type="agent_profile",
            target_id=id,
            action="delete",
            payload={},
        )
        return _workspace_change_request_schema(db, change)
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _reject_system_agent_profile(profile)

    version = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.id == version_id,
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == owner_user_id,
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Agent profile version not found")

    restored = AgentProfileSchema.model_validate(version.snapshot)
    _validate_agent_profile_links(db, restored, owner_user_id, id)

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    profile.workspace_id = workspace.id
    profile.name = restored.name
    profile.description = restored.description
    profile.system_prompt = restored.systemPrompt
    profile.model = (restored.model or "").strip() or None
    profile.graph_id = (restored.graphId or "").strip() or None
    profile.enabled_tools = restored.enabledTools
    profile.knowledge_base_ids = restored.knowledgeBaseIds
    profile.skill_ids = restored.skillIds
    profile.mcp_ids = restored.mcpIds
    profile.agent_ids = restored.agentIds
    profile.form_ids = restored.formIds
    profile.form_permissions = normalize_form_permissions(
        restored.formIds,
        restored.formPermissions,
    )
    profile.wake_words = restored.wakeWords
    profile.role_template_id = restored.roleTemplateId
    profile.persona_style = restored.personaStyle
    profile.boundary_mode = restored.boundaryMode
    profile.tts_voice = restored.ttsVoice
    profile.is_hidden = restored.isHidden
    profile.voice_interruption_enabled = restored.voiceInterruptionEnabled
    profile.speaker_verification_enabled = restored.speakerVerificationEnabled
    profile.user_voiceprint_id = restored.userVoiceprintId
    profile.updated_at = now
    _create_agent_profile_version(db, profile, now)

    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, owner_user_id)
    return _agent_profile_schema(profile)


@router.post(
    "/api/agent-profiles/{id}/share",
    response_model=AgentShareLinkSchema,
    summary="Create or update an agent share link",
    description=(
        "Creates a share token for an owned agent profile or updates the existing token's "
        "resource include options."
    ),
)
async def create_agent_share_link(
    id: str,
    share_data: AgentShareLinkRequest,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _reject_system_agent_profile(profile)

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    existing = db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == owner_user_id,
    ).first()
    include_options = share_data.include.model_dump(mode="json")
    if existing:
        existing.include_options = include_options
        existing.updated_at = now
        share = existing
    else:
        share = AgentShareLinkTable(
            id=f"share-{uuid.uuid4()}",
            token=secrets.token_urlsafe(24),
            owner_user_id=owner_user_id,
            agent_profile_id=id,
            include_options=include_options,
            created_at=now,
            updated_at=now,
        )
        db.add(share)

    db.commit()
    db.refresh(share)
    return _share_link_schema(share)


@router.get(
    "/api/agent-shares/{token}",
    response_model=AgentSharePreview,
    summary="Preview a shared agent",
    description="Returns a public preview for a share token without exposing private resource ids or voiceprint bindings.",
)
async def get_agent_share_preview(
    token: str,
    db: Session = Depends(get_db),
):
    share = db.query(AgentShareLinkTable).filter(AgentShareLinkTable.token == token).first()
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")

    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == share.agent_profile_id,
        AgentProfileTable.owner_user_id == share.owner_user_id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Shared agent profile not found")

    include = _share_options_from_row(share)
    resources = {
        "knowledgeBases": len(profile.knowledge_base_ids or []) if include.knowledgeBases else 0,
        "skills": len(profile.skill_ids or []) if include.skills else 0,
        "mcpServers": len(profile.mcp_ids or []) if include.mcpServers else 0,
        "agents": len(profile.agent_ids or []) if include.agents else 0,
        "forms": len(profile.form_ids or []) if include.forms else 0,
    }
    preview_agent = _agent_profile_schema(profile)
    preview_agent.knowledgeBaseIds = []
    preview_agent.skillIds = []
    preview_agent.mcpIds = []
    preview_agent.agentIds = []
    preview_agent.formIds = []
    preview_agent.userVoiceprintId = None
    preview_agent.speakerVerificationEnabled = False
    preview_agent.speakerVerificationBound = False

    return AgentSharePreview(
        token=share.token,
        agent=preview_agent,
        ownerUserId=share.owner_user_id,
        include=include,
        resources=resources,
        createdAt=share.created_at,
    )


@router.post(
    "/api/agent-shares/{token}/import",
    response_model=AgentShareImportResponse,
    summary="Import a shared agent",
    description="Copies a shared agent profile into the authenticated user's account, optionally copying included resources.",
)
async def import_agent_share(
    token: str,
    import_data: AgentShareImportRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    share = db.query(AgentShareLinkTable).filter(AgentShareLinkTable.token == token).first()
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")

    source_profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == share.agent_profile_id,
        AgentProfileTable.owner_user_id == share.owner_user_id,
    ).first()
    if not source_profile:
        raise HTTPException(status_code=404, detail="Shared agent profile not found")

    if current_user.id == share.owner_user_id:
        return AgentShareImportResponse(
            agent=_agent_profile_schema(source_profile),
            resourceIdMap=_empty_share_resource_map(),
            warnings=[],
        )

    existing_import = _find_existing_agent_share_import(
        db,
        source_profile,
        share,
        current_user.id,
    )
    if existing_import:
        return AgentShareImportResponse(
            agent=_agent_profile_schema(existing_import),
            resourceIdMap=_empty_share_resource_map(),
            warnings=[],
        )

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    include = _share_options_from_row(share)
    copied_ids, id_map, warnings = _copy_shared_agent_resources(
        db,
        source_profile,
        current_user.id,
        include,
        now,
    )
    imported_profile = AgentProfileTable(
        id=_new_resource_id("agent"),
        owner_user_id=current_user.id,
        name=(import_data.name or source_profile.name).strip(),
        description=source_profile.description,
        system_prompt=source_profile.system_prompt,
        model=source_profile.model,
        graph_id=source_profile.graph_id,
        enabled_tools=copy.deepcopy(source_profile.enabled_tools or []),
        knowledge_base_ids=copied_ids["knowledgeBaseIds"],
        skill_ids=copied_ids["skillIds"],
        mcp_ids=copied_ids["mcpIds"],
        agent_ids=copied_ids["agentIds"],
        form_ids=copied_ids["formIds"],
        form_permissions={
            target_id: normalize_form_permissions(
                source_profile.form_ids,
                source_profile.form_permissions,
            ).get(source_id, ["read"])
            for source_id, target_id in id_map["formIds"].items()
        },
        wake_words=copy.deepcopy(source_profile.wake_words or []),
        role_template_id=source_profile.role_template_id,
        persona_style=source_profile.persona_style,
        boundary_mode=source_profile.boundary_mode,
        tts_voice=source_profile.tts_voice,
        is_hidden=bool(source_profile.is_hidden),
        voice_interruption_enabled=source_profile.voice_interruption_enabled is not False,
        speaker_verification_enabled=False,
        imported_from_share_id=share.id,
        imported_from_agent_profile_id=source_profile.id,
        created_at=now,
        updated_at=now,
    )
    db.add(imported_profile)
    _create_agent_profile_version(db, imported_profile, now)
    db.commit()
    db.refresh(imported_profile)
    _invalidate_runtime_caches(imported_profile.id, current_user.id)
    return AgentShareImportResponse(
        agent=_agent_profile_schema(imported_profile),
        resourceIdMap=id_map,
        warnings=list(dict.fromkeys(warnings)),
    )


@router.get(
    "/api/agent-profiles/{id}/export.toml",
    response_class=PlainTextResponse,
    summary="Export one agent profile as TOML",
    description="Exports an owned agent profile and linked forms/records as a standard TOML configuration bundle.",
)
async def export_agent_profile_toml(
    id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    form_ids = list(profile.form_ids or [])
    forms = db.query(FormTable).filter(
        FormTable.id.in_(form_ids),
        FormTable.owner_user_id == owner_user_id,
    ).all() if form_ids else []
    records_by_form_id = {}
    for form in forms:
        records_by_form_id[form.id] = db.query(FormRecordTable).filter(
            FormRecordTable.form_id == form.id,
            FormRecordTable.owner_user_id == owner_user_id,
        ).all()

    return PlainTextResponse(
        agent_profiles_to_toml(
            [profile],
            forms_by_id={form.id: form for form in forms},
            records_by_form_id=records_by_form_id,
        ),
        media_type="application/toml",
        headers={"Content-Disposition": f'attachment; filename="{profile.id}.toml"'},
    )


@router.post(
    "/api/agent-profiles/import.toml",
    response_model=AgentConfigTomlImportResponse,
    summary="Batch import agent profiles from TOML",
    description="Imports one or more agent profiles from a standard TOML bundle, including form definitions and records.",
)
async def import_agent_profiles_toml(
    import_data: AgentConfigTomlImportRequest,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    data = parse_agent_config_toml(import_data.toml)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    id_map: dict[str, dict[str, str]] = {
        "agentIds": {},
        "formIds": {},
    }
    warnings: list[str] = []

    raw_forms = data.get("forms") if isinstance(data.get("forms"), dict) else {}
    for source_id, raw_form in raw_forms.items():
        if not isinstance(raw_form, dict):
            continue
        target_id = _new_resource_id("form")
        fields_dict = raw_form.get("fields") if isinstance(raw_form.get("fields"), dict) else {}
        fields = []
        for field_id, field in fields_dict.items():
            if not isinstance(field, dict):
                continue
            fields.append({
                "id": str(field.get("id") or field_id),
                "label": str(field.get("label") or field_id),
                "type": str(field.get("type") or "text"),
                "required": bool(field.get("required", False)),
                "options": list(field.get("options") or []),
            })
        db.add(FormTable(
            id=target_id,
            owner_user_id=owner_user_id,
            workspace_id=workspace.id,
            name=str(raw_form.get("name") or source_id),
            description=str(raw_form.get("description") or ""),
            category=str(raw_form.get("category") or "").strip(),
            fields=fields,
            hooks=list(raw_form.get("hooks") or []),
            created_at=now,
            updated_at=now,
        ))
        id_map["formIds"][source_id] = target_id

        records_dict = raw_form.get("records") if isinstance(raw_form.get("records"), dict) else {}
        for record_id, record in records_dict.items():
            if not isinstance(record, dict):
                continue
            record_data = {
                key: value
                for key, value in record.items()
                if key not in {"id", "createdAt", "updatedAt"}
            }
            db.add(FormRecordTable(
                id=_new_resource_id("record"),
                form_id=target_id,
                owner_user_id=owner_user_id,
                workspace_id=workspace.id,
                data=record_data,
                created_at=now,
                updated_at=now,
            ))

    imported_profiles: list[AgentProfileTable] = []
    raw_agents = data.get("agents") if isinstance(data.get("agents"), dict) else {}
    for source_id, raw_agent in raw_agents.items():
        if not isinstance(raw_agent, dict):
            continue
        target_id = _new_resource_id("agent")
        id_map["agentIds"][source_id] = target_id
        form_ids = [
            id_map["formIds"][form_id]
            for form_id in list(raw_agent.get("formIds") or [])
            if form_id in id_map["formIds"]
        ]
        skipped_form_ids = [
            form_id
            for form_id in list(raw_agent.get("formIds") or [])
            if form_id not in id_map["formIds"]
        ]
        for form_id in skipped_form_ids:
            warnings.append(f"Form {form_id} was not present in the TOML bundle and was skipped.")
        source_form_permissions = (
            raw_agent.get("formPermissions")
            if isinstance(raw_agent.get("formPermissions"), dict)
            else {}
        )
        form_permissions = {
            id_map["formIds"][source_form_id]: permissions
            for source_form_id, permissions in source_form_permissions.items()
            if source_form_id in id_map["formIds"] and isinstance(permissions, list)
        }

        profile = AgentProfileTable(
            id=target_id,
            owner_user_id=owner_user_id,
            workspace_id=workspace.id,
            name=str(raw_agent.get("name") or source_id),
            description=str(raw_agent.get("description") or ""),
            system_prompt=str(raw_agent.get("systemPrompt") or ""),
            model=(str(raw_agent.get("model") or "").strip() or None),
            graph_id=(str(raw_agent.get("graphId") or "").strip() or None),
            enabled_tools=list(raw_agent.get("enabledTools") or []),
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            form_ids=form_ids,
            form_permissions=normalize_form_permissions(form_ids, form_permissions),
            wake_words=list(raw_agent.get("wakeWords") or []),
            role_template_id=raw_agent.get("roleTemplateId") or None,
            persona_style=raw_agent.get("personaStyle") or None,
            boundary_mode=raw_agent.get("boundaryMode") or None,
            tts_voice=raw_agent.get("ttsVoice") or None,
            is_hidden=bool(raw_agent.get("isHidden", False)),
            voice_interruption_enabled=raw_agent.get("voiceInterruptionEnabled", True) is not False,
            speaker_verification_enabled=False,
            created_at=now,
            updated_at=now,
        )
        db.add(profile)
        _create_agent_profile_version(db, profile, now)
        imported_profiles.append(profile)

    if not imported_profiles:
        raise HTTPException(status_code=400, detail="No agent profiles found in TOML bundle")

    db.commit()
    for profile in imported_profiles:
        db.refresh(profile)
        _invalidate_runtime_caches(profile.id, owner_user_id)

    return AgentConfigTomlImportResponse(
        agents=[_agent_profile_schema(profile) for profile in imported_profiles],
        resourceIdMap=id_map,
        warnings=list(dict.fromkeys(warnings)),
    )


@router.delete(
    "/api/agent-profiles/{id}",
    summary="Delete an agent profile",
    description="Deletes one owned agent profile, removes links to it, and invalidates runtime caches.",
)
async def delete_agent_profile(
    id: str,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = require_workspace_manager(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == owner_user_id,
        or_(
            AgentProfileTable.workspace_id == workspace.id,
            AgentProfileTable.workspace_id.is_(None),
        ),
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _reject_system_agent_profile(profile)
    _remove_agent_profile_links(db, owner_user_id, "agent_ids", [id])
    db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == owner_user_id,
    ).delete()
    db.delete(profile)
    db.commit()
    _invalidate_runtime_caches(id, owner_user_id)
    return {"status": "success", "message": f"Agent profile {id} deleted"}
