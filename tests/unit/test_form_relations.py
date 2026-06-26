"""Tests for form reference field relation helpers."""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.utils.db import Base, FormRecordTable, FormTable
from src.utils.form_relations import (
    apply_target_delete_policy,
    resolve_record_references,
    validate_form_definition_relations,
    validate_record_relations,
)


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _form(form_id: str, fields: list[dict]) -> FormTable:
    return FormTable(
        id=form_id,
        owner_user_id="user-1",
        name=form_id,
        description="",
        category="",
        fields=fields,
        hooks=[],
        created_at="now",
        updated_at="now",
    )


def _record(record_id: str, form_id: str, data: dict) -> FormRecordTable:
    return FormRecordTable(
        id=record_id,
        form_id=form_id,
        owner_user_id="user-1",
        data=data,
        created_at="now",
        updated_at="now",
    )


def test_validate_form_definition_rejects_missing_target_form(db_session):
    fields = [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": True,
        "options": [],
        "binding": {"targetFormId": "customers", "relation": "many_to_one", "onTargetDelete": "restrict"},
    }]

    with pytest.raises(HTTPException) as exc:
        validate_form_definition_relations(db_session, "user-1", fields)

    assert exc.value.status_code == 400
    assert "missing form" in str(exc.value.detail)


def test_validate_record_relations_requires_existing_target_record(db_session):
    customers = _form("customers", [{"id": "name", "label": "Name", "type": "text"}])
    orders = _form("orders", [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": True,
        "options": [],
        "binding": {"targetFormId": "customers", "relation": "many_to_one", "onTargetDelete": "restrict"},
    }])
    db_session.add_all([customers, orders])
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        validate_record_relations(db_session, "user-1", orders, {"customer": "record-missing"})

    assert exc.value.status_code == 400
    assert "missing record" in str(exc.value.detail)


def test_validate_record_relations_enforces_one_to_one(db_session):
    customers = _form("customers", [{"id": "name", "label": "Name", "type": "text"}])
    orders = _form("orders", [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": False,
        "options": [],
        "binding": {"targetFormId": "customers", "relation": "one_to_one", "onTargetDelete": "restrict"},
    }])
    db_session.add_all([
        customers,
        orders,
        _record("customer-1", "customers", {"name": "Acme"}),
        _record("order-1", "orders", {"customer": "customer-1"}),
    ])
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        validate_record_relations(db_session, "user-1", orders, {"customer": "customer-1"}, "order-2")

    assert exc.value.status_code == 400
    assert "unique" in str(exc.value.detail)


def test_resolve_record_references_uses_configured_display_field(db_session):
    customers = _form("customers", [{"id": "name", "label": "Name", "type": "text"}])
    orders = _form("orders", [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": False,
        "options": [],
        "binding": {
            "targetFormId": "customers",
            "targetDisplayFieldId": "name",
            "relation": "many_to_one",
            "onTargetDelete": "restrict",
        },
    }])
    order = _record("order-1", "orders", {"customer": "customer-1"})
    db_session.add_all([
        customers,
        orders,
        _record("customer-1", "customers", {"name": "Acme"}),
        order,
    ])
    db_session.commit()

    references = resolve_record_references(db_session, "user-1", orders, order)

    assert references["customer"]["recordId"] == "customer-1"
    assert references["customer"]["label"] == "Acme"
    assert references["customer"]["exists"] is True


def test_apply_target_delete_policy_restricts_referenced_record(db_session):
    customers = _form("customers", [{"id": "name", "label": "Name", "type": "text"}])
    orders = _form("orders", [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": False,
        "options": [],
        "binding": {"targetFormId": "customers", "relation": "many_to_one", "onTargetDelete": "restrict"},
    }])
    db_session.add_all([
        customers,
        orders,
        _record("customer-1", "customers", {"name": "Acme"}),
        _record("order-1", "orders", {"customer": "customer-1"}),
    ])
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        apply_target_delete_policy(db_session, "user-1", "customers", "customer-1")

    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "record_referenced"


def test_apply_target_delete_policy_set_null_clears_reference(db_session):
    customers = _form("customers", [{"id": "name", "label": "Name", "type": "text"}])
    orders = _form("orders", [{
        "id": "customer",
        "label": "Customer",
        "type": "reference",
        "required": False,
        "options": [],
        "binding": {"targetFormId": "customers", "relation": "many_to_one", "onTargetDelete": "set_null"},
    }])
    order = _record("order-1", "orders", {"customer": "customer-1"})
    db_session.add_all([
        customers,
        orders,
        _record("customer-1", "customers", {"name": "Acme"}),
        order,
    ])
    db_session.commit()

    apply_target_delete_policy(db_session, "user-1", "customers", "customer-1")

    assert order.data["customer"] is None
