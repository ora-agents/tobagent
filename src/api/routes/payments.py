"""Payment, purchase entitlement, and wallet routes."""
# ruff: noqa: D103

import base64
import json
import os
import secrets
import uuid
from datetime import UTC, datetime

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    AgentShareAccessResponse,
    AgentSharePurchaseResponse,
    PaymentOrderResponse,
    WalletSummaryResponse,
)
from src.utils.db import (
    AgentProfileTable,
    AgentPurchaseTable,
    AgentShareLinkTable,
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
    if int(share.price_cents or 0) <= 0:
        return True
    return db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.share_id == share.id,
        AgentPurchaseTable.buyer_user_id == user_id,
    ).first() is not None


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
        return f"weixin://wxpay/bizpayurl?pr=UNCONFIGURED_{order.out_trade_no}"

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
        AgentPurchaseTable.share_id == order.share_id,
        AgentPurchaseTable.buyer_user_id == order.buyer_user_id,
    ).first()
    if not purchase:
        db.add(AgentPurchaseTable(
            id=f"purchase-{uuid.uuid4()}",
            buyer_user_id=order.buyer_user_id,
            seller_user_id=order.seller_user_id,
            agent_profile_id=order.agent_profile_id,
            share_id=order.share_id,
            order_id=order.id,
            price_cents=order.amount_cents,
            currency=order.currency,
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
    return AgentShareAccessResponse(
        token=share.token,
        agentProfileId=share.agent_profile_id,
        purchased=_has_purchase(db, share, current_user.id),
        requiresPurchase=int(share.price_cents or 0) > 0 and current_user.id != share.owner_user_id,
        priceCents=int(share.price_cents or 0),
        currency=share.currency or "CNY",
    )


@router.post("/api/agent-shares/{token}/purchase", response_model=AgentSharePurchaseResponse)
async def purchase_agent_share(
    token: str,
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
    amount = int(share.price_cents or 0)
    if amount <= 0 or current_user.id == share.owner_user_id:
        now = _now()
        order = PaymentOrderTable(
            id=f"order-{uuid.uuid4()}",
            out_trade_no=f"TOB{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4).upper()}",
            buyer_user_id=current_user.id,
            seller_user_id=share.owner_user_id,
            agent_profile_id=share.agent_profile_id,
            share_id=share.id,
            amount_cents=0,
            currency=share.currency or "CNY",
            status="paid",
            created_at=now,
            updated_at=now,
            paid_at=now,
        )
        db.add(order)
        _grant_paid_access(db, order, now)
        db.commit()
        return AgentSharePurchaseResponse(
            orderId=order.id,
            outTradeNo=order.out_trade_no,
            status=order.status,
            amountCents=order.amount_cents,
            currency=order.currency,
            paymentConfigured=_wechat_configured(),
        )

    existing_paid = db.query(AgentPurchaseTable).filter(
        AgentPurchaseTable.share_id == share.id,
        AgentPurchaseTable.buyer_user_id == current_user.id,
    ).first()
    if existing_paid:
        raise HTTPException(status_code=409, detail="Agent share already purchased")

    pending = db.query(PaymentOrderTable).filter(
        PaymentOrderTable.share_id == share.id,
        PaymentOrderTable.buyer_user_id == current_user.id,
        PaymentOrderTable.status == "pending",
    ).order_by(PaymentOrderTable.created_at.desc()).first()
    if pending and pending.code_url:
        return AgentSharePurchaseResponse(
            orderId=pending.id,
            outTradeNo=pending.out_trade_no,
            status=pending.status,
            amountCents=pending.amount_cents,
            currency=pending.currency,
            codeUrl=pending.code_url,
            paymentConfigured=_wechat_configured(),
        )

    now = _now()
    order = PaymentOrderTable(
        id=f"order-{uuid.uuid4()}",
        out_trade_no=f"TOB{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4).upper()}",
        buyer_user_id=current_user.id,
        seller_user_id=share.owner_user_id,
        agent_profile_id=share.agent_profile_id,
        share_id=share.id,
        amount_cents=amount,
        currency=share.currency or "CNY",
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db.add(order)
    db.flush()
    order.code_url = await _create_wechat_native_order(order, profile.name)
    order.updated_at = _now()
    db.commit()
    return AgentSharePurchaseResponse(
        orderId=order.id,
        outTradeNo=order.out_trade_no,
        status=order.status,
        amountCents=order.amount_cents,
        currency=order.currency,
        codeUrl=order.code_url,
        paymentConfigured=_wechat_configured(),
    )


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
