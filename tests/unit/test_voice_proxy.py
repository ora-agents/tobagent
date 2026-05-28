"""Tests for the voice proxy endpoints."""

import base64

import pytest

from src.api import voice_proxy


@pytest.mark.anyio
async def test_asr_transcribe_runs_blocking_request_in_thread(monkeypatch):
    """ASR endpoint must keep blocking file/SDK work off the event loop."""
    calls = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args, kwargs))
        return {
            "output": {
                "choices": [
                    {
                        "message": {
                            "content": [{"text": " hello "}],
                            "annotations": [{"language": "en"}],
                        }
                    }
                ]
            },
            "usage": {"seconds": 1.25},
        }

    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(voice_proxy.asyncio, "to_thread", fake_to_thread)

    audio = base64.b64encode(b"fake wav").decode("ascii")
    response = await voice_proxy.asr_transcribe(
        voice_proxy.AsrTranscribeRequest(audio=f"data:audio/wav;base64,{audio}")
    )

    assert response.text == "hello"
    assert response.language == "en"
    assert response.duration_seconds == 1.25
    assert len(calls) == 1

    func, args, kwargs = calls[0]
    assert func is voice_proxy._call_dashscope_asr
    assert args == ()
    assert kwargs == {
        "api_key": "test-key",
        "model": "qwen3-asr-flash",
        "audio_bytes": b"fake wav",
    }
