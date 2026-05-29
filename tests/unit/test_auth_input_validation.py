import pytest
from langgraph_sdk import Auth

from src.api.auth import MAX_MESSAGE_CHARS, validate_inputs


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
