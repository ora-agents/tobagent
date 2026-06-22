"""Client profile routes."""
# ruff: noqa: D103

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api.schemas import ClientProfileSchema
from src.utils.db import ClientProfileTable, get_db

router = APIRouter(tags=["client-profiles"])


# ---------------------------------------------------------------------------
# Client Profile CRUD
# ---------------------------------------------------------------------------

@router.get(
    "/api/client-profiles/{id}",
    response_model=ClientProfileSchema | None,
    summary="Get a client profile",
    description="Returns lightweight display metadata for a client id, or null when it has not been created.",
)
async def get_client_profile(id: str, db: Session = Depends(get_db)):
    profile = db.query(ClientProfileTable).filter(ClientProfileTable.id == id).first()
    if not profile:
        return None
    return ClientProfileSchema(
        id=profile.id,
        label=profile.label,
        avatarColor=profile.avatar_color,
    )


@router.post(
    "/api/client-profiles",
    response_model=ClientProfileSchema,
    summary="Create or update a client profile",
    description="Upserts lightweight display metadata for a client id.",
)
async def upsert_client_profile(profile_data: ClientProfileSchema, db: Session = Depends(get_db)):
    profile = db.query(ClientProfileTable).filter(ClientProfileTable.id == profile_data.id).first()
    if profile:
        profile.label = profile_data.label
        profile.avatar_color = profile_data.avatarColor
    else:
        profile = ClientProfileTable(
            id=profile_data.id,
            label=profile_data.label,
            avatar_color=profile_data.avatarColor,
            created_at=datetime.utcnow().isoformat(),
        )
        db.add(profile)
    db.commit()
    db.refresh(profile)
    return ClientProfileSchema(
        id=profile.id,
        label=profile.label,
        avatarColor=profile.avatar_color,
    )

