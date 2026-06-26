"""Tool for querying records in forms linked to an agent profile."""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from src.utils.db import AgentProfileTable, FormRecordTable, FormTable, SessionLocal
from src.utils.form_hooks import trigger_form_hooks_sync
from src.utils.form_permissions import has_form_permission, normalize_form_permissions
from src.utils.form_relations import (
    apply_target_delete_policy,
    resolve_record_references,
    validate_record_relations,
)
from src.utils.runtime_context import get_runtime_context_value

logger = logging.getLogger(__name__)


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


class QueryFormDataInput(BaseModel):
    """Input schema for querying linked form records."""

    form_id: str = Field(default="", description="The form ID to query. Leave empty to list linked forms.")
    fields: list[str] = Field(default_factory=list, description="Specific field IDs to return. Empty returns all fields.")
    q: str = Field(default="", description="Optional keyword searched across record values.")
    filter_field: str = Field(default="", description="Field ID to filter by.")
    filter_value: str = Field(default="", description="Value used by the filter operation.")
    filter_op: str = Field(
        default="contains",
        description="One of contains, eq, ne, starts_with, ends_with, exists, missing, gt, gte, lt, lte.",
    )
    page: int = Field(default=1, ge=1, description="1-based result page.")
    page_size: int = Field(default=20, ge=1, le=100, description="Records per page.")


class QueryFormDataTool(BaseTool):
    """Query form records linked to the active agent."""

    name: str = "query_form_data"
    description: str = (
        "Query custom structured form records linked to this agent. Supports field projection, "
        "keyword search, a single field filter, and pagination. Call without form_id to list linked forms."
    )
    args_schema: type[BaseModel] = QueryFormDataInput

    def _linked_form_permissions(
        self,
        db,
        agent_id: str,
        owner_user_id: str,
    ) -> dict[str, list[str]] | None:
        if not agent_id or agent_id == "default" or not owner_user_id:
            return None
        profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id,
            AgentProfileTable.owner_user_id == owner_user_id,
        ).first()
        if not profile:
            return []
        return normalize_form_permissions(profile.form_ids, profile.form_permissions)

    def _run(
        self,
        form_id: str = "",
        fields: list[str] | None = None,
        q: str = "",
        filter_field: str = "",
        filter_value: str = "",
        filter_op: str = "contains",
        page: int = 1,
        page_size: int = 20,
        **_: Any,
    ) -> str:
        db = SessionLocal()
        try:
            agent_id = get_runtime_context_value("agent_id")
            owner_user_id = get_runtime_context_value("user_id")
            linked_form_permissions = self._linked_form_permissions(db, agent_id, owner_user_id)
            if linked_form_permissions is not None and not linked_form_permissions:
                return "This agent has no linked forms. Configure forms for this agent in the dashboard."
            readable_form_ids = (
                [
                    linked_form_id
                    for linked_form_id, permissions in linked_form_permissions.items()
                    if "read" in permissions
                ]
                if linked_form_permissions is not None
                else None
            )

            form_query = db.query(FormTable)
            if owner_user_id:
                form_query = form_query.filter(FormTable.owner_user_id == owner_user_id)
            if readable_form_ids is not None:
                form_query = form_query.filter(FormTable.id.in_(readable_form_ids))

            if not form_id:
                forms = form_query.all()
                if not forms:
                    return "No forms are available for this agent."
                return "\n".join(
                    ["Linked forms:"]
                    + [
                        f"- ID: {form.id} | Name: {form.name}"
                        f"{' | Type: ' + form.category if form.category else ''} | Fields: "
                        f"{', '.join(field.get('id', '') for field in (form.fields or []))}"
                        for form in forms
                    ]
                )

            form = form_query.filter(FormTable.id == form_id).first()
            if not form:
                return f"Form '{form_id}' was not found, is not linked, or does not grant read permission."

            page = max(1, int(page or 1))
            page_size = min(100, max(1, int(page_size or 20)))
            selected_fields = [field.strip() for field in (fields or []) if field.strip()]

            records = db.query(FormRecordTable).filter(
                FormRecordTable.form_id == form.id,
                FormRecordTable.owner_user_id == owner_user_id,
            ).order_by(FormRecordTable.created_at.desc()).all()
            filtered = [
                record
                for record in records
                if _record_matches(record.data or {}, q.strip(), filter_field.strip(), filter_value, filter_op)
            ]
            offset = (page - 1) * page_size
            page_records = filtered[offset:offset + page_size]
            rows = []
            for record in page_records:
                data = record.data or {}
                if selected_fields:
                    data = {field: data.get(field) for field in selected_fields if field in data}
                rows.append({
                    "id": record.id,
                    "data": data,
                    "references": resolve_record_references(db, owner_user_id, form, record),
                    "updatedAt": record.updated_at,
                })

            return json.dumps(
                {
                    "form": {
                        "id": form.id,
                        "name": form.name,
                        "category": form.category or "",
                        "fields": form.fields or [],
                    },
                    "page": page,
                    "pageSize": page_size,
                    "total": len(filtered),
                    "records": rows,
                },
                ensure_ascii=False,
                indent=2,
            )
        except Exception as exc:
            logger.error("Error querying form data: %s", exc)
            return f"Error occurred while querying form data: {exc}"
        finally:
            db.close()

    async def _arun(self, **kwargs) -> str:
        return await asyncio.to_thread(self._run, **kwargs)


class ManageFormDataInput(BaseModel):
    """Input schema for changing linked form records."""

    action: Literal["create", "update", "delete"] = Field(
        description="Record operation to perform.",
    )
    form_id: str = Field(description="Linked form ID.")
    record_id: str = Field(
        default="",
        description="Required for update and delete. Omit when creating.",
    )
    data: dict[str, Any] = Field(
        default_factory=dict,
        description="Complete record data for create or update.",
    )


class ManageFormDataTool(BaseTool):
    """Create, update, or delete records when the active agent is allowed."""

    name: str = "manage_form_data"
    description: str = (
        "Create, update, or delete a record in a linked form. Each operation is "
        "allowed only when that form grants the matching permission to this agent."
    )
    args_schema: type[BaseModel] = ManageFormDataInput

    def _run(
        self,
        action: Literal["create", "update", "delete"],
        form_id: str,
        record_id: str = "",
        data: dict[str, Any] | None = None,
        **_: Any,
    ) -> str:
        db = SessionLocal()
        try:
            agent_id = get_runtime_context_value("agent_id")
            owner_user_id = get_runtime_context_value("user_id")
            profile = db.query(AgentProfileTable).filter(
                AgentProfileTable.id == agent_id,
                AgentProfileTable.owner_user_id == owner_user_id,
            ).first()
            if not profile or not has_form_permission(
                profile.form_ids,
                profile.form_permissions,
                form_id,
                action,
            ):
                return (
                    f"Form '{form_id}' is not linked to this agent or does not "
                    f"grant {action} permission."
                )

            form = db.query(FormTable).filter(
                FormTable.id == form_id,
                FormTable.owner_user_id == owner_user_id,
            ).first()
            if not form:
                return f"Form '{form_id}' was not found."

            now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            old_data: dict[str, Any] = {}
            trigger_hooks = False
            if action == "create":
                validate_record_relations(db, owner_user_id, form, data or {})
                record = FormRecordTable(
                    id=f"record-{uuid.uuid4()}",
                    form_id=form_id,
                    owner_user_id=owner_user_id,
                    data=data or {},
                    created_at=now,
                    updated_at=now,
                )
                db.add(record)
                trigger_hooks = True
            else:
                if not record_id:
                    return f"record_id is required for {action}."
                record = db.query(FormRecordTable).filter(
                    FormRecordTable.id == record_id,
                    FormRecordTable.form_id == form_id,
                    FormRecordTable.owner_user_id == owner_user_id,
                ).first()
                if not record:
                    return f"Form record '{record_id}' was not found."
                if action == "update":
                    old_data = dict(record.data or {})
                    validate_record_relations(db, owner_user_id, form, data or {}, record_id)
                    record.data = data or {}
                    record.updated_at = now
                    trigger_hooks = True
                else:
                    apply_target_delete_policy(db, owner_user_id, form_id, record_id)
                    db.delete(record)

            db.commit()
            if trigger_hooks:
                db.refresh(record)
                try:
                    trigger_form_hooks_sync(form, record, old_data, record.data or {})
                except Exception as exc:
                    logger.warning("Form hooks failed after %s: %s", action, exc)
            return json.dumps(
                {
                    "status": "success",
                    "action": action,
                    "formId": form_id,
                    "recordId": record.id,
                    "data": record.data if action != "delete" else None,
                },
                ensure_ascii=False,
            )
        except Exception as exc:
            db.rollback()
            logger.error("Error managing form data: %s", exc)
            return f"Error occurred while managing form data: {exc}"
        finally:
            db.close()

    async def _arun(self, **kwargs) -> str:
        return await asyncio.to_thread(self._run, **kwargs)
