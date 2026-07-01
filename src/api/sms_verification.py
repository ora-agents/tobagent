"""SMS verification helpers backed by Aliyun Dysmsapi SendSms."""

import base64
import hashlib
import hmac
import json
import logging
import os
import random
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import requests
from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.utils.db import SmsVerificationCodeTable

logger = logging.getLogger(__name__)

SMS_ENDPOINT = os.getenv("ALIYUN_SMS_ENDPOINT", "https://dysmsapi.aliyuncs.com/")
SMS_REGION_ID = os.getenv("ALIYUN_SMS_REGION_ID", "cn-hangzhou")
SMS_CODE_TTL_SECONDS = int(os.getenv("SMS_CODE_TTL_SECONDS", "300"))
SMS_RESEND_INTERVAL_SECONDS = int(os.getenv("SMS_RESEND_INTERVAL_SECONDS", "60"))


def aliyun_sms_is_configured(template_env: str = "ALIYUN_SMS_TEMPLATE_CODE") -> bool:
    """Return whether SMS sending can be offered to clients."""
    has_provider_credentials = all(
        os.getenv(name, "").strip()
        for name in (
            "ALIYUN_ACCESS_KEY_ID",
            "ALIYUN_ACCESS_KEY_SECRET",
            "ALIYUN_SMS_SIGN_NAME",
        )
    )
    has_template = bool(os.getenv(template_env, "").strip())
    dev_log_enabled = os.getenv("SMS_DEV_LOG_CODE", "").lower() == "true"
    return has_template and (has_provider_credentials or dev_log_enabled)


def require_aliyun_sms_configured(template_env: str = "ALIYUN_SMS_TEMPLATE_CODE") -> None:
    """Reject SMS flows when the Aliyun SMS module is disabled by env."""
    if not aliyun_sms_is_configured(template_env):
        raise HTTPException(status_code=503, detail="SMS service is not configured")


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _hash_code(phone: str, purpose: str, code: str) -> str:
    salt = os.getenv("SMS_CODE_HASH_SECRET") or os.getenv("SESSION_JWT_SECRET") or "tobagent-sms-code"
    payload = f"{phone}:{purpose}:{code}".encode()
    return hmac.new(salt.encode(), payload, hashlib.sha256).hexdigest()


def _percent_encode(value: str) -> str:
    return quote(value, safe="~")


def _sign_aliyun_request(params: dict[str, str], access_key_secret: str) -> str:
    canonicalized_query = "&".join(
        f"{_percent_encode(key)}={_percent_encode(params[key])}"
        for key in sorted(params)
    )
    string_to_sign = f"GET&%2F&{_percent_encode(canonicalized_query)}"
    digest = hmac.new(
        f"{access_key_secret}&".encode(),
        string_to_sign.encode(),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=500, detail=f"{name} is not configured")
    return value


def _sms_template_code_for_purpose(purpose: str) -> str:
    if purpose == "reset_password":
        reset_template_code = os.getenv("ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE", "").strip()
        if reset_template_code:
            return reset_template_code
    return _required_env("ALIYUN_SMS_TEMPLATE_CODE")


def _send_aliyun_template_sms(
    phone: str,
    template_code: str,
    template_param: dict[str, str] | None = None,
) -> None:
    access_key_id = os.getenv("ALIYUN_ACCESS_KEY_ID")
    access_key_secret = os.getenv("ALIYUN_ACCESS_KEY_SECRET")
    sign_name = os.getenv("ALIYUN_SMS_SIGN_NAME")
    if not all([access_key_id, access_key_secret, sign_name]):
        if os.getenv("SMS_DEV_LOG_CODE", "").lower() == "true":
            logger.warning(
                "SMS_DEV_LOG_CODE enabled; skipped Aliyun template %s for %s with params %s",
                template_code,
                phone,
                template_param or {},
            )
            return
        raise HTTPException(status_code=500, detail="SMS service is not configured")

    params = {
        "AccessKeyId": access_key_id,
        "Action": "SendSms",
        "Format": "JSON",
        "PhoneNumbers": phone,
        "RegionId": SMS_REGION_ID,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "SignatureVersion": "1.0",
        "TemplateCode": template_code,
        "Timestamp": _iso(_now()),
        "Version": "2017-05-25",
        "SignName": sign_name,
    }
    if template_param:
        params["TemplateParam"] = json.dumps(template_param, separators=(",", ":"))
    params["Signature"] = _sign_aliyun_request(params, access_key_secret)

    try:
        response = requests.get(SMS_ENDPOINT, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        logger.exception("Aliyun SendSms request failed")
        raise HTTPException(status_code=502, detail="Failed to send SMS code") from exc
    except ValueError as exc:
        logger.exception("Aliyun SendSms returned non-JSON response")
        raise HTTPException(status_code=502, detail="Invalid SMS provider response") from exc

    if data.get("Code") != "OK":
        logger.warning("Aliyun SendSms rejected request: %s", data)
        raise HTTPException(
            status_code=502,
            detail=data.get("Message") or "SMS provider rejected request",
        )


def _send_aliyun_sms(phone: str, code: str, purpose: str) -> None:
    _send_aliyun_template_sms(
        phone=phone,
        template_code=_sms_template_code_for_purpose(purpose),
        template_param={"code": code},
    )


def issue_sms_code(db: Session, phone: str, purpose: str) -> None:
    """Create and send a short-lived SMS verification code."""
    require_aliyun_sms_configured()
    now = _now()
    latest = (
        db.query(SmsVerificationCodeTable)
        .filter(
            SmsVerificationCodeTable.phone == phone,
            SmsVerificationCodeTable.purpose == purpose,
            SmsVerificationCodeTable.consumed_at.is_(None),
        )
        .order_by(SmsVerificationCodeTable.created_at.desc())
        .first()
    )
    if latest and (_parse_iso(latest.created_at) + timedelta(seconds=SMS_RESEND_INTERVAL_SECONDS)) > now:
        raise HTTPException(status_code=429, detail="Please wait before requesting another code")

    code = f"{random.SystemRandom().randint(0, 999999):06d}"
    row = SmsVerificationCodeTable(
        id=f"sms-{uuid.uuid4()}",
        phone=phone,
        purpose=purpose,
        code_hash=_hash_code(phone, purpose, code),
        expires_at=_iso(now + timedelta(seconds=SMS_CODE_TTL_SECONDS)),
        created_at=_iso(now),
    )
    db.add(row)
    db.commit()

    try:
        _send_aliyun_sms(phone, code, purpose)
    except Exception:
        row.consumed_at = _iso(_now())
        db.commit()
        raise


def consume_sms_code(db: Session, phone: str, purpose: str, code: str) -> None:
    """Validate a code and mark it consumed."""
    now = _now()
    code_hash = _hash_code(phone, purpose, code)
    row = (
        db.query(SmsVerificationCodeTable)
        .filter(
            SmsVerificationCodeTable.phone == phone,
            SmsVerificationCodeTable.purpose == purpose,
            SmsVerificationCodeTable.code_hash == code_hash,
            SmsVerificationCodeTable.consumed_at.is_(None),
        )
        .order_by(SmsVerificationCodeTable.created_at.desc())
        .first()
    )
    if not row or _parse_iso(row.expires_at) < now:
        raise HTTPException(status_code=401, detail="Invalid or expired verification code")

    row.consumed_at = _iso(now)
    db.flush()
