"""Payment, purchase entitlement, and wallet routes."""
# ruff: noqa: D103

import base64
import json
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.local_dev import is_local_dev_request
from src.api.schemas import (
    AgentShareAccessResponse,
    AgentSharePurchaseRequest,
    AgentSharePurchaseResponse,
    PaymentOrderResponse,
    WalletSummaryResponse,
)
from src.utils.db import (
    AgentProfileTable,
    AgentPurchaseTable,
    AgentShareLinkTable,
    AgentShareTrialTable,
    PaymentOrderTable,
    UserTable,
    WalletLedgerEntryTable,
    get_db,
)

router = APIRouter(tags=["payments"])


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _find_share(db: Session, token_or_slug: str) -> AgentShareLinkTable | None:
    value = token_or_slug.strip()
    return db.query(AgentShareLinkTable).filter(
        (AgentShareLinkTable.token == value) | (AgentShareLinkTable.custom_slug == value)
    ).first()


def _has_purchase(db: Session, share: AgentShareLinkTable, user_id: str) -> bool:
    if user_id == share.owner_user_id:
        return True
    if not _share_requires_purchase(share):
        return True
    return db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.share_id == share.id,
        AgentPurchaseTable.buyer_user_id == user_id,
        (
            (AgentPurchaseTable.access_expires_at.is_(None))
            | (AgentPurchaseTable.access_expires_at > _now())
        ),
    ).first() is not None


def _active_purchase(db: Session, share: AgentShareLinkTable, user_id: str) -> AgentPurchaseTable | None:
    if user_id == share.owner_user_id or not _share_requires_purchase(share):
        return None
    now = _now()
    return db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.share_id == share.id,
        AgentPurchaseTable.buyer_user_id == user_id,
        (
            (AgentPurchaseTable.access_expires_at.is_(None))
            | (AgentPurchaseTable.access_expires_at > now)
        ),
    ).order_by(AgentPurchaseTable.created_at.desc()).first()


def _share_requires_purchase(share: AgentShareLinkTable) -> bool:
    if (getattr(share, "pricing_mode", None) or "one_time") == "subscription":
        return bool(getattr(share, "subscription_plans", None) or [])
    return int(share.price_cents or 0) > 0


def _find_subscription_plan(share: AgentShareLinkTable, plan_id: str | None) -> dict:
    plans = getattr(share, "subscription_plans", None) or []
    if not plans:
        raise HTTPException(status_code=400, detail="This share has no subscription plans")
    if plan_id:
        plan = next((item for item in plans if str(item.get("id") or "") == plan_id), None)
        if not plan:
            raise HTTPException(status_code=400, detail="Subscription plan not found")
        return plan
    return plans[0]


def _share_access_expires_at(share: AgentShareLinkTable, plan: dict | None, now: datetime) -> str | None:
    if (getattr(share, "pricing_mode", None) or "one_time") != "subscription":
        return None
    duration_days = int((plan or {}).get("durationDays") or 0)
    if duration_days <= 0:
        raise HTTPException(status_code=400, detail="Subscription plan duration is invalid")
    return (now + timedelta(days=duration_days)).isoformat().replace("+00:00", "Z")


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _ensure_share_trial(
    db: Session,
    share: AgentShareLinkTable,
    user_id: str,
    now: datetime,
) -> AgentShareTrialTable | None:
    duration_minutes = int(getattr(share, "trial_duration_minutes", 0) or 0)
    if user_id == share.owner_user_id or not _share_requires_purchase(share) or duration_minutes <= 0:
        return None

    trial = db.query(AgentShareTrialTable).filter(
        AgentShareTrialTable.share_id == share.id,
        AgentShareTrialTable.user_id == user_id,
    ).first()
    if trial:
        return trial

    started_at = now.isoformat().replace("+00:00", "Z")
    expires_at = (now + timedelta(minutes=duration_minutes)).isoformat().replace("+00:00", "Z")
    trial = AgentShareTrialTable(
        id=f"trial-{uuid.uuid4()}",
        share_id=share.id,
        user_id=user_id,
        started_at=started_at,
        expires_at=expires_at,
    )
    db.add(trial)
    db.commit()
    db.refresh(trial)
    return trial


def _share_trial_state(
    db: Session,
    share: AgentShareLinkTable,
    user_id: str,
    now: datetime,
) -> tuple[bool, str | None]:
    trial = _ensure_share_trial(db, share, user_id, now)
    expires_at = _parse_iso_datetime(trial.expires_at if trial else None)
    expires_text = trial.expires_at if trial else None
    return bool(expires_at and expires_at > now), expires_text


def _wechat_configured() -> bool:
    required = [
        "WECHAT_PAY_APPID",
        "WECHAT_PAY_MCHID",
        "WECHAT_PAY_SERIAL_NO",
        "WECHAT_PAY_NOTIFY_URL",
    ]
    private_key_path = os.getenv("WECHAT_PAY_PRIVATE_KEY_PATH", "").strip()
    return all(os.getenv(key) for key in required) and bool(
        private_key_path and os.path.isfile(private_key_path)
    )


def _can_use_local_direct_payment(request: Request) -> bool:
    return is_local_dev_request(request) and not _wechat_configured()


def _payment_order_response(
    order: PaymentOrderTable,
    *,
    include_code_url: bool = False,
) -> AgentSharePurchaseResponse:
    return AgentSharePurchaseResponse(
        orderId=order.id,
        outTradeNo=order.out_trade_no,
        status=order.status,
        amountCents=order.amount_cents,
        currency=order.currency,
        pricingMode=order.pricing_mode,
        pricingPlanId=order.pricing_plan_id,
        accessExpiresAt=order.access_expires_at,
        codeUrl=order.code_url if include_code_url else None,
        paymentProvider=order.provider,
        paymentConfigured=_wechat_configured(),
    )


def _wechat_authorization(method: str, url_path: str, body: str) -> str:
    mchid = os.environ["WECHAT_PAY_MCHID"]
    serial_no = os.environ["WECHAT_PAY_SERIAL_NO"]
    private_key_path = os.environ["WECHAT_PAY_PRIVATE_KEY_PATH"]
    timestamp = str(int(datetime.now(UTC).timestamp()))
    nonce = secrets.token_urlsafe(16)
    message = f"{method}\n{url_path}\n{timestamp}\n{nonce}\n{body}\n".encode()
    with open(private_key_path, "rb") as key_file:
        private_key = serialization.load_pem_private_key(key_file.read(), password=None)
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA256())
    signature_b64 = base64.b64encode(signature).decode()
    return (
        'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{mchid}",nonce_str="{nonce}",signature="{signature_b64}",'
        f'timestamp="{timestamp}",serial_no="{serial_no}"'
    )


async def _create_wechat_native_order(order: PaymentOrderTable, agent_name: str) -> str:
    if not _wechat_configured():
        raise HTTPException(status_code=503, detail="WeChat Pay is not configured")

    url_path = "/v3/pay/transactions/native"
    payload = {
        "appid": os.environ["WECHAT_PAY_APPID"],
        "mchid": os.environ["WECHAT_PAY_MCHID"],
        "description": f"Agent: {agent_name}"[:127],
        "out_trade_no": order.out_trade_no,
        "notify_url": os.environ["WECHAT_PAY_NOTIFY_URL"],
        "amount": {"total": order.amount_cents, "currency": order.currency},
    }
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    headers = {
        "Authorization": _wechat_authorization("POST", url_path, body),
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "tobagent/0.1",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(f"https://api.mch.weixin.qq.com{url_path}", headers=headers, content=body)
    if response.status_code not in {200, 201}:
        raise HTTPException(status_code=502, detail=f"WeChat Native order failed: {response.text}")
    data = response.json()
    code_url = data.get("code_url")
    if not code_url:
        raise HTTPException(status_code=502, detail="WeChat Native order response missing code_url")
    return code_url


def _grant_paid_access(db: Session, order: PaymentOrderTable, paid_at: str, payload: dict | None = None) -> None:
    if order.status == "paid":
        return
    order.status = "paid"
    order.paid_at = paid_at
    order.updated_at = paid_at
    order.provider_payload = payload or order.provider_payload or {}
    if payload:
        order.provider_transaction_id = payload.get("transaction_id") or order.provider_transaction_id

    purchase = db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.order_id == order.id,
    ).first()
    if not purchase:
        db.add(AgentPurchaseTable(
            id=f"purchase-{uuid.uuid4()}",
            buyer_user_id=order.buyer_user_id,
            seller_user_id=order.seller_user_id,
            agent_profile_id=order.agent_profile_id,
            share_id=order.share_id,
            order_id=order.id,
            pricing_mode=order.pricing_mode,
            pricing_plan_id=order.pricing_plan_id,
            price_cents=order.amount_cents,
            currency=order.currency,
            access_expires_at=order.access_expires_at,
            created_at=paid_at,
        ))

    ledger = db.query(WalletLedgerEntryTable).filter(
        WalletLedgerEntryTable.order_id == order.id,
        WalletLedgerEntryTable.user_id == order.seller_user_id,
        WalletLedgerEntryTable.entry_type == "agent_sale",
    ).first()
    if not ledger:
        db.add(WalletLedgerEntryTable(
            id=f"ledger-{uuid.uuid4()}",
            user_id=order.seller_user_id,
            order_id=order.id,
            entry_type="agent_sale",
            amount_cents=order.amount_cents,
            currency=order.currency,
            description=f"Paid agent sale for {order.agent_profile_id}",
            created_at=paid_at,
        ))


def _decrypt_wechat_resource(body: dict) -> dict:
    api_v3_key = os.getenv("WECHAT_PAY_API_V3_KEY")
    if not api_v3_key:
        raise HTTPException(status_code=500, detail="WECHAT_PAY_API_V3_KEY is not configured")
    resource = body.get("resource") or {}
    nonce = (resource.get("nonce") or "").encode()
    associated_data = (resource.get("associated_data") or "").encode()
    ciphertext = base64.b64decode(resource.get("ciphertext") or "")
    plaintext = AESGCM(api_v3_key.encode()).decrypt(nonce, ciphertext, associated_data)
    return json.loads(plaintext.decode())


@router.get("/api/agent-shares/{token}/access", response_model=AgentShareAccessResponse)
async def get_agent_share_access(
    token: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    share = _find_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")
    now = datetime.now(UTC)
    purchased = _has_purchase(db, share, current_user.id)
    purchase = _active_purchase(db, share, current_user.id) if purchased else None
    trial_active, trial_expires_at = (False, None)
    if not purchased:
        trial_active, trial_expires_at = _share_trial_state(db, share, current_user.id, now)
    return AgentShareAccessResponse(
        token=share.token,
        agentProfileId=share.agent_profile_id,
        purchased=purchased,
        requiresPurchase=_share_requires_purchase(share) and current_user.id != share.owner_user_id,
        pricingMode=getattr(share, "pricing_mode", None) or "one_time",
        priceCents=int(share.price_cents or 0),
        currency=share.currency or "CNY",
        subscriptionPlans=getattr(share, "subscription_plans", None) or [],
        accessExpiresAt=purchase.access_expires_at if purchase else None,
        trialDurationMinutes=int(getattr(share, "trial_duration_minutes", 0) or 0),
        trialActive=trial_active,
        trialExpiresAt=trial_expires_at,
    )


@router.post("/api/agent-shares/{token}/purchase", response_model=AgentSharePurchaseResponse)
async def purchase_agent_share(
    token: str,
    request: Request,
    purchase_data: AgentSharePurchaseRequest | None = None,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    share = _find_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="Agent share link not found")
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == share.agent_profile_id,
        AgentProfileTable.owner_user_id == share.owner_user_id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Shared agent profile not found")
    pricing_mode = getattr(share, "pricing_mode", None) or "one_time"
    selected_plan = _find_subscription_plan(share, purchase_data.planId if purchase_data else None) if pricing_mode == "subscription" else None
    amount = int((selected_plan or {}).get("priceCents") or share.price_cents or 0)
    access_expires_at = _share_access_expires_at(share, selected_plan, datetime.now(UTC))
    if amount <= 0 or current_user.id == share.owner_user_id:
        now = _now()
        order = PaymentOrderTable(
            id=f"order-{uuid.uuid4()}",
            out_trade_no=f"TOB{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4).upper()}",
            buyer_user_id=current_user.id,
            seller_user_id=share.owner_user_id,
            agent_profile_id=share.agent_profile_id,
            share_id=share.id,
            pricing_mode=pricing_mode,
            pricing_plan_id=(selected_plan or {}).get("id"),
            amount_cents=0,
            currency=share.currency or "CNY",
            status="paid",
            access_expires_at=access_expires_at,
            created_at=now,
            updated_at=now,
            paid_at=now,
        )
        db.add(order)
        _grant_paid_access(db, order, now)
        db.commit()
        return _payment_order_response(order)

    existing_paid = db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.share_id == share.id,
        AgentPurchaseTable.buyer_user_id == current_user.id,
        (
            (AgentPurchaseTable.access_expires_at.is_(None))
            | (AgentPurchaseTable.access_expires_at > _now())
        ),
    ).first()
    if existing_paid:
        raise HTTPException(status_code=409, detail="Agent share already purchased")

    pending = db.query(PaymentOrderTable).filter(
        PaymentOrderTable.share_id == share.id,
        PaymentOrderTable.buyer_user_id == current_user.id,
        PaymentOrderTable.pricing_plan_id == ((selected_plan or {}).get("id")),
        PaymentOrderTable.amount_cents == amount,
        PaymentOrderTable.currency == (share.currency or "CNY"),
        PaymentOrderTable.status == "pending",
    ).order_by(PaymentOrderTable.created_at.desc()).first()
    if pending:
        return _payment_order_response(pending)

    now = _now()
    order = PaymentOrderTable(
        id=f"order-{uuid.uuid4()}",
        out_trade_no=f"TOB{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4).upper()}",
        buyer_user_id=current_user.id,
        seller_user_id=share.owner_user_id,
        agent_profile_id=share.agent_profile_id,
        share_id=share.id,
        pricing_mode=pricing_mode,
        pricing_plan_id=(selected_plan or {}).get("id"),
        amount_cents=amount,
        currency=share.currency or "CNY",
        provider="local_dev_direct" if _can_use_local_direct_payment(request) else "wechat_native",
        status="pending",
        access_expires_at=access_expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(order)
    db.commit()
    return _payment_order_response(order)


@router.post("/api/payment-orders/{order_id}/pay", response_model=AgentSharePurchaseResponse)
async def pay_payment_order(
    order_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    order = db.query(PaymentOrderTable).filter(
        PaymentOrderTable.id == order_id,
        PaymentOrderTable.buyer_user_id == current_user.id,
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Payment order not found")
    if order.status == "paid":
        return _payment_order_response(order, include_code_url=True)
    if order.status != "pending":
        raise HTTPException(status_code=409, detail="Payment order cannot be paid")

    if order.provider == "local_dev_direct" and _can_use_local_direct_payment(request):
        now = _now()
        _grant_paid_access(db, order, now, {"provider": "local_dev_direct"})
        db.commit()
        return _payment_order_response(order, include_code_url=True)

    if order.provider != "wechat_native":
        raise HTTPException(status_code=409, detail="Payment provider is unavailable")
    if not order.code_url:
        profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == order.agent_profile_id,
        ).first()
        if not profile:
            raise HTTPException(status_code=404, detail="Shared agent profile not found")
        order.code_url = await _create_wechat_native_order(order, profile.name)
        order.updated_at = _now()
        db.commit()
    return _payment_order_response(order, include_code_url=True)


@router.get("/api/payment-orders/{order_id}", response_model=PaymentOrderResponse)
async def get_payment_order(
    order_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    order = db.query(PaymentOrderTable).filter(
        PaymentOrderTable.id == order_id,
        PaymentOrderTable.buyer_user_id == current_user.id,
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Payment order not found")
    return PaymentOrderResponse(
        orderId=order.id,
        outTradeNo=order.out_trade_no,
        status=order.status,
        amountCents=order.amount_cents,
        currency=order.currency,
        codeUrl=order.code_url,
        paidAt=order.paid_at,
    )


@router.post("/api/payments/wechat/native/notify")
async def wechat_native_notify(
    request: Request,
    db: Session = Depends(get_db),
    wechatpay_timestamp: str | None = Header(default=None, alias="Wechatpay-Timestamp"),
    wechatpay_nonce: str | None = Header(default=None, alias="Wechatpay-Nonce"),
    wechatpay_signature: str | None = Header(default=None, alias="Wechatpay-Signature"),
):
    raw = await request.body()
    if os.getenv("WECHAT_PAY_SKIP_NOTIFY_SIGNATURE_VERIFY", "false").lower() != "true":
        cert_path = os.getenv("WECHAT_PAY_PLATFORM_CERT_PATH")
        if not cert_path:
            raise HTTPException(status_code=500, detail="WECHAT_PAY_PLATFORM_CERT_PATH is not configured")
        if not all([wechatpay_timestamp, wechatpay_nonce, wechatpay_signature]):
            raise HTTPException(status_code=400, detail="Missing WeChat Pay signature headers")
        with open(cert_path, "rb") as cert_file:
            public_key = serialization.load_pem_public_key(cert_file.read())
        message = f"{wechatpay_timestamp}\n{wechatpay_nonce}\n{raw.decode()}\n".encode()
        try:
            public_key.verify(
                base64.b64decode(wechatpay_signature),
                message,
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid WeChat Pay signature") from exc

    decrypted = _decrypt_wechat_resource(json.loads(raw.decode()))
    out_trade_no = decrypted.get("out_trade_no")
    trade_state = decrypted.get("trade_state")
    amount_total = int((decrypted.get("amount") or {}).get("total") or 0)
    order = db.query(PaymentOrderTable).filter(PaymentOrderTable.out_trade_no == out_trade_no).first()
    if not order:
        return JSONResponse({"code": "SUCCESS", "message": "OK"})
    if trade_state == "SUCCESS" and amount_total == order.amount_cents:
        _grant_paid_access(db, order, _now(), decrypted)
        db.commit()
    return JSONResponse({"code": "SUCCESS", "message": "OK"})


@router.get("/api/wallet", response_model=WalletSummaryResponse)
async def get_wallet_summary(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    balance = db.query(func.coalesce(func.sum(WalletLedgerEntryTable.amount_cents), 0)).filter(
        WalletLedgerEntryTable.user_id == current_user.id,
    ).scalar() or 0
    entries = db.query(WalletLedgerEntryTable).filter(
        WalletLedgerEntryTable.user_id == current_user.id,
    ).order_by(WalletLedgerEntryTable.created_at.desc()).limit(20).all()
    return WalletSummaryResponse(
        userId=current_user.id,
        balanceCents=int(balance),
        entries=[
            {
                "id": entry.id,
                "orderId": entry.order_id,
                "type": entry.entry_type,
                "amountCents": entry.amount_cents,
                "currency": entry.currency,
                "description": entry.description,
                "createdAt": entry.created_at,
            }
            for entry in entries
        ],
    )
