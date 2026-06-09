"""Tests for the voice proxy endpoints."""

import base64

import pytest

from src.api import voice_proxy


def test_coerce_tts_voice_accepts_only_non_empty_strings():
    """Client TTS voice config should not replace defaults with blank values."""
    assert voice_proxy._coerce_tts_voice(" Ethan ") == "Ethan"
    assert voice_proxy._coerce_tts_voice("") is None
    assert voice_proxy._coerce_tts_voice("   ") is None
    assert voice_proxy._coerce_tts_voice(None) is None


def test_audio_gate_accepts_loud_clean_segments(monkeypatch):
    """Audio quality gate should accept loud speech above the noise floor."""
    monkeypatch.setattr(voice_proxy, "AUDIO_GATE_ENABLED", True)

    stats = voice_proxy.AudioStats(
        rms_dbfs=-25.0,
        peak_dbfs=-15.0,
        noise_dbfs=-45.0,
        snr_db=20.0,
    )

    assert voice_proxy._passes_audio_gate(stats)


def test_audio_gate_rejects_low_snr_segments(monkeypatch):
    """Audio quality gate should reject speech-like segments buried in noise."""
    monkeypatch.setattr(voice_proxy, "AUDIO_GATE_ENABLED", True)

    stats = voice_proxy.AudioStats(
        rms_dbfs=-30.0,
        peak_dbfs=-18.0,
        noise_dbfs=-35.0,
        snr_db=5.0,
    )

    assert not voice_proxy._passes_audio_gate(stats)


def test_audio_stats_reports_snr_relative_to_noise_floor():
    """Audio stats should compute dBFS and SNR from float32 samples."""
    samples = voice_proxy.np.full(16000, 0.1, dtype=voice_proxy.np.float32)

    stats = voice_proxy._audio_stats(samples, noise_rms=0.01)

    assert stats.rms_dbfs == pytest.approx(-20.0, abs=0.2)
    assert stats.peak_dbfs == pytest.approx(-20.0, abs=0.2)
    assert stats.noise_dbfs == pytest.approx(-40.0, abs=0.2)
    assert stats.snr_db == pytest.approx(20.0, abs=0.3)


def test_speaker_verifier_is_disabled_without_config(monkeypatch):
    """Wake speaker binding should degrade safely when no model is configured."""
    monkeypatch.setattr(voice_proxy, "SPEAKER_BINDING_ENABLED", False)
    monkeypatch.setattr(voice_proxy, "SPEAKER_MODEL_PATH", "")

    assert voice_proxy._create_wake_speaker_verifier() is None


@pytest.mark.anyio
async def test_profile_speaker_verification_disabled_accepts_without_embedding():
    """Disabled profile speaker verification should not block ASR."""
    profile = voice_proxy.AgentProfileTable(
        id="agent-1",
        name="Agent",
        speaker_verification_enabled=False,
        speaker_embedding=None,
        created_at="now",
        updated_at="now",
    )

    response = await voice_proxy._verify_profile_speaker(
        profile=profile,
        audio_data_uri="data:audio/wav;base64,",
    )

    assert response.accepted
    assert not response.enabled
    assert not response.bound


@pytest.mark.anyio
async def test_profile_speaker_verification_enabled_rejects_when_unbound():
    """Enabled profile speaker verification should require an enrolled voiceprint."""
    profile = voice_proxy.AgentProfileTable(
        id="agent-1",
        name="Agent",
        speaker_verification_enabled=True,
        speaker_embedding=None,
        created_at="now",
        updated_at="now",
    )

    response = await voice_proxy._verify_profile_speaker(
        profile=profile,
        audio_data_uri="data:audio/wav;base64,",
    )

    assert not response.accepted
    assert response.enabled
    assert not response.bound


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
