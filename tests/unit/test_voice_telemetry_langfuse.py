"""Tests for voice telemetry through the shared Langfuse SDK."""

from contextlib import nullcontext
from unittest.mock import Mock, patch

from src.utils.voice_telemetry import record_voice_event


def test_record_voice_event_uses_langfuse_when_configured(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    client = Mock()
    observation = Mock()
    client.start_observation.return_value = observation

    with (
        patch("langfuse.get_client", return_value=client),
        patch("langfuse.propagate_attributes", return_value=nullcontext()),
    ):
        recorded = record_voice_event(
            name="voice.client.listening",
            voice_session_id="voice-session-1",
            traceparent="00-trace-span-01",
            timestamp_ms=1000,
            attributes={"voice.event": "listening"},
        )

    assert recorded is True
    client.start_observation.assert_called_once()
    call = client.start_observation.call_args.kwargs
    assert call["name"] == "voice.client.listening"
    assert call["as_type"] == "span"
    assert call["metadata"]["voice.session_id"] == "voice-session-1"
    assert call["metadata"]["voice.traceparent"] == "00-trace-span-01"
    assert call["metadata"]["voice.event_timestamp_ms"] == 1000
    observation.end.assert_called_once_with()
