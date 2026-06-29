from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.utils.db import Base, UserTable, get_db


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    db.add_all([
        UserTable(
            id="user-owner",
            username="owner",
            password_hash="unused",
            created_at=now,
        ),
        UserTable(
            id="user-member",
            username="member",
            password_hash="unused",
            created_at=now,
        ),
    ])
    db.commit()
    db.close()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


def _auth(user_id: str, workspace_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {user_id}"}
    if workspace_id:
        headers["X-Workspace-ID"] = workspace_id
    return headers


def _agent_payload(agent_id: str = "agent-1") -> dict:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return {
        "id": agent_id,
        "name": "Support",
        "description": "Support agent",
        "systemPrompt": "Help users.",
        "model": None,
        "graphId": None,
        "enabledTools": [],
        "knowledgeBaseIds": [],
        "skillIds": [],
        "mcpIds": [],
        "agentIds": [],
        "formIds": [],
        "formPermissions": {},
        "wakeWords": [],
        "roleTemplateId": None,
        "personaStyle": None,
        "boundaryMode": None,
        "ttsVoice": None,
        "isHidden": False,
        "voiceInterruptionEnabled": True,
        "speakerVerificationEnabled": False,
        "speakerVerificationBound": False,
        "speakerSampleText": None,
        "speakerEnrolledAt": None,
        "userVoiceprintId": None,
        "createdAt": now,
        "updatedAt": now,
    }


def test_default_workspace_is_created_for_user(client):
    response = client.get("/api/workspaces", headers=_auth("user-owner"))

    assert response.status_code == 200
    workspaces = response.json()
    assert len(workspaces) == 1
    assert workspaces[0]["ownerUserId"] == "user-owner"
    assert workspaces[0]["currentUserRole"] == "owner"


def _form_payload(form_id: str = "form-1") -> dict:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return {
        "id": form_id,
        "name": "Orders",
        "description": "",
        "category": "",
        "fields": [
            {
                "id": "customer",
                "label": "Customer",
                "type": "text",
                "required": False,
                "options": [],
            }
        ],
        "hooks": [],
        "recordCount": 0,
        "createdAt": now,
        "updatedAt": now,
    }


def test_member_can_read_and_submits_workspace_resource_changes_for_approval(client):
    created = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "Team"},
    )
    workspace_id = created.json()["id"]
    member = client.post(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth("user-owner"),
        json={"username": "member", "role": "member"},
    )
    assert member.status_code == 200

    write_response = client.post(
        "/api/agent-profiles",
        headers=_auth("user-member", workspace_id),
        json=_agent_payload(),
    )
    assert write_response.status_code == 200
    assert write_response.json()["status"] == "pending"
    assert write_response.json()["targetType"] == "agent_profile"

    read_response = client.get(
        "/api/agent-profiles",
        headers=_auth("user-member", workspace_id),
    )
    assert read_response.status_code == 200


def test_member_change_request_is_applied_by_owner(client):
    created = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "Team"},
    )
    workspace_id = created.json()["id"]
    client.post(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth("user-owner"),
        json={"username": "member", "role": "member"},
    )

    change = client.post(
        f"/api/workspaces/{workspace_id}/change-requests",
        headers=_auth("user-member", workspace_id),
        json={
            "targetType": "agent_profile",
            "targetId": "agent-1",
            "action": "create",
            "payload": _agent_payload(),
        },
    )
    assert change.status_code == 200

    approved = client.post(
        f"/api/workspaces/{workspace_id}/change-requests/{change.json()['id']}/approve",
        headers=_auth("user-owner", workspace_id),
        json={"note": "ok"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "applied"

    listed = client.get("/api/agent-profiles", headers=_auth("user-member", workspace_id))
    assert "agent-1" in [agent["id"] for agent in listed.json()]


def test_workspace_member_role_change_request_is_applied_by_owner(client):
    created = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "Team"},
    )
    workspace_id = created.json()["id"]
    client.post(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth("user-owner"),
        json={"username": "member", "role": "member"},
    )

    change = client.post(
        f"/api/workspaces/{workspace_id}/change-requests",
        headers=_auth("user-member", workspace_id),
        json={
            "targetType": "workspace_member",
            "targetId": "user-member",
            "action": "update",
            "payload": {"userId": "user-member", "role": "admin"},
        },
    )
    assert change.status_code == 200

    approved = client.post(
        f"/api/workspaces/{workspace_id}/change-requests/{change.json()['id']}/approve",
        headers=_auth("user-owner", workspace_id),
        json={"note": "ok"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "applied"

    members = client.get(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth("user-owner", workspace_id),
    ).json()
    member = next(item for item in members if item["userId"] == "user-member")
    assert member["role"] == "admin"


def test_member_form_record_change_request_is_applied_by_owner(client):
    created = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "Team"},
    )
    workspace_id = created.json()["id"]
    client.post(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth("user-owner"),
        json={"username": "member", "role": "member"},
    )
    form = client.post(
        "/api/forms",
        headers=_auth("user-owner", workspace_id),
        json=_form_payload(),
    )
    assert form.status_code == 200

    change = client.post(
        "/api/forms/form-1/records",
        headers=_auth("user-member", workspace_id),
        json={
            "id": "record-1",
            "data": {"customer": "Acme"},
        },
    )
    assert change.status_code == 200
    assert change.json()["status"] == "pending"
    assert change.json()["targetType"] == "form_record"

    listed_before = client.get(
        "/api/forms/form-1/records",
        headers=_auth("user-owner", workspace_id),
    )
    assert listed_before.json()["total"] == 0

    approved = client.post(
        f"/api/workspaces/{workspace_id}/change-requests/{change.json()['id']}/approve",
        headers=_auth("user-owner", workspace_id),
        json={"note": "ok"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "applied"

    listed_after = client.get(
        "/api/forms/form-1/records",
        headers=_auth("user-member", workspace_id),
    )
    assert listed_after.json()["total"] == 1
    assert listed_after.json()["records"][0]["data"] == {"customer": "Acme"}


def test_platform_agent_is_scoped_to_active_workspace(client):
    first = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "First"},
    ).json()["id"]
    second = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "Second"},
    ).json()["id"]

    first_agents = client.get("/api/agent-profiles", headers=_auth("user-owner", first)).json()
    second_agents = client.get("/api/agent-profiles", headers=_auth("user-owner", second)).json()
    first_platform = [agent for agent in first_agents if agent["graphId"] == "agent_builder"]
    second_platform = [agent for agent in second_agents if agent["graphId"] == "agent_builder"]

    assert len(first_platform) == 1
    assert len(second_platform) == 1
    assert first_platform[0]["id"] != second_platform[0]["id"]
