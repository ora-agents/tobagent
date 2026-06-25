"""Skill routes."""
# ruff: noqa: D103

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import SkillSchema
from src.api.services import (
    _invalidate_runtime_caches,
    _remove_agent_profile_links,
    _skill_schema,
)
from src.utils.db import SkillTable, UserTable, get_db
from src.utils.default_skills import ensure_default_skills
from src.utils.skill_validation import SkillValidationError, skill_identity_from_content

router = APIRouter(tags=["skills"])


# ---------------------------------------------------------------------------
# Skill CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/api/skills",
    response_model=list[SkillSchema],
    summary="List skills",
    description="Lists prompt-based skills owned by the authenticated user, creating defaults when needed.",
)
async def get_skills(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    ensure_default_skills(db, current_user.id)
    db.commit()

    skills = db.query(SkillTable).filter(SkillTable.owner_user_id == current_user.id).all()
    return [_skill_schema(s) for s in skills]


@router.post(
    "/api/skills",
    response_model=SkillSchema,
    summary="Create a skill",
    description="Creates one prompt-based skill for the authenticated user.",
)
async def create_skill(
    skill_data: SkillSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
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
        owner_user_id=current_user.id,
        name=skill_name,
        description=skill_description,
        content=skill_data.content,
        created_at=skill_data.createdAt,
        updated_at=skill_data.updatedAt,
    )
    db.add(new_skill)
    db.commit()
    db.refresh(new_skill)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _skill_schema(new_skill)


@router.put(
    "/api/skills/{id}",
    response_model=SkillSchema,
    summary="Update a skill",
    description="Updates one owned prompt-based skill and invalidates runtime caches.",
)
async def update_skill(
    id: str,
    skill_data: SkillSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == current_user.id,
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
    skill.description = skill_description
    skill.content = skill_data.content
    skill.updated_at = skill_data.updatedAt
    
    db.commit()
    db.refresh(skill)
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return _skill_schema(skill)


@router.delete(
    "/api/skills/{id}",
    summary="Delete a skill",
    description="Deletes one owned skill and removes it from agent profiles that referenced it.",
)
async def delete_skill(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    skill = db.query(SkillTable).filter(
        SkillTable.id == id,
        SkillTable.owner_user_id == current_user.id,
    ).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    _remove_agent_profile_links(db, current_user.id, "skill_ids", [id])
    db.delete(skill)
    db.commit()
    _invalidate_runtime_caches(owner_user_id=current_user.id)
    return {"status": "success", "message": f"Skill {id} deleted"}
