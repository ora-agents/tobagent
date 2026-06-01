from types import SimpleNamespace

import pytest
from langgraph_sdk import Auth

from src.api.auth import (
    MAX_MESSAGE_CHARS,
    add_owner,
    authenticate,
    enrich_run_metadata,
    validate_config,
    validate_inputs,
)


@pytest.mark.anyio
async def test_authenticate_extracts_authorization_from_headers(monkeypatch):
    """Aegra auth middleware passes only headers to the auth callback."""
    monkeypatch.delenv("LANGGRAPH_AUTH_SECRET", raising=False)

    user = await authenticate({"authorization": "Bearer user-123"})

    assert user["identity"] == "user-123"
    assert user["is_authenticated"] is True


@pytest.mark.anyio
async def test_authenticate_accepts_secret_header_case_insensitively(monkeypatch):
    """Header matching should survive ASGI and test-client casing differences."""
    monkeypatch.setenv("LANGGRAPH_AUTH_SECRET", "secret")

    user = await authenticate(
        {
            "Authorization": "Bearer user-123",
            "X-Auth-Key": "secret",
        }
    )

    assert user["identity"] == "user-123"


@pytest.mark.anyio
async def test_thread_auth_accepts_empty_aegra_create_payload():
    """Aegra may authorize SDK thread creation before a request body exists."""
    ctx = SimpleNamespace(user=SimpleNamespace(identity="user-1"))

    result = await add_owner(ctx, None)

    assert result == {"user_id": "user-1"}


@pytest.mark.anyio
async def test_thread_auth_normalizes_none_metadata():
    ctx = SimpleNamespace(user=SimpleNamespace(identity="user-1"))
    value = {"metadata": None}

    result = await add_owner(ctx, value)

    assert result == {"user_id": "user-1"}
    assert value["metadata"]["user_id"] == "user-1"


def test_validate_inputs_accepts_forked_conversation_history():
    """Forked reruns may send prior user/assistant messages plus a final user turn."""
    payload = {
        "messages": [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
            {"role": "user", "content": "edited follow-up"},
        ]
    }

    assert validate_inputs(payload, None) is False


def test_validate_inputs_rejects_history_without_final_user_message():
    """The final run input must still be a user turn."""
    payload = {
        "messages": [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ]
    }

    with pytest.raises(Auth.exceptions.HTTPException):
        validate_inputs(payload, None)


def test_validate_inputs_truncates_all_message_content():
    """Every message in forked history is capped before reaching the graph."""
    long_content = "x" * (MAX_MESSAGE_CHARS + 10)
    payload = {
        "messages": [
            {"role": "user", "content": long_content},
            {"role": "assistant", "content": long_content},
            {"role": "user", "content": long_content},
        ]
    }

    validate_inputs(payload, None)

    assert all(
        len(message["content"]) == MAX_MESSAGE_CHARS
        for message in payload["messages"]
    )


def test_validate_config_requires_agent_id_for_user_runs():
    with pytest.raises(Auth.exceptions.HTTPException):
        validate_config({}, owner_user_id="user-1", require_agent_id=True)


def test_validate_config_accepts_context_agent_id(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())

    context = {"agent_id": "agent-1"}

    validate_config({}, context=context, owner_user_id="user-1", require_agent_id=True)

    assert context["agent_id"] == "agent-1"
    assert context["user_id"] == "user-1"


def test_validate_config_applies_owned_overrides(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())
    monkeypatch.setattr("src.api.auth._require_owned_agent_ids", lambda *_args: None)

    config = {
        "configurable": {
            "agent_id": "agent-1",
            "user_id": "spoofed-user",
            "overrides": {
                "system_prompt": "Use the request prompt.",
                "enabled_tools": ["rag_search", "fetch"],
                "agent_ids": ["agent-2"],
                "model": "gpt-4o",
            },
        }
    }
    context = {}

    validate_config(config, context=context, owner_user_id="user-1", require_agent_id=True)

    assert "configurable" not in config
    assert context["agent_id"] == "agent-1"
    assert context["user_id"] == "user-1"
    assert context["system_prompt"] == "Use the request prompt."
    assert context["enabled_tools"] == ["rag_search", "fetch"]
    assert context["agent_ids"] == ["agent-2"]
    assert context["model"] == "gpt-4o"
    assert "overrides" not in context


def test_validate_config_rejects_unknown_tool_override(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())

    config = {
        "configurable": {
            "agent_id": "agent-1",
            "overrides": {"enabled_tools": ["private_admin"]},
        }
    }

    with pytest.raises(Auth.exceptions.HTTPException):
        validate_config(config, owner_user_id="user-1", require_agent_id=True)


@pytest.mark.anyio
async def test_create_run_auth_writes_validated_config_back_to_kwargs(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())

    ctx = SimpleNamespace(user=SimpleNamespace(identity="user-1"))
    value = {
        "kwargs": {
            "input": {"messages": [{"role": "user", "content": "hello"}]},
        },
        "config": {
            "configurable": {
                "agent_id": "agent-1",
            },
        },
    }

    await enrich_run_metadata(ctx, value)

    assert "configurable" not in value["kwargs"]["config"]
    assert "configurable" not in value["config"]
    assert value["kwargs"]["context"]["agent_id"] == "agent-1"
    assert value["kwargs"]["context"]["user_id"] == "user-1"
    assert value["context"]["agent_id"] == "agent-1"
    assert value["context"]["user_id"] == "user-1"


@pytest.mark.anyio
async def test_create_run_auth_normalizes_none_metadata(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())

    ctx = SimpleNamespace(user=SimpleNamespace(identity="user-1"))
    value = {
        "metadata": None,
        "kwargs": {
            "input": {"messages": [{"role": "user", "content": "hello"}]},
            "config": {
                "configurable": {
                    "agent_id": "agent-1",
                },
            },
        },
    }

    await enrich_run_metadata(ctx, value)

    assert value["metadata"]["source_type"] == "Chat-LangChain"


@pytest.mark.anyio
async def test_create_run_auth_accepts_agent_id_from_run_metadata(monkeypatch):
    monkeypatch.setattr("src.api.auth._load_owned_agent_profile", lambda *_args: object())

    ctx = SimpleNamespace(user=SimpleNamespace(identity="user-1"))
    value = {
        "metadata": {"agent_id": "agent-1"},
        "kwargs": {
            "input": {"messages": [{"role": "user", "content": "hello"}]},
        },
    }

    await enrich_run_metadata(ctx, value)

    assert value["kwargs"]["context"]["agent_id"] == "agent-1"
    assert value["kwargs"]["context"]["user_id"] == "user-1"
    assert value["context"]["agent_id"] == "agent-1"
    assert value["context"]["user_id"] == "user-1"
