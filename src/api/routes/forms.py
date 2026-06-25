"""Custom form and form record routes."""
# ruff: noqa: D103

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from src.api.deps import get_current_user
from src.api.schemas import (
    FormRecordListResponse,
    FormRecordSchema,
    FormRecordWriteSchema,
    FormSchema,
)
from src.api.services import (
    _form_record_schema,
    _form_schema,
    _remove_agent_profile_links,
)
from src.utils.db import FormRecordTable, FormTable, UserTable, get_db

router = APIRouter(tags=["forms"])


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _record_matches(
    data: dict,
    q: str,
    filter_field: str,
    filter_value: str,
    filter_op: str,
) -> bool:
    if q:
        haystack = " ".join(str(value) for value in data.values()).lower()
        if q.lower() not in haystack:
            return False

    if not filter_field:
        return True

    value = data.get(filter_field)
    if filter_op == "exists":
        return filter_field in data and value not in (None, "")
    if filter_op == "missing":
        return filter_field not in data or value in (None, "")

    actual = "" if value is None else str(value)
    expected = filter_value
    actual_lower = actual.lower()
    expected_lower = expected.lower()

    if filter_op == "eq":
        return actual_lower == expected_lower
    if filter_op == "ne":
        return actual_lower != expected_lower
    if filter_op == "starts_with":
        return actual_lower.startswith(expected_lower)
    if filter_op == "ends_with":
        return actual_lower.endswith(expected_lower)
    if filter_op == "contains":
        return expected_lower in actual_lower
    if filter_op in {"gt", "gte", "lt", "lte"}:
        try:
            actual_num = float(actual)
            expected_num = float(expected)
        except ValueError:
            return False
        if filter_op == "gt":
            return actual_num > expected_num
        if filter_op == "gte":
            return actual_num >= expected_num
        if filter_op == "lt":
            return actual_num < expected_num
        return actual_num <= expected_num
    return False


def _project_record(record: FormRecordTable, fields: list[str]) -> FormRecordTable:
    if fields:
        record.data = {
            field: (record.data or {}).get(field)
            for field in fields
            if field in (record.data or {})
        }
    return record


@router.get("/api/forms", response_model=list[FormSchema], summary="List forms")
async def list_forms(
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    forms = db.query(FormTable).filter(FormTable.owner_user_id == current_user.id).all()
    return [
        _form_schema(
            form,
            db.query(FormRecordTable).filter(
                FormRecordTable.form_id == form.id,
                FormRecordTable.owner_user_id == current_user.id,
            ).count(),
        )
        for form in forms
    ]


@router.get(
    "/api/forms/{id}",
    response_model=FormSchema,
    summary="Get a form definition",
    description="Returns one owned form and its field schema. Supports user API keys.",
)
async def get_form(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    form = db.query(FormTable).filter(
        FormTable.id == id,
        FormTable.owner_user_id == current_user.id,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    record_count = db.query(FormRecordTable).filter(
        FormRecordTable.form_id == id,
        FormRecordTable.owner_user_id == current_user.id,
    ).count()
    return _form_schema(form, record_count)


@router.post("/api/forms", response_model=FormSchema, summary="Create a form")
async def create_form(
    form_data: FormSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    if db.query(FormTable).filter(FormTable.id == form_data.id).first():
        raise HTTPException(status_code=400, detail="Form already exists")
    form = FormTable(
        id=form_data.id,
        owner_user_id=current_user.id,
        name=form_data.name,
        description=form_data.description,
        category=form_data.category.strip(),
        fields=[field.model_dump(mode="json") for field in form_data.fields],
        created_at=form_data.createdAt,
        updated_at=form_data.updatedAt,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return _form_schema(form)


@router.put("/api/forms/{id}", response_model=FormSchema, summary="Update a form")
async def update_form(
    id: str,
    form_data: FormSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    form = db.query(FormTable).filter(
        FormTable.id == id,
        FormTable.owner_user_id == current_user.id,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    form.name = form_data.name
    form.description = form_data.description
    form.category = form_data.category.strip()
    form.fields = [field.model_dump(mode="json") for field in form_data.fields]
    form.updated_at = form_data.updatedAt
    db.commit()
    db.refresh(form)
    return _form_schema(form)


@router.delete("/api/forms/{id}", summary="Delete a form")
async def delete_form(
    id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    form = db.query(FormTable).filter(
        FormTable.id == id,
        FormTable.owner_user_id == current_user.id,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    _remove_agent_profile_links(db, current_user.id, "form_ids", [id])
    db.query(FormRecordTable).filter(
        FormRecordTable.form_id == id,
        FormRecordTable.owner_user_id == current_user.id,
    ).delete()
    db.delete(form)
    db.commit()
    return {"status": "success", "message": f"Form {id} deleted"}


@router.get(
    "/api/forms/{id}/records",
    response_model=FormRecordListResponse,
    summary="List form records",
)
async def list_form_records(
    id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100, alias="pageSize"),
    fields: str = "",
    q: str = "",
    filter_field: str = Query(default="", alias="filterField"),
    filter_value: str = Query(default="", alias="filterValue"),
    filter_op: str = Query(default="contains", alias="filterOp"),
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    form = db.query(FormTable).filter(
        FormTable.id == id,
        FormTable.owner_user_id == current_user.id,
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    records = db.query(FormRecordTable).filter(
        FormRecordTable.form_id == id,
        FormRecordTable.owner_user_id == current_user.id,
    ).order_by(FormRecordTable.created_at.desc()).all()
    filtered = [
        record
        for record in records
        if _record_matches(record.data or {}, q.strip(), filter_field.strip(), filter_value, filter_op)
    ]
    selected_fields = [field.strip() for field in fields.split(",") if field.strip()]
    total = len(filtered)
    offset = (page - 1) * page_size
    page_records = filtered[offset:offset + page_size]
    output_records = []
    for record in page_records:
        data = record.data or {}
        if selected_fields:
            data = {field: data.get(field) for field in selected_fields if field in data}
        output_records.append(FormRecordSchema(
            id=record.id,
            formId=record.form_id,
            data=data,
            createdAt=record.created_at,
            updatedAt=record.updated_at,
        ))
    return FormRecordListResponse(
        records=output_records,
        total=total,
        page=page,
        pageSize=page_size,
    )


@router.post(
    "/api/forms/{id}/records",
    response_model=FormRecordSchema,
    summary="Create a form record",
    description="Creates a record through a browser session or user API key. Only data is required.",
)
async def create_form_record(
    id: str,
    record_data: FormRecordWriteSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    if not db.query(FormTable).filter(FormTable.id == id, FormTable.owner_user_id == current_user.id).first():
        raise HTTPException(status_code=404, detail="Form not found")
    now = _now()
    record = FormRecordTable(
        id=record_data.id or f"record-{uuid.uuid4()}",
        form_id=id,
        owner_user_id=current_user.id,
        data=record_data.data or {},
        created_at=record_data.createdAt or now,
        updated_at=record_data.updatedAt or now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _form_record_schema(record)


@router.put(
    "/api/forms/{form_id}/records/{record_id}",
    response_model=FormRecordSchema,
    summary="Update a form record",
    description="Replaces record data through a browser session or user API key.",
)
async def update_form_record(
    form_id: str,
    record_id: str,
    record_data: FormRecordWriteSchema,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    record = db.query(FormRecordTable).filter(
        FormRecordTable.id == record_id,
        FormRecordTable.form_id == form_id,
        FormRecordTable.owner_user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Form record not found")
    record.data = record_data.data or {}
    record.updated_at = record_data.updatedAt or _now()
    db.commit()
    db.refresh(record)
    return _form_record_schema(record)


@router.delete("/api/forms/{form_id}/records/{record_id}", summary="Delete a form record")
async def delete_form_record(
    form_id: str,
    record_id: str,
    db: Session = Depends(get_db),
    current_user: UserTable = Depends(get_current_user),
):
    record = db.query(FormRecordTable).filter(
        FormRecordTable.id == record_id,
        FormRecordTable.form_id == form_id,
        FormRecordTable.owner_user_id == current_user.id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Form record not found")
    db.delete(record)
    db.commit()
    return {"status": "success", "message": f"Form record {record_id} deleted"}
