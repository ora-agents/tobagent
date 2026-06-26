"""Helpers for form record reference fields."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.utils.db import FormRecordTable, FormTable

REFERENCE_FIELD_TYPE = "reference"
SUPPORTED_RELATIONS = {"many_to_one", "one_to_one"}
SUPPORTED_DELETE_POLICIES = {"restrict", "set_null"}


def _field_id_set(form: FormTable | None, fields: list[dict[str, Any]]) -> set[str]:
    return {str(field.get("id") or "") for field in fields if field.get("id")}


def get_reference_fields(form: FormTable | None) -> list[dict[str, Any]]:
    """Return reference fields from a stored form."""
    return [
        field
        for field in (form.fields if form else []) or []
        if field.get("type") == REFERENCE_FIELD_TYPE
    ]


def _binding(field: dict[str, Any]) -> dict[str, Any]:
    value = field.get("binding")
    return value if isinstance(value, dict) else {}


def _target_label(target_form: FormTable, target_record: FormRecordTable) -> str:
    data = target_record.data or {}
    fields = target_form.fields or []
    display_field_id = next(
        (
            field.get("id")
            for field in fields
            if field.get("type") in {"text", "number", "date", "select"} and data.get(field.get("id")) not in (None, "")
        ),
        "",
    )
    if display_field_id:
        return str(data.get(display_field_id))
    return target_record.id


def _configured_target_label(
    target_form: FormTable,
    target_record: FormRecordTable,
    display_field_id: str,
) -> str:
    if display_field_id == "createdAt":
        return target_record.created_at
    if display_field_id == "updatedAt":
        return target_record.updated_at
    value = (target_record.data or {}).get(display_field_id)
    if value not in (None, ""):
        return str(value)
    return _target_label(target_form, target_record)


def validate_form_definition_relations(
    db: Session,
    owner_user_id: str,
    fields: list[dict[str, Any]],
) -> None:
    """Validate reference field metadata in a form definition."""
    field_ids = _field_id_set(None, fields)
    if len(field_ids) != len([field for field in fields if field.get("id")]):
        raise HTTPException(status_code=400, detail="Field IDs must be unique")

    for field in fields:
        if field.get("type") != REFERENCE_FIELD_TYPE:
            continue
        binding = _binding(field)
        target_form_id = str(binding.get("targetFormId") or "").strip()
        if not target_form_id:
            raise HTTPException(status_code=400, detail=f"Reference field '{field.get('id')}' requires targetFormId")
        target_form = db.query(FormTable).filter(
            FormTable.id == target_form_id,
            FormTable.owner_user_id == owner_user_id,
        ).first()
        if not target_form:
            raise HTTPException(status_code=400, detail=f"Reference field '{field.get('id')}' targets a missing form")

        relation = str(binding.get("relation") or "many_to_one")
        if relation not in SUPPORTED_RELATIONS:
            raise HTTPException(status_code=400, detail=f"Reference field '{field.get('id')}' has invalid relation")

        on_target_delete = str(binding.get("onTargetDelete") or "restrict")
        if on_target_delete not in SUPPORTED_DELETE_POLICIES:
            raise HTTPException(status_code=400, detail=f"Reference field '{field.get('id')}' has invalid delete policy")

        display_field_id = str(binding.get("targetDisplayFieldId") or "").strip()
        if display_field_id and display_field_id not in {
            "createdAt",
            "updatedAt",
            *[str(item.get("id") or "") for item in (target_form.fields or [])],
        }:
            raise HTTPException(status_code=400, detail=f"Reference field '{field.get('id')}' targets a missing display field")


def validate_record_relations(
    db: Session,
    owner_user_id: str,
    form: FormTable,
    data: dict[str, Any],
    record_id: str | None = None,
) -> None:
    """Validate required fields, reference existence, and one-to-one uniqueness."""
    for field in (form.fields or []):
        field_id = str(field.get("id") or "")
        if not field_id:
            continue
        value = data.get(field_id)
        if field.get("required") and value in (None, ""):
            raise HTTPException(status_code=400, detail=f"Field '{field_id}' is required")
        if field.get("type") != REFERENCE_FIELD_TYPE or value in (None, ""):
            continue

        target_record_id = str(value)
        binding = _binding(field)
        target_form_id = str(binding.get("targetFormId") or "")
        target_record = db.query(FormRecordTable).filter(
            FormRecordTable.id == target_record_id,
            FormRecordTable.form_id == target_form_id,
            FormRecordTable.owner_user_id == owner_user_id,
        ).first()
        if not target_record:
            raise HTTPException(status_code=400, detail=f"Reference field '{field_id}' targets a missing record")

        if binding.get("unique") is True or binding.get("relation") == "one_to_one":
            records = db.query(FormRecordTable).filter(
                FormRecordTable.form_id == form.id,
                FormRecordTable.owner_user_id == owner_user_id,
            ).all()
            for record in records:
                if record_id and record.id == record_id:
                    continue
                if (record.data or {}).get(field_id) == target_record_id:
                    raise HTTPException(status_code=400, detail=f"Reference field '{field_id}' must be unique")


def resolve_record_references(
    db: Session,
    owner_user_id: str,
    form: FormTable,
    record: FormRecordTable,
) -> dict[str, Any]:
    """Resolve outbound reference summaries for a record."""
    output: dict[str, Any] = {}
    data = record.data or {}
    for field in get_reference_fields(form):
        field_id = str(field.get("id") or "")
        target_record_id = data.get(field_id)
        if target_record_id in (None, ""):
            continue
        binding = _binding(field)
        target_form_id = str(binding.get("targetFormId") or "")
        target_form = db.query(FormTable).filter(
            FormTable.id == target_form_id,
            FormTable.owner_user_id == owner_user_id,
        ).first()
        if not target_form:
            output[field_id] = {
                "recordId": str(target_record_id),
                "formId": target_form_id,
                "label": str(target_record_id),
                "exists": False,
            }
            continue
        target_record = db.query(FormRecordTable).filter(
            FormRecordTable.id == str(target_record_id),
            FormRecordTable.form_id == target_form_id,
            FormRecordTable.owner_user_id == owner_user_id,
        ).first()
        if not target_record:
            output[field_id] = {
                "recordId": str(target_record_id),
                "formId": target_form_id,
                "label": str(target_record_id),
                "exists": False,
            }
            continue
        display_field_id = str(binding.get("targetDisplayFieldId") or "")
        output[field_id] = {
            "recordId": target_record.id,
            "formId": target_form.id,
            "formName": target_form.name,
            "label": _configured_target_label(target_form, target_record, display_field_id),
            "exists": True,
        }
    return output


def find_inbound_references(
    db: Session,
    owner_user_id: str,
    target_form_id: str,
    target_record_id: str,
) -> list[dict[str, Any]]:
    """Find records that reference the given target record."""
    references: list[dict[str, Any]] = []
    forms = db.query(FormTable).filter(FormTable.owner_user_id == owner_user_id).all()
    for form in forms:
        for field in get_reference_fields(form):
            binding = _binding(field)
            if str(binding.get("targetFormId") or "") != target_form_id:
                continue
            field_id = str(field.get("id") or "")
            records = db.query(FormRecordTable).filter(
                FormRecordTable.form_id == form.id,
                FormRecordTable.owner_user_id == owner_user_id,
            ).all()
            for record in records:
                if (record.data or {}).get(field_id) != target_record_id:
                    continue
                references.append({
                    "sourceFormId": form.id,
                    "sourceFormName": form.name,
                    "sourceFieldId": field_id,
                    "sourceFieldLabel": field.get("label") or field_id,
                    "recordId": record.id,
                    "onTargetDelete": str(binding.get("onTargetDelete") or "restrict"),
                })
    return references


def apply_target_delete_policy(
    db: Session,
    owner_user_id: str,
    target_form_id: str,
    target_record_id: str,
) -> None:
    """Apply configured inbound reference delete policies before deleting a record."""
    forms = db.query(FormTable).filter(FormTable.owner_user_id == owner_user_id).all()
    restrict_references: list[dict[str, Any]] = []
    set_null_updates: list[tuple[FormRecordTable, str]] = []
    for form in forms:
        for field in get_reference_fields(form):
            binding = _binding(field)
            if str(binding.get("targetFormId") or "") != target_form_id:
                continue
            field_id = str(field.get("id") or "")
            records = db.query(FormRecordTable).filter(
                FormRecordTable.form_id == form.id,
                FormRecordTable.owner_user_id == owner_user_id,
            ).all()
            for record in records:
                if (record.data or {}).get(field_id) != target_record_id:
                    continue
                policy = str(binding.get("onTargetDelete") or "restrict")
                reference = {
                    "sourceFormId": form.id,
                    "sourceFormName": form.name,
                    "sourceFieldId": field_id,
                    "sourceFieldLabel": field.get("label") or field_id,
                    "recordId": record.id,
                }
                if policy == "set_null":
                    set_null_updates.append((record, field_id))
                else:
                    restrict_references.append(reference)
    if restrict_references:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "record_referenced",
                "message": "Record is referenced by other form records.",
                "references": restrict_references,
            },
        )
    for record, field_id in set_null_updates:
        next_data = dict(record.data or {})
        next_data[field_id] = None
        record.data = next_data
