"""Skill routes."""
# ruff: noqa: D103

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import SkillSchema, WorkspaceChangeRequestSchema
from src.api.services import (
    _invalidate_runtime_caches,
    _remove_agent_profile_links,
    _skill_schema,
    _workspace_change_request_schema,
)
from src.api.workspace_utils import (
    MANAGER_ROLES,
    create_workspace_change_request_row,
    get_active_workspace,
    get_workspace_header,
    workspace_scoped_resource_filter,
)
from src.utils.db import SkillTable, UserTable, get_db
from src.utils.skill_validation import SkillValidationError, skill_identity_from_content

router = APIRouter(tags=["skills"])
DEFAULT_IMPORTED_SKILL_ID_PREFIX = "default_skill_"


def _delete_default_imported_skills(db: Session, owner_user_id: str) -> bool:
    default_skill_ids = [
        row.id
        for row in db.query(SkillTable.id).filter(
            SkillTable.owner_user_id == owner_user_id,
            SkillTable.id.like(f"{DEFAULT_IMPORTED_SKILL_ID_PREFIX}%"),
        ).all()
    ]
    if not default_skill_ids:
        return False

    _remove_agent_profile_links(db, owner_user_id, "skill_ids", default_skill_ids)
    db.query(SkillTable).filter(SkillTable.id.in_(default_skill_ids)).delete(
        synchronize_session=False,
    )
    return True


# ---------------------------------------------------------------------------
# Skill CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/api/skills",
    response_model=list[SkillSchema],
    summary="List skills",
    description="Lists prompt-based skills owned by the authenticated user.",
)
async def get_skills(
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, _member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if _delete_default_imported_skills(db, owner_user_id):
        db.commit()

    skills = db.query(SkillTable).filter(
        SkillTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(SkillTable, owner_user_id, workspace.id),
    ).all()
    return [_skill_schema(s) for s in skills]


@router.post(
    "/api/skills",
    response_model=SkillSchema | WorkspaceChangeRequestSchema,
    summary="Create a skill",
    description="Creates one prompt-based skill for the authenticated user.",
)
async def create_skill(
    skill_data: SkillSchema,
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
            target_type="skill",
            target_id=skill_data.id,
            action="create",
            payload=skill_data.model_dump(mode="json"),
        )
        return _workspace_change_request_schema(db, change)
    existing = db.query(SkillTable).filter(SkillTable.id == skill_data.id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Skill already exists")

    try:
        skill_name, skill_description = skill_identity_from_content(
            skill_data.content,
            fallback_name=skill_data.name,
            fallback_description=skill_data.description or "",
        )
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    new_skill = SkillTable(
        id=skill_data.id,
        owner_user_id=owner_user_id,
        workspace_id=workspace.id,
        name=skill_name,
        description=skill_description,
        content=skill_data.content,
        created_at=skill_data.createdAt,
        updated_at=skill_data.updatedAt,
    )
    db.add(new_skill)
    db.commit()
    db.refresh(new_skill)
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return _skill_schema(new_skill)


@router.put(
    "/api/skills/{id}",
    response_model=SkillSchema | WorkspaceChangeRequestSchema,
    summary="Update a skill",
    description="Updates one owned prompt-based skill and invalidates runtime caches.",
)
async def update_skill(
    id: str,
    skill_data: SkillSchema,
    workspace_id: str | None = Depends(get_workspace_header),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    workspace, member = get_active_workspace(db, current_user, workspace_id)
    owner_user_id = workspace.owner_user_id
    if member.role not in MANAGER_ROLES:
        existing_skill = db.query(SkillTable).filter(
            SkillTable.id == id,
            SkillTable.owner_user_id == owner_user_id,
            workspace_scoped_resource_filter(SkillTable, owner_user_id, workspace.id),
        ).first()
        payload = skill_data.model_dump(mode="json")
        if existing_skill:
            payload["previousValues"] = _skill_schema(existing_skill).model_dump(mode="json")
        change = create_workspace_change_request_row(
            db,
            workspace_id=workspace.id,
            requester_user_id=current_user.id,
            target_type="skill",
            target_id=id,
            action="update",
            payload=payload,
        )
        return _workspace_change_request_schema(db, change)
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(SkillTable, owner_user_id, workspace.id),
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    try:
        skill_name, skill_description = skill_identity_from_content(
            skill_data.content,
            fallback_name=skill_data.name,
            fallback_description=skill_data.description or "",
        )
    except SkillValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    skill.name = skill_name
    skill.workspace_id = workspace.id
    skill.description = skill_description
    skill.content = skill_data.content
    skill.updated_at = skill_data.updatedAt
    
    db.commit()
    db.refresh(skill)
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return _skill_schema(skill)


@router.delete(
    "/api/skills/{id}",
    summary="Delete a skill",
    description="Deletes one owned skill and removes it from agent profiles that referenced it.",
)
async def delete_skill(
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
            target_type="skill",
            target_id=id,
            action="delete",
            payload={},
        )
        return _workspace_change_request_schema(db, change)
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == owner_user_id,
        workspace_scoped_resource_filter(SkillTable, owner_user_id, workspace.id),
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    _remove_agent_profile_links(db, owner_user_id, "skill_ids", [id])
    db.delete(skill)
    db.commit()
    _invalidate_runtime_caches(owner_user_id=owner_user_id)
    return {"status": "success", "message": f"Skill {id} deleted"}
