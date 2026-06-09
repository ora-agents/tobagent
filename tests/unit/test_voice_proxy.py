"""Tests for the voice proxy endpoints."""

import base64
from types import SimpleNamespace

import pytest

from src.api import voice_proxy


def test_coerce_tts_voice_accepts_only_non_empty_strings():
    """Client TTS voice config should not replace defaults with blank values."""
    assert voice_proxy._coerce_tts_voice(" Ethan ") == "Ethan"
    assert voice_proxy._coerce_tts_voice("") is None
    assert voice_proxy._coerce_tts_voice("   ") is None
    assert voice_proxy._coerce_tts_voice(None) is None


def test_int16_decoder_rejects_malformed_pcm_chunks(monkeypatch):
    """Streaming audio input should reject malformed PCM before sherpa sees it."""
    assert len(voice_proxy._int16_bytes_to_float32(b"\x00")) == 0

    monkeypatch.setattr(voice_proxy, "MAX_PCM_CHUNK_BYTES", 4)
    assert len(voice_proxy._int16_bytes_to_float32(b"\x00\x00\x00\x00\x00\x00")) == 0


def test_vad_segments_use_retained_input_audio_when_vad_samples_are_invalid(monkeypatch):
    """Completed VAD segments should not trust corrupt samples returned by VAD."""
    monkeypatch.setattr(voice_proxy, "MIN_ASR_SEGMENT_DURATION_SECONDS", 0.0)

    retained_samples = voice_proxy.np.asarray(
        [0.0, 0.1, -0.2, 0.25, -0.3],
        dtype=voice_proxy.np.float32,
    )
    corrupt_vad_samples = voice_proxy.np.full(
        len(retained_samples),
        66148.0,
        dtype=voice_proxy.np.float32,
    )

    class FakeVad:
        def __init__(self) -> None:
            self._segments = [
                SimpleNamespace(start=10, samples=corrupt_vad_samples),
            ]

        def empty(self) -> bool:
            return not self._segments

        @property
        def front(self):
            return self._segments[0]

        def pop(self) -> None:
            self._segments.pop(0)

    session = voice_proxy.StreamingVadSession.__new__(voice_proxy.StreamingVadSession)
    session.vad = FakeVad()
    session._history = retained_samples
    session._history_start_sample = 10
    session._total_samples_seen = 15

    segments = session._drain_completed_segments()

    assert len(segments) == 1
    assert segments[0].samples.tolist() == pytest.approx(retained_samples.tolist())


def test_speaker_enrollment_quality_accepts_clean_speech(monkeypatch):
    """Enrollment quality gate should accept loud non-clipped speech with VAD speech."""
    monkeypatch.setattr(voice_proxy, "_estimate_vad_speech_seconds", lambda _samples: 1.8)

    t = voice_proxy.np.linspace(0, 2.0, 32000, endpoint=False, dtype=voice_proxy.np.float32)
    samples = (0.08 * voice_proxy.np.sin(2 * voice_proxy.np.pi * 220 * t)).astype(
        voice_proxy.np.float32
    )

    quality = voice_proxy._evaluate_speaker_enrollment_quality(samples, 16000)

    assert quality.accepted
    assert quality.effective_speech_seconds == pytest.approx(1.8)
    assert quality.rms >= voice_proxy.SPEAKER_ENROLL_MIN_RMS
    assert quality.clipping_ratio == pytest.approx(0.0)


def test_speaker_enrollment_quality_rejects_silent_audio(monkeypatch):
    """Enrollment quality gate should reject recordings with no usable speech."""
    monkeypatch.setattr(voice_proxy, "_estimate_vad_speech_seconds", lambda _samples: 0.0)

    samples = voice_proxy.np.zeros(32000, dtype=voice_proxy.np.float32)

    quality = voice_proxy._evaluate_speaker_enrollment_quality(samples, 16000)

    assert not quality.accepted
    assert "Audio volume is too low." in quality.errors
    assert "Audio contains too much silence." in quality.errors
    assert "Voice activity detection found too little speech." in quality.errors


def test_speaker_enrollment_quality_rejects_clipped_audio(monkeypatch):
    """Enrollment quality gate should reject heavily clipped recordings."""
    monkeypatch.setattr(voice_proxy, "_estimate_vad_speech_seconds", lambda _samples: 1.8)

    samples = voice_proxy.np.full(32000, 1.0, dtype=voice_proxy.np.float32)

    quality = voice_proxy._evaluate_speaker_enrollment_quality(samples, 16000)

    assert not quality.accepted
    assert "Audio is clipped; move farther from the microphone." in quality.errors


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
