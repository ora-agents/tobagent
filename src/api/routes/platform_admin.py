"""Restricted, read-only API for the platform administration console."""

import base64
import os
import secrets
import uuid
from datetime import UTC, datetime
from io import BytesIO

import pyotp
import qrcode
from fastapi import APIRouter, Body, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from src.api.deps import hash_password, verify_password
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
    PlatformAdminTable,
    UserTable,
    get_db,
)

router = APIRouter(prefix="/api/platform-admin", tags=["platform-admin"])


class PlatformAdminRegisterRequest(BaseModel):
    """First platform-administrator account registration payload."""

    username: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=1024)
    totpCode: str = Field(pattern=r"^\d{6}$")


class PlatformAdminLoginRequest(BaseModel):
    """Platform-administrator sign-in payload."""

    username: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=1024)
    totpCode: str = Field(pattern=r"^\d{6}$")


class PlatformAdminPasswordRequest(BaseModel):
    """Platform-administrator password-change payload."""

    currentPassword: str = Field(min_length=1, max_length=1024)
    newPassword: str = Field(min_length=8, max_length=1024)
    totpCode: str = Field(pattern=r"^\d{6}$")


class PlatformAdminTotpRequest(BaseModel):
    """TOTP confirmation payload for a sensitive session action."""

    totpCode: str = Field(pattern=r"^\d{6}$")


def _configured_totp_secret() -> str:
    """Return the platform TOTP seed configured only on the server."""
    return os.getenv("PLATFORM_ADMIN_TOTP_SECRET", "").strip().replace(" ", "")


def _require_totp_configuration() -> str:
    """Require a valid server-side TOTP seed."""
    secret = _configured_totp_secret()
    if not secret:
        raise HTTPException(status_code=404, detail="Platform administration is disabled")
    try:
        pyotp.TOTP(secret).provisioning_uri(name="platform-admin", issuer_name="TOB Agent")
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Platform TOTP configuration is invalid") from exc
    return secret


def _verify_totp(code: str) -> None:
    """Validate a current authenticator code against the server-only seed."""
    secret = _require_totp_configuration()
    if not pyotp.TOTP(secret).verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid or expired authenticator code")


def _current_platform_admin(db: Session) -> PlatformAdminTable | None:
    """Return the singleton platform administrator account."""
    return db.query(PlatformAdminTable).order_by(PlatformAdminTable.created_at.asc()).first()


def _require_platform_admin(
    admin_session: str | None = Cookie(default=None, alias=PLATFORM_ADMIN_SESSION_COOKIE_NAME),
) -> None:
    """Require a valid platform-administrator session and enabled configuration."""
    _require_totp_configuration()
    if not verify_platform_admin_session_token(admin_session):
        raise HTTPException(status_code=401, detail="Platform administrator authentication required")


def _date_prefix(value: str | None) -> str:
    return (value or "")[:10]


@router.get("/session")
def platform_admin_session_status(
    _admin: None = Depends(_require_platform_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Return the current administrator-session status."""
    admin = _current_platform_admin(db)
    if not admin:
        raise HTTPException(status_code=401, detail="Platform administrator registration required")
    return {"authenticated": True, "username": admin.username}


@router.get("/setup-status")
def platform_admin_setup_status(db: Session = Depends(get_db)) -> dict[str, bool]:
    """Report whether TOTP is enabled and an administrator account exists."""
    _require_totp_configuration()
    return {"registered": _current_platform_admin(db) is not None}


@router.post("/totp/provisioning")
def create_platform_admin_totp_provisioning(
    setup_key: str | None = Header(default=None, alias="X-Platform-Admin-Setup-Key"),
) -> dict[str, str]:
    """Return a QR code for a deployment operator who already knows the TOTP seed."""
    secret = _require_totp_configuration()
    if not setup_key or not secrets.compare_digest(setup_key, secret):
        raise HTTPException(status_code=401, detail="Invalid platform administrator setup key")
    uri = pyotp.TOTP(secret).provisioning_uri(name="platform-admin", issuer_name="TOB Agent")
    image = qrcode.make(uri)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return {
        "issuer": "TOB Agent",
        "accountName": "platform-admin",
        "provisioningUri": uri,
        "qrCodeDataUrl": f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}",
    }


@router.post("/register")
def register_platform_admin(
    request: PlatformAdminRegisterRequest,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Register the singleton administrator after TOTP confirmation."""
    if _current_platform_admin(db):
        raise HTTPException(status_code=409, detail="Platform administrator is already registered")
    _verify_totp(request.totpCode)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    admin = PlatformAdminTable(
        id=f"platform-admin-{uuid.uuid4()}",
        username=request.username.strip(),
        password_hash=hash_password(request.password),
        created_at=now,
        updated_at=now,
    )
    db.add(admin)
    db.commit()
    return {"username": admin.username}


@router.post("/session")
def create_platform_admin_session(
    request: PlatformAdminLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Sign in with the administrator password and an authenticator code."""
    _verify_totp(request.totpCode)
    admin = _current_platform_admin(db)
    if not admin or admin.username != request.username.strip() or not verify_password(request.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Invalid administrator credentials")
    set_platform_admin_session_cookie(response)
    return {"authenticated": True, "username": admin.username}


@router.put("/password", status_code=204)
def update_platform_admin_password(
    request: PlatformAdminPasswordRequest,
    _admin: None = Depends(_require_platform_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Change the administrator password after password and TOTP confirmation."""
    admin = _current_platform_admin(db)
    if not admin or not verify_password(request.currentPassword, admin.password_hash):
        raise HTTPException(status_code=401, detail="Current administrator password is invalid")
    _verify_totp(request.totpCode)
    admin.password_hash = hash_password(request.newPassword)
    admin.updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    db.commit()
    return Response(status_code=204)


@router.delete("/session", status_code=204)
def delete_platform_admin_session(
    request: PlatformAdminTotpRequest = Body(...),
    _admin: None = Depends(_require_platform_admin),
) -> Response:
    """End the current platform-administrator session after TOTP confirmation."""
    _verify_totp(request.totpCode)
    response = Response(status_code=204)
    clear_platform_admin_session_cookie(response)
    return response


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
