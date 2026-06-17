"""Agent profile and sharing routes."""
# ruff: noqa: D103

import copy
import secrets
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    AgentProfileSchema,
    AgentProfileVersionSchema,
    AgentShareImportRequest,
    AgentShareImportResponse,
    AgentShareLinkRequest,
    AgentShareLinkSchema,
    AgentSharePreview,
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
)
from src.utils.db import (
    AgentProfileTable,
    AgentProfileVersionTable,
    AgentShareLinkTable,
    UserTable,
    get_db,
)
from src.utils.default_skills import ensure_default_skills

router = APIRouter()


# ---------------------------------------------------------------------------
# Agent Profile CRUD
# ---------------------------------------------------------------------------

@router.get("/api/agent-profiles", response_model=list[AgentProfileSchema])
async def get_agent_profiles(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    from src.utils.assets_import import is_default_agent_profile_id

    ensure_default_skills(db, current_user.id)
    default_profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == current_user.id,
    ).all()
    default_profile_ids = [
        profile.id
        for profile in default_profiles
        if is_default_agent_profile_id(profile.id)
    ]
    if default_profile_ids:
        _remove_agent_profile_links(db, current_user.id, "agent_ids", default_profile_ids)
        for profile in default_profiles:
            if profile.id in default_profile_ids:
                db.delete(profile)
    db.commit()

    profiles = db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == current_user.id
    ).all()
    return [_agent_profile_schema(p) for p in profiles]


@router.post("/api/agent-profiles", response_model=AgentProfileSchema)
async def create_agent_profile(
    profile_data: AgentProfileSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    # Check duplicate
    existing = db.query(AgentProfileTable).filter(AgentProfileTable.id == profile_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent profile already exists")
    _validate_agent_profile_links(db, profile_data, current_user.id, profile_data.id)
    
    new_profile = AgentProfileTable(
        id=profile_data.id,
        owner_user_id=current_user.id,
        name=profile_data.name,
        description=profile_data.description,
        system_prompt=profile_data.systemPrompt,
        model=(profile_data.model or "").strip() or None,
        enabled_tools=profile_data.enabledTools,
        knowledge_base_ids=profile_data.knowledgeBaseIds,
        skill_ids=profile_data.skillIds,
        mcp_ids=profile_data.mcpIds,
        agent_ids=profile_data.agentIds,
        wake_words=profile_data.wakeWords,
        role_template_id=profile_data.roleTemplateId,
        persona_style=profile_data.personaStyle,
        boundary_mode=profile_data.boundaryMode,
        tts_voice=profile_data.ttsVoice,
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
    _invalidate_runtime_caches(new_profile.id, current_user.id)
    return _agent_profile_schema(new_profile)


@router.put("/api/agent-profiles/{id}", response_model=AgentProfileSchema)
async def update_agent_profile(
    id: str,
    profile_data: AgentProfileSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _validate_agent_profile_links(db, profile_data, current_user.id, id)

    profile.name = profile_data.name
    profile.description = profile_data.description
    profile.system_prompt = profile_data.systemPrompt
    profile.model = (profile_data.model or "").strip() or None
    profile.enabled_tools = profile_data.enabledTools
    profile.knowledge_base_ids = profile_data.knowledgeBaseIds
    profile.skill_ids = profile_data.skillIds
    profile.mcp_ids = profile_data.mcpIds
    profile.agent_ids = profile_data.agentIds
    profile.wake_words = profile_data.wakeWords
    profile.role_template_id = profile_data.roleTemplateId
    profile.persona_style = profile_data.personaStyle
    profile.boundary_mode = profile_data.boundaryMode
    profile.tts_voice = profile_data.ttsVoice
    profile.voice_interruption_enabled = profile_data.voiceInterruptionEnabled
    profile.speaker_verification_enabled = profile_data.speakerVerificationEnabled
    profile.user_voiceprint_id = profile_data.userVoiceprintId
    profile.updated_at = profile_data.updatedAt
    _create_agent_profile_version(db, profile, profile.updated_at)
    
    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, current_user.id)
    return _agent_profile_schema(profile)


@router.get(
    "/api/agent-profiles/{id}/versions",
    response_model=list[AgentProfileVersionSchema],
)
async def get_agent_profile_versions(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    versions = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == current_user.id,
    ).order_by(AgentProfileVersionTable.version.desc()).all()
    return [_agent_profile_version_schema(version) for version in versions]


@router.post(
    "/api/agent-profiles/{id}/versions/{version_id}/restore",
    response_model=AgentProfileSchema,
)
async def restore_agent_profile_version(
    id: str,
    version_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    version = db.query(AgentProfileVersionTable).filter(
        AgentProfileVersionTable.id == version_id,
        AgentProfileVersionTable.agent_profile_id == id,
        AgentProfileVersionTable.owner_user_id == current_user.id,
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Agent profile version not found")

    restored = AgentProfileSchema.model_validate(version.snapshot)
    _validate_agent_profile_links(db, restored, current_user.id, id)

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    profile.name = restored.name
    profile.description = restored.description
    profile.system_prompt = restored.systemPrompt
    profile.model = (restored.model or "").strip() or None
    profile.enabled_tools = restored.enabledTools
    profile.knowledge_base_ids = restored.knowledgeBaseIds
    profile.skill_ids = restored.skillIds
    profile.mcp_ids = restored.mcpIds
    profile.agent_ids = restored.agentIds
    profile.wake_words = restored.wakeWords
    profile.role_template_id = restored.roleTemplateId
    profile.persona_style = restored.personaStyle
    profile.boundary_mode = restored.boundaryMode
    profile.tts_voice = restored.ttsVoice
    profile.voice_interruption_enabled = restored.voiceInterruptionEnabled
    profile.speaker_verification_enabled = restored.speakerVerificationEnabled
    profile.user_voiceprint_id = restored.userVoiceprintId
    profile.updated_at = now
    _create_agent_profile_version(db, profile, now)

    db.commit()
    db.refresh(profile)
    _invalidate_runtime_caches(id, current_user.id)
    return _agent_profile_schema(profile)


@router.post("/api/agent-profiles/{id}/share", response_model=AgentShareLinkSchema)
async def create_agent_share_link(
    id: str,
    share_data: AgentShareLinkRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    existing = db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == current_user.id,
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
            owner_user_id=current_user.id,
            agent_profile_id=id,
            include_options=include_options,
            created_at=now,
            updated_at=now,
        )
        db.add(share)

    db.commit()
    db.refresh(share)
    return _share_link_schema(share)


@router.get("/api/agent-shares/{token}", response_model=AgentSharePreview)
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
    }
    preview_agent = _agent_profile_schema(profile)
    preview_agent.knowledgeBaseIds = []
    preview_agent.skillIds = []
    preview_agent.mcpIds = []
    preview_agent.agentIds = []
    preview_agent.userVoiceprintId = None
    preview_agent.speakerVerificationEnabled = False
    preview_agent.speakerVerificationBound = False

    return AgentSharePreview(
        token=share.token,
        agent=preview_agent,
        include=include,
        resources=resources,
        createdAt=share.created_at,
    )


@router.post("/api/agent-shares/{token}/import", response_model=AgentShareImportResponse)
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
        name=(import_data.name or f"{source_profile.name} (shared)").strip(),
        description=source_profile.description,
        system_prompt=source_profile.system_prompt,
        model=source_profile.model,
        enabled_tools=copy.deepcopy(source_profile.enabled_tools or []),
        knowledge_base_ids=copied_ids["knowledgeBaseIds"],
        skill_ids=copied_ids["skillIds"],
        mcp_ids=copied_ids["mcpIds"],
        agent_ids=copied_ids["agentIds"],
        wake_words=copy.deepcopy(source_profile.wake_words or []),
        role_template_id=source_profile.role_template_id,
        persona_style=source_profile.persona_style,
        boundary_mode=source_profile.boundary_mode,
        tts_voice=source_profile.tts_voice,
        voice_interruption_enabled=source_profile.voice_interruption_enabled is not False,
        speaker_verification_enabled=False,
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


@router.delete("/api/agent-profiles/{id}")
async def delete_agent_profile(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == id,
        AgentProfileTable.owner_user_id == current_user.id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    _remove_agent_profile_links(db, current_user.id, "agent_ids", [id])
    db.query(AgentShareLinkTable).filter(
        AgentShareLinkTable.agent_profile_id == id,
        AgentShareLinkTable.owner_user_id == current_user.id,
    ).delete()
    db.delete(profile)
    db.commit()
    _invalidate_runtime_caches(id, current_user.id)
    return {"status": "success", "message": f"Agent profile {id} deleted"}


