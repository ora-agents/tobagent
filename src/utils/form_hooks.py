"""Helpers for triggering custom form hooks."""

import asyncio
import logging
import re
from typing import Any

import httpx

from src.utils.db import FormRecordTable, FormTable

logger = logging.getLogger(__name__)


def _field_value_changed(old_data: dict[str, Any], new_data: dict[str, Any], field_id: str) -> bool:
    return old_data.get(field_id) != new_data.get(field_id)


def _hook_matches(hook: dict[str, Any], value: Any) -> bool:
    match_type = str(hook.get("matchType") or "regex")
    value_text = "" if value is None else str(value)
    if match_type == "value":
        return value_text == str(hook.get("value") or "")
    if match_type != "regex":
        return False
    pattern = str(hook.get("pattern") or "")
    if not pattern:
        return False
    try:
        return re.search(pattern, value_text) is not None
    except re.error as exc:
        logger.warning("Skipping form hook %s with invalid regex: %s", hook.get("id"), exc)
        return False


async def trigger_form_hooks(
    form: FormTable,
    record: FormRecordTable,
    old_data: dict[str, Any],
    new_data: dict[str, Any],
) -> None:
    """Trigger enabled form hooks whose watched field changed and matches."""
    hooks = [hook for hook in (form.hooks or []) if isinstance(hook, dict) and hook.get("enabled", True)]
    if not hooks:
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        for hook in hooks:
            field_id = str(hook.get("fieldId") or "")
            url = str(hook.get("url") or "").strip()
            method = str(hook.get("method") or "POST").upper()
            if method not in {"POST", "PUT", "PATCH"} or not url.startswith(("http://", "https://")):
                continue
            if not field_id or not _field_value_changed(old_data, new_data, field_id):
                continue
            new_value = new_data.get(field_id)
            if not _hook_matches(hook, new_value):
                continue

            payload = {
                "hook": {
                    "id": hook.get("id"),
                    "name": hook.get("name") or "",
                    "matchType": hook.get("matchType") or "regex",
                    "fieldId": field_id,
                },
                "form": {
                    "id": form.id,
                    "name": form.name,
                    "category": form.category or "",
                },
                "record": {
                    "id": record.id,
                    "formId": record.form_id,
                    "data": new_data,
                    "createdAt": record.created_at,
                    "updatedAt": record.updated_at,
                },
                "field": {
                    "id": field_id,
                    "oldValue": old_data.get(field_id),
                    "newValue": new_value,
                },
                "event": "form_record_field_changed",
            }
            headers = {
                str(key): str(value)
                for key, value in (hook.get("headers") or {}).items()
                if str(key).strip()
            }
            try:
                response = await client.request(method, url, json=payload, headers=headers)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning("Form hook %s request failed: %s", hook.get("id"), exc)


def trigger_form_hooks_sync(
    form: FormTable,
    record: FormRecordTable,
    old_data: dict[str, Any],
    new_data: dict[str, Any],
) -> None:
    """Run form hooks from synchronous tool code paths."""
    asyncio.run(trigger_form_hooks(form, record, old_data, new_data))
