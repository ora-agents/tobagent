"""Homepage testimonial routes."""
# ruff: noqa: D103

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import SiteTestimonialRequest, SiteTestimonialSchema
from src.utils.db import SiteTestimonialTable, UserTable, get_db

router = APIRouter(tags=["site-testimonials"])


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _testimonial_schema(
    testimonial: SiteTestimonialTable,
    current_user: UserTable | None = None,
) -> SiteTestimonialSchema:
    return SiteTestimonialSchema(
        id=testimonial.id,
        authorName=testimonial.author_name,
        role=testimonial.role,
        company=testimonial.company,
        rating=testimonial.rating,
        quote=testimonial.quote,
        createdAt=testimonial.created_at,
        updatedAt=testimonial.updated_at,
        isOwn=bool(current_user and testimonial.user_id == current_user.id),
    )


@router.get(
    "/api/site-testimonials",
    response_model=list[SiteTestimonialSchema],
    summary="List public homepage testimonials",
    description="Returns testimonials submitted by authenticated users for the public homepage.",
)
async def list_site_testimonials(db: Session = Depends(get_db)):
    rows = (
        db.query(SiteTestimonialTable)
        .order_by(SiteTestimonialTable.updated_at.desc())
        .limit(24)
        .all()
    )
    return [_testimonial_schema(row) for row in rows]


@router.post(
    "/api/site-testimonials",
    response_model=SiteTestimonialSchema,
    summary="Create or update the current user's homepage testimonial",
    description="Authenticated users can publish one testimonial; posting again updates their existing testimonial.",
)
async def upsert_site_testimonial(
    request: SiteTestimonialRequest,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    now = _utc_now()
    testimonial = (
        db.query(SiteTestimonialTable)
        .filter(SiteTestimonialTable.user_id == current_user.id)
        .first()
    )

    if testimonial:
        testimonial.author_name = current_user.username
        testimonial.role = request.role
        testimonial.company = request.company
        testimonial.rating = request.rating
        testimonial.quote = request.quote
        testimonial.updated_at = now
    else:
        testimonial = SiteTestimonialTable(
            id=f"testimonial-{uuid.uuid4().hex}",
            user_id=current_user.id,
            author_name=current_user.username,
            role=request.role,
            company=request.company,
            rating=request.rating,
            quote=request.quote,
            created_at=now,
            updated_at=now,
        )
        db.add(testimonial)

    db.commit()
    db.refresh(testimonial)
    return _testimonial_schema(testimonial, current_user)
