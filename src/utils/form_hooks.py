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


def _condition_matches(hook: dict[str, Any], condition: dict[str, Any], value: Any) -> bool:
    match_type = str(condition.get("matchType") or "regex")
    value_text = "" if value is None else str(value)
    if match_type == "value":
        return value_text == str(condition.get("value") or "")
    if match_type == "empty":
        return value is None or value_text == ""
    if match_type == "not_empty":
        return value is not None and value_text != ""
    if match_type != "regex":
        return False
    pattern = str(condition.get("pattern") or "")
    if not pattern:
        return False
    try:
        return re.search(pattern, value_text) is not None
    except re.error as exc:
        logger.warning("Skipping form hook %s with invalid regex: %s", hook.get("id"), exc)
        return False


def _hook_conditions(hook: dict[str, Any]) -> list[dict[str, Any]]:
    conditions = hook.get("conditions")
    if isinstance(conditions, list) and conditions:
        return [condition for condition in conditions if isinstance(condition, dict)]

    field_id = str(hook.get("fieldId") or "")
    if not field_id:
        return []
    return [{
        "fieldId": field_id,
        "matchType": hook.get("matchType") or "regex",
        "pattern": hook.get("pattern") or "",
        "value": hook.get("value") or "",
    }]


def _evaluate_hook_conditions(
    hook: dict[str, Any],
    old_data: dict[str, Any],
    new_data: dict[str, Any],
) -> tuple[bool, list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    changed = False
    for condition in _hook_conditions(hook):
        field_id = str(condition.get("fieldId") or "")
        if not field_id:
            continue
        old_value = old_data.get(field_id)
        new_value = new_data.get(field_id)
        field_changed = _field_value_changed(old_data, new_data, field_id)
        changed = changed or field_changed
        matched = _condition_matches(hook, condition, new_value)
        results.append({
            "fieldId": field_id,
            "matchType": condition.get("matchType") or "regex",
            "oldValue": old_value,
            "newValue": new_value,
            "changed": field_changed,
            "matched": matched,
        })

    if not results or not changed:
        return False, results

    logic = str(hook.get("conditionLogic") or "all")
    if logic == "any":
        return any(result["matched"] for result in results), results
    return all(result["matched"] for result in results), results


async def trigger_form_hooks(
    form: FormTable,
    record: FormRecordTable,
    old_data: dict[str, Any],
    new_data: dict[str, Any],
) -> None:
    """Trigger enabled form hooks whose watched fields changed and match."""
    hooks = [hook for hook in (form.hooks or []) if isinstance(hook, dict) and hook.get("enabled", True)]
    if not hooks:
        return

    async with httpx.AsyncClient(timeout=10.0) as client:
        for hook in hooks:
            url = str(hook.get("url") or "").strip()
            method = str(hook.get("method") or "POST").upper()
            if method not in {"POST", "PUT", "PATCH"} or not url.startswith(("http://", "https://")):
                continue
            matched, condition_results = _evaluate_hook_conditions(hook, old_data, new_data)
            if not matched:
                continue
            matched_field = next(
                (result for result in condition_results if result["changed"] and result["matched"]),
                condition_results[0],
            )
            field_id = str(matched_field["fieldId"])

            payload = {
                "hook": {
                    "id": hook.get("id"),
                    "name": hook.get("name") or "",
                    "matchType": hook.get("matchType") or "regex",
                    "fieldId": field_id,
                    "conditionLogic": hook.get("conditionLogic") or "all",
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
                    "oldValue": matched_field["oldValue"],
                    "newValue": matched_field["newValue"],
                },
                "conditions": condition_results,
                "conditionEvent": "form_record_conditions_matched",
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
