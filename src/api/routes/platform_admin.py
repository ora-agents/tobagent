"""Restricted, read-only API for the platform administration console."""

import os
import secrets
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from src.api.session_auth import (
    PLATFORM_ADMIN_SESSION_COOKIE_NAME,
    clear_platform_admin_session_cookie,
    set_platform_admin_session_cookie,
    verify_platform_admin_session_token,
)
from src.utils.db import (
    AgentProfileTable,
    AgentPurchaseTable,
    AgentShareLinkTable,
    PaymentOrderTable,
    UserTable,
    get_db,
)

router = APIRouter(prefix="/api/platform-admin", tags=["platform-admin"])


class PlatformAdminLoginRequest(BaseModel):
    """Administrator-key sign-in payload."""

    key: str = Field(min_length=1, max_length=1024)


def _configured_admin_key() -> str:
    """Return the configured key, or hide the console when it is disabled."""
    return os.getenv("PLATFORM_ADMIN_KEY", "").strip()


def _require_platform_admin(
    admin_session: str | None = Cookie(default=None, alias=PLATFORM_ADMIN_SESSION_COOKIE_NAME),
) -> None:
    """Require a valid platform-administrator session and enabled configuration."""
    if not _configured_admin_key():
        raise HTTPException(status_code=404, detail="Platform administration is disabled")
    if not verify_platform_admin_session_token(admin_session):
        raise HTTPException(status_code=401, detail="Platform administrator authentication required")


def _date_prefix(value: str | None) -> str:
    return (value or "")[:10]


@router.get("/session")
def platform_admin_session_status(
    _admin: None = Depends(_require_platform_admin),
) -> dict[str, bool]:
    """Return the current administrator-session status."""
    return {"authenticated": True}


@router.post("/session")
def create_platform_admin_session(
    request: PlatformAdminLoginRequest,
    response: Response,
) -> dict[str, bool]:
    """Exchange the environment-configured administrator key for an HttpOnly session."""
    configured_key = _configured_admin_key()
    if not configured_key:
        raise HTTPException(status_code=404, detail="Platform administration is disabled")
    if not secrets.compare_digest(request.key, configured_key):
        raise HTTPException(status_code=401, detail="Invalid administrator key")
    set_platform_admin_session_cookie(response)
    return {"authenticated": True}


@router.delete("/session", status_code=204)
def delete_platform_admin_session(response: Response) -> Response:
    """End the current platform-administrator session."""
    clear_platform_admin_session_cookie(response)
    return Response(status_code=204, headers=dict(response.headers))


@router.get("/overview")
def platform_admin_overview(
    _admin: None = Depends(_require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Return platform-level account, agent, and order totals."""
    today = datetime.now(UTC).date().isoformat()
    users = db.query(UserTable).all()
    orders = db.query(PaymentOrderTable).all()
    paid_orders = [order for order in orders if order.status == "paid"]
    return {
        "users": len(users),
        "registrationsToday": sum(_date_prefix(user.created_at) == today for user in users),
        "agentProfiles": db.query(func.count(AgentProfileTable.id)).scalar() or 0,
        "sharedAgents": db.query(func.count(AgentShareLinkTable.id)).scalar() or 0,
        "purchases": db.query(func.count(AgentPurchaseTable.id)).scalar() or 0,
        "orders": len(orders),
        "paidOrders": len(paid_orders),
        "paidAmountCents": sum(order.amount_cents or 0 for order in paid_orders),
    }


@router.get("/users")
def list_platform_users(
    offset: int = 0,
    limit: int = 50,
    search: str = "",
    _admin: None = Depends(_require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return paginated platform user records without credential material."""
    offset = max(offset, 0)
    limit = min(max(limit, 1), 100)
    query = db.query(UserTable)
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        query = query.filter(or_(UserTable.username.ilike(pattern), UserTable.phone.ilike(pattern), UserTable.email.ilike(pattern)))
    total = query.count()
    users = query.order_by(UserTable.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": user.id,
                "username": user.username,
                "phone": user.phone,
                "email": user.email,
                "createdAt": user.created_at,
            }
            for user in users
        ],
    }


@router.get("/orders")
def list_platform_orders(
    offset: int = 0,
    limit: int = 50,
    search: str = "",
    _admin: None = Depends(_require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return paginated payment orders with buyer and seller identities."""
    offset = max(offset, 0)
    limit = min(max(limit, 1), 100)
    buyer = aliased(UserTable)
    seller = aliased(UserTable)
    query = db.query(PaymentOrderTable, buyer.username, seller.username).outerjoin(
        buyer, PaymentOrderTable.buyer_user_id == buyer.id
    ).outerjoin(seller, PaymentOrderTable.seller_user_id == seller.id)
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        query = query.filter(or_(PaymentOrderTable.out_trade_no.ilike(pattern), PaymentOrderTable.status.ilike(pattern), buyer.username.ilike(pattern), seller.username.ilike(pattern)))
    total = query.count()
    rows = query.order_by(PaymentOrderTable.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "id": order.id,
                "outTradeNo": order.out_trade_no,
                "buyerUserId": order.buyer_user_id,
                "buyerUsername": buyer_username,
                "sellerUserId": order.seller_user_id,
                "sellerUsername": seller_username,
                "amountCents": order.amount_cents,
                "currency": order.currency,
                "status": order.status,
                "provider": order.provider,
                "createdAt": order.created_at,
                "paidAt": order.paid_at,
            }
            for order, buyer_username, seller_username in rows
        ],
    }
