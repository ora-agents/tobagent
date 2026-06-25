"""Helpers for agent-scoped form record permissions."""

from typing import Any

FORM_RECORD_ACTIONS = ("create", "read", "update", "delete")
DEFAULT_FORM_RECORD_PERMISSIONS = ["read"]


def normalize_form_permissions(
    form_ids: list[str] | None,
    permissions: dict[str, Any] | None,
) -> dict[str, list[str]]:
    """Return valid permissions for linked forms, defaulting legacy links to read-only."""
    linked_ids = list(dict.fromkeys(str(form_id) for form_id in form_ids or [] if form_id))
    raw = permissions if isinstance(permissions, dict) else {}
    normalized: dict[str, list[str]] = {}
    for form_id in linked_ids:
        requested = raw.get(form_id)
        if not isinstance(requested, list):
            requested = DEFAULT_FORM_RECORD_PERMISSIONS
        allowed = [
            action
            for action in FORM_RECORD_ACTIONS
            if action in requested
        ]
        normalized[form_id] = allowed
    return normalized


def has_form_permission(
    form_ids: list[str] | None,
    permissions: dict[str, Any] | None,
    form_id: str,
    action: str,
) -> bool:
    """Check one CRUD action against an agent's linked form configuration."""
    return action in normalize_form_permissions(form_ids, permissions).get(form_id, [])
