from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.fastapi_app import app
from src.utils.db import (
    AgentProfileTable,
    Base,
    FormTable,
    KnowledgeBaseTable,
    McpServerTable,
    SkillTable,
    UserTable,
    get_db,
)


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


def test_member_agent_update_change_request_includes_previous_values(client):
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
    owner_created = client.post(
        "/api/agent-profiles",
        headers=_auth("user-owner", workspace_id),
        json=_agent_payload(),
    )
    assert owner_created.status_code == 200

    payload = _agent_payload()
    payload["name"] = "Support v2"
    change = client.put(
        "/api/agent-profiles/agent-1",
        headers=_auth("user-member", workspace_id),
        json=payload,
    )

    assert change.status_code == 200
    body = change.json()
    assert body["status"] == "pending"
    assert body["action"] == "update"
    assert body["payload"]["name"] == "Support v2"
    assert body["payload"]["previousValues"]["name"] == "Support"


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


def test_member_form_update_change_request_includes_previous_values(client):
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

    payload = _form_payload()
    payload["name"] = "Orders v2"
    change = client.put(
        "/api/forms/form-1",
        headers=_auth("user-member", workspace_id),
        json=payload,
    )

    assert change.status_code == 200
    body = change.json()
    assert body["status"] == "pending"
    assert body["action"] == "update"
    assert body["payload"]["name"] == "Orders v2"
    assert body["payload"]["previousValues"]["name"] == "Orders"


def test_member_form_record_update_change_request_includes_previous_values(client):
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
    record = client.post(
        "/api/forms/form-1/records",
        headers=_auth("user-owner", workspace_id),
        json={"id": "record-1", "data": {"customer": "Acme"}},
    )
    assert record.status_code == 200

    change = client.put(
        "/api/forms/form-1/records/record-1",
        headers=_auth("user-member", workspace_id),
        json={"id": "record-1", "data": {"customer": "Beta"}},
    )

    assert change.status_code == 200
    body = change.json()
    assert body["status"] == "pending"
    assert body["action"] == "update"
    assert body["payload"]["data"] == {"customer": "Beta"}
    assert body["payload"]["previousValues"]["data"] == {"customer": "Acme"}


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


def test_legacy_unscoped_resources_do_not_leak_into_new_workspaces(client):
    override_get_db = app.dependency_overrides[get_db]
    db_gen = override_get_db()
    db = next(db_gen)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    try:
        db.add(AgentProfileTable(
            id="legacy-agent",
            owner_user_id="user-owner",
            workspace_id=None,
            name="Legacy Role",
            description="Imported before workspace scoping",
            system_prompt="Legacy prompt",
            graph_id=None,
            enabled_tools=[],
            knowledge_base_ids=[],
            skill_ids=[],
            mcp_ids=[],
            agent_ids=[],
            form_ids=[],
            wake_words=[],
            created_at=now,
            updated_at=now,
        ))
        db.add(SkillTable(
            id="legacy-skill",
            owner_user_id="user-owner",
            workspace_id=None,
            name="Legacy Skill",
            description="",
            content="---\nname: Legacy Skill\ndescription: legacy\n---\nUse legacy instructions.",
            created_at=now,
            updated_at=now,
        ))
        db.add(KnowledgeBaseTable(
            id="legacy-kb",
            owner_user_id="user-owner",
            workspace_id=None,
            name="Legacy KB",
            description="",
            files=[],
            import_status="ready",
            created_at=now,
            updated_at=now,
        ))
        db.add(McpServerTable(
            id="legacy-mcp",
            owner_user_id="user-owner",
            workspace_id=None,
            name="Legacy MCP",
            type="streamable_http",
            url="http://legacy.test/mcp",
            headers={},
            tools=[],
            resources=[],
            prompts=[],
            created_at=now,
            updated_at=now,
        ))
        db.add(FormTable(
            id="legacy-form",
            owner_user_id="user-owner",
            workspace_id=None,
            name="Legacy Form",
            description="",
            category="",
            fields=[],
            hooks=[],
            created_at=now,
            updated_at=now,
        ))
        db.commit()
    finally:
        db.close()
        db_gen.close()

    default_workspace = client.get("/api/workspaces", headers=_auth("user-owner")).json()[0]["id"]
    default_agents = client.get(
        "/api/agent-profiles",
        headers=_auth("user-owner", default_workspace),
    ).json()
    default_skills = client.get("/api/skills", headers=_auth("user-owner", default_workspace)).json()
    default_kbs = client.get("/api/knowledge-bases", headers=_auth("user-owner", default_workspace)).json()
    default_mcps = client.get("/api/mcp-servers", headers=_auth("user-owner", default_workspace)).json()
    default_forms = client.get("/api/forms", headers=_auth("user-owner", default_workspace)).json()
    created = client.post(
        "/api/workspaces",
        headers=_auth("user-owner"),
        json={"name": "New Space"},
    )
    workspace_id = created.json()["id"]
    new_workspace_agents = client.get(
        "/api/agent-profiles",
        headers=_auth("user-owner", workspace_id),
    ).json()
    new_workspace_skills = client.get("/api/skills", headers=_auth("user-owner", workspace_id)).json()
    new_workspace_kbs = client.get("/api/knowledge-bases", headers=_auth("user-owner", workspace_id)).json()
    new_workspace_mcps = client.get("/api/mcp-servers", headers=_auth("user-owner", workspace_id)).json()
    new_workspace_forms = client.get("/api/forms", headers=_auth("user-owner", workspace_id)).json()

    assert any(agent["id"] == "legacy-agent" for agent in default_agents)
    assert any(skill["id"] == "legacy-skill" for skill in default_skills)
    assert any(kb["id"] == "legacy-kb" for kb in default_kbs)
    assert any(mcp["id"] == "legacy-mcp" for mcp in default_mcps)
    assert any(form["id"] == "legacy-form" for form in default_forms)
    assert all(agent["id"] != "legacy-agent" for agent in new_workspace_agents)
    assert all(skill["id"] != "legacy-skill" for skill in new_workspace_skills)
    assert all(kb["id"] != "legacy-kb" for kb in new_workspace_kbs)
    assert all(mcp["id"] != "legacy-mcp" for mcp in new_workspace_mcps)
    assert all(form["id"] != "legacy-form" for form in new_workspace_forms)

    update = client.put(
        "/api/agent-profiles/legacy-agent",
        headers=_auth("user-owner", workspace_id),
        json={**_agent_payload("legacy-agent"), "name": "Moved Legacy Role"},
    )
    assert update.status_code == 404
