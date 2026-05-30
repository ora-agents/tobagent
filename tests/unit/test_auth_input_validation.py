import pytest
from langgraph_sdk import Auth

from src.api.auth import MAX_MESSAGE_CHARS, authenticate, validate_inputs


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
