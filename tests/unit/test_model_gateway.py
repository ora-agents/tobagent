from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.deps import hash_api_key
from src.api.fastapi_app import app
from src.api.routes import model_gateway
from src.utils.db import (
    AgentProfileTable,
    Base,
    UserApiKeyTable,
    UserTable,
    get_db,
)


class _FakeAgent:
    async def astream_events(self, input_payload, *, context, config, version):
        assert input_payload["messages"][-1] == {"role": "user", "content": "你是谁？"}
        assert context["user_id"] == "user-1"
        assert context["agent_id"] == "agent-1"
        assert context["model"] == "qwen-plus"
        assert config["metadata"]["conversation_source"] == "model_gateway"
        assert version == "v2"
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": SimpleNamespace(content="我是")},
        }
        yield {
            "event": "on_chat_model_stream",
            "data": {"chunk": SimpleNamespace(content="测试助手")},
        }


@pytest.fixture()
def client(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with TestingSessionLocal() as db:
        db.add(UserTable(
            id="user-1",
            username="owner",
            password_hash="unused",
            created_at=now,
        ))
        db.add(UserApiKeyTable(
            id="key-1",
            owner_user_id="user-1",
            name="Gateway",
            key_hash=hash_api_key("raw-key"),
            key_prefix="raw",
            created_at=now,
        ))
        db.add(AgentProfileTable(
            id="agent-1",
            owner_user_id="user-1",
            name="Gateway agent",
            system_prompt="Be concise.",
            model=None,
            enabled_tools=[],
            created_at=now,
            updated_at=now,
        ))
        db.commit()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(model_gateway, "_get_generic_agent", lambda: _FakeAgent())
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client, TestingSessionLocal
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_model_gateway_streams_sse_chunks_and_updates_api_key(client):
    test_client, session_factory = client

    response = test_client.post(
        "/api/model-gateway/chat/completions",
        headers={"Authorization": "raw-key--agent-1"},
        json={
            "model": "qwen-plus",
            "messages": [
                {"role": "assistant", "content": "这是一个测试开场白"},
                {"role": "user", "content": "你是谁？"},
            ],
            "stream": True,
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'data: {"choices": [{"delta": {"content": "我是"}' in response.text
    assert 'data: {"choices": [{"delta": {"content": "测试助手"}' in response.text
    assert '"finish_reason": "stop"' in response.text
    with session_factory() as db:
        assert db.get(UserApiKeyTable, "key-1").last_used_at


def test_model_gateway_accepts_bearer_prefix(client):
    test_client, _session_factory = client

    response = test_client.post(
        "/api/model-gateway/chat/completions",
        headers={"Authorization": "Bearer raw-key--agent-1"},
        json={
            "model": "qwen-plus",
            "messages": [{"role": "user", "content": "你是谁？"}],
            "stream": False,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"choices": [{"delta": {"content": "我是测试助手"}}]}


def test_model_gateway_rejects_missing_agent_separator(client):
    test_client, _session_factory = client

    response = test_client.post(
        "/api/model-gateway/chat/completions",
        headers={"Authorization": "raw-key"},
        json={
            "messages": [{"role": "user", "content": "你是谁？"}],
            "stream": True,
        },
    )

    assert response.status_code == 401
    assert "api-key" in response.json()["detail"]
