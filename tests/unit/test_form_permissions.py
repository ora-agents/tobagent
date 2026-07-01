"""Tests for agent form permissions and form API-key authentication."""

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api.deps import get_current_user, hash_api_key
from src.tools import form_tool
from src.tools.form_tool import ManageFormDataTool
from src.utils.db import (
    AgentProfileTable,
    Base,
    FormRecordTable,
    FormTable,
    UserApiKeyTable,
    UserTable,
)
from src.utils.form_permissions import has_form_permission, normalize_form_permissions


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_legacy_form_links_default_to_read_only():
    permissions = normalize_form_permissions(["orders"], None)

    assert permissions == {"orders": ["read"]}
    assert has_form_permission(["orders"], None, "orders", "read")
    assert not has_form_permission(["orders"], None, "orders", "create")


def test_form_permissions_drop_unlinked_forms_and_invalid_actions():
    permissions = normalize_form_permissions(
        ["orders"],
        {
            "orders": ["delete", "read", "unknown"],
            "unlinked": ["read"],
        },
    )

    assert permissions == {"orders": ["read", "delete"]}


@pytest.mark.anyio
async def test_current_user_accepts_user_api_key(db_session):
    now = datetime.now(UTC).isoformat()
    raw_key = "tob_test_api_key"
    db_session.add(UserTable(
        id="user-1",
        username="owner",
        password_hash="unused",
        created_at=now,
    ))
    db_session.add(UserApiKeyTable(
        id="key-1",
        owner_user_id="user-1",
        name="Forms integration",
        key_hash=hash_api_key(raw_key),
        key_prefix="tob_test",
        created_at=now,
    ))
    db_session.commit()

    user = await get_current_user(
        authorization=f"Bearer {raw_key}",
        db=db_session,
    )

    assert user.id == "user-1"
    assert db_session.get(UserApiKeyTable, "key-1").last_used_at


def test_manage_form_tool_enforces_action_permission(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    now = datetime.now(UTC).isoformat()
    with session_factory() as session:
        session.add(FormTable(
            id="orders",
            owner_user_id="user-1",
            name="Orders",
            fields=[],
            created_at=now,
            updated_at=now,
        ))
        session.add(AgentProfileTable(
            id="agent-1",
            owner_user_id="user-1",
            name="Order agent",
            enabled_tools=[],
            form_ids=["orders"],
            form_permissions={"orders": ["create"]},
            created_at=now,
            updated_at=now,
        ))
        session.commit()

    monkeypatch.setattr(form_tool, "SessionLocal", session_factory)
    monkeypatch.setattr(
        form_tool,
        "get_runtime_context_value",
        lambda key: {"agent_id": "agent-1", "user_id": "user-1"}[key],
    )
    tool = ManageFormDataTool()

    created = tool._run(action="create", form_id="orders", data={"name": "A"})
    denied = tool._run(
        action="delete",
        form_id="orders",
        record_id="missing",
    )

    created_payload = json.loads(created)
    assert created_payload["status"] == "success"
    assert created_payload["recordId"] == created_payload["record"]["id"]
    assert created_payload["record"]["formId"] == "orders"
    assert created_payload["record"]["createdAt"]
    assert created_payload["record"]["updatedAt"]
    assert "does not grant delete permission" in denied
    with session_factory() as session:
        assert session.query(FormRecordTable).count() == 1


def test_manage_form_tool_validates_record_data_against_form_fields(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    now = datetime.now(UTC).isoformat()
    with session_factory() as session:
        session.add(FormTable(
            id="orders",
            owner_user_id="user-1",
            name="Orders",
            fields=[
                {"id": "customer", "label": "Customer", "type": "text", "required": True, "options": []},
                {"id": "amount", "label": "Amount", "type": "number", "required": False, "options": []},
                {"id": "status", "label": "Status", "type": "select", "required": False, "options": ["new", "done"]},
            ],
            created_at=now,
            updated_at=now,
        ))
        session.add(AgentProfileTable(
            id="agent-1",
            owner_user_id="user-1",
            name="Order agent",
            enabled_tools=[],
            form_ids=["orders"],
            form_permissions={"orders": ["create"]},
            created_at=now,
            updated_at=now,
        ))
        session.commit()

    monkeypatch.setattr(form_tool, "SessionLocal", session_factory)
    monkeypatch.setattr(
        form_tool,
        "get_runtime_context_value",
        lambda key: {"agent_id": "agent-1", "user_id": "user-1"}[key],
    )
    tool = ManageFormDataTool()

    created = tool._run(
        action="create",
        form_id="orders",
        data={"customer": "Acme", "amount": "12.5", "status": "new"},
    )
    unknown = tool._run(
        action="create",
        form_id="orders",
        data={"customer": "Acme", "unknown": "value"},
    )
    missing = tool._run(
        action="create",
        form_id="orders",
        data={"amount": 3},
    )

    created_payload = json.loads(created)
    assert created_payload["status"] == "success"
    assert created_payload["record"]["id"]
    assert created_payload["record"]["formId"] == "orders"
    assert created_payload["record"]["data"] == {"customer": "Acme", "amount": 12.5, "status": "new"}
    assert created_payload["record"]["createdAt"]
    assert created_payload["record"]["updatedAt"]
    assert "unknown field" in unknown
    assert "Customer" in missing
    with session_factory() as session:
        records = session.query(FormRecordTable).all()
        assert len(records) == 1
        assert records[0].data == {"customer": "Acme", "amount": 12.5, "status": "new"}
