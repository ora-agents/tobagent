"""Validation helpers for custom form record data."""

from __future__ import annotations

from typing import Any


class FormRecordValidationError(ValueError):
    """Raised when record data does not match the form field definition."""


def _field_label(field: dict[str, Any]) -> str:
    label = str(field.get("label") or "").strip()
    field_id = str(field.get("id") or "").strip()
    return label or field_id


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def _normalize_field_value(field: dict[str, Any], value: Any) -> Any:
    field_type = str(field.get("type") or "text")
    field_name = _field_label(field)
    if field_type == "number":
        if value in (None, ""):
            return None
        if isinstance(value, bool):
            raise FormRecordValidationError(f"Field '{field_name}' must be a number.")
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise FormRecordValidationError(f"Field '{field_name}' must be a number.") from exc
        return int(number) if number.is_integer() else number
    if field_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "y", "on"}:
                return True
            if normalized in {"false", "0", "no", "n", "off", ""}:
                return False
        if isinstance(value, int) and value in {0, 1}:
            return bool(value)
        raise FormRecordValidationError(f"Field '{field_name}' must be a boolean.")
    if field_type == "select":
        normalized = "" if value is None else str(value)
        options = [str(option) for option in field.get("options") or []]
        if normalized and options and normalized not in options:
            raise FormRecordValidationError(
                f"Field '{field_name}' must be one of: {', '.join(options)}."
            )
        return normalized
    if field_type == "date":
        return "" if value is None else str(value)
    return "" if value is None else str(value)


def normalize_form_record_data(
    fields: list[dict[str, Any]] | None,
    data: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return record data normalized to the form field definition.

    Forms without field definitions are treated as legacy schema-less forms and
    keep their data unchanged.
    """
    raw_data = data or {}
    form_fields = [field for field in fields or [] if isinstance(field, dict) and field.get("id")]
    if not form_fields:
        return dict(raw_data)

    field_by_id = {str(field["id"]): field for field in form_fields}
    unknown_fields = sorted(set(raw_data) - set(field_by_id))
    if unknown_fields:
        raise FormRecordValidationError(
            "Record data contains unknown field(s): " + ", ".join(unknown_fields)
        )

    normalized: dict[str, Any] = {}
    for field_id, field in field_by_id.items():
        value = raw_data.get(field_id)
        if field.get("required") and _is_missing(value):
            raise FormRecordValidationError(f"Field '{_field_label(field)}' is required.")
        normalized[field_id] = _normalize_field_value(field, value)
    return normalized
