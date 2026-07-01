"""SMS callback hooks for external form systems."""
# ruff: noqa: D101,D103

import hmac
import os
import re
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from src.api.schemas import PHONE_PATTERN
from src.api.sms_verification import _send_aliyun_template_sms

SMS_FORM_HOOK_TEMPLATE_CODE = "SMS_509045024"

router = APIRouter(tags=["sms-hooks"])


class FormSmsHookRequest(BaseModel):
    hook: dict[str, Any] = Field(default_factory=dict)
    form: dict[str, Any] = Field(default_factory=dict)
    record: dict[str, Any] = Field(default_factory=dict)
    field: dict[str, Any] = Field(default_factory=dict)
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    conditionEvent: str | None = None
    event: str | None = None
    phone: str | None = None


class FormSmsHookResponse(BaseModel):
    ok: bool = True


def _configured_hook_key() -> str:
    hook_key = os.getenv("SMS_HOOK_KEY", "")
    if not hook_key:
        raise HTTPException(status_code=500, detail="SMS hook key is not configured")
    return hook_key


def _extract_phone(req: FormSmsHookRequest) -> str:
    record = req.record if isinstance(req.record, dict) else {}
    field_values = record.get("fieldValues")
    data = record.get("data")
    candidates = [
        req.phone,
        field_values.get("user_phone") if isinstance(field_values, dict) else None,
        data.get("user_phone") if isinstance(data, dict) else None,
    ]
    for value in candidates:
        if value is None:
            continue
        phone = str(value).strip().replace(" ", "").replace("-", "")
        if re.fullmatch(PHONE_PATTERN, phone):
            return phone
    raise HTTPException(status_code=400, detail="Valid user_phone is required")


@router.post(
    "/api/hooks/form-sms",
    response_model=FormSmsHookResponse,
    summary="Handle form SMS notification hook",
    description="Receives a form hook callback and sends an Aliyun SMS notification with template SMS_509045024.",
)
async def send_form_hook_sms(
    req: FormSmsHookRequest,
    sms_hook_key: str | None = Header(default=None, alias="SMS-HOOK-KEY"),
):
    configured_key = _configured_hook_key()
    if not sms_hook_key or not hmac.compare_digest(sms_hook_key, configured_key):
        raise HTTPException(status_code=401, detail="Invalid SMS hook key")

    phone = _extract_phone(req)
    _send_aliyun_template_sms(phone, SMS_FORM_HOOK_TEMPLATE_CODE)
    return FormSmsHookResponse(ok=True)
