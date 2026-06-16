"""Tests for the voice proxy endpoints."""

import base64
import logging
from types import SimpleNamespace

import pytest

from src.api import voice_proxy


class _FakeVoiceprintQuery:
    def __init__(self, voiceprint):
        self.voiceprint = voiceprint

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.voiceprint


class _FakeVoiceprintDb:
    def __init__(self, embedding):
        self.voiceprint = SimpleNamespace(embedding=embedding)

    def query(self, _table):
        return _FakeVoiceprintQuery(self.voiceprint)


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


def test_ten_vad_model_uses_existing_model_path(tmp_path, monkeypatch):
    """VAD initialization should use the packaged ONNX model directly."""
    model_path = tmp_path / "ten-vad.onnx"
    data_path = tmp_path / "missing.data"
    model_path.write_bytes(b"onnx")

    monkeypatch.setattr(voice_proxy, "VAD_MODEL_PATH", model_path)
    monkeypatch.setattr(voice_proxy, "VAD_DATA_PATH", data_path)

    assert voice_proxy._ensure_ten_vad_model() == model_path


def test_ten_vad_model_error_names_model_and_override_paths(tmp_path, monkeypatch):
    """Missing VAD resources should produce an actionable deployment error."""
    model_path = tmp_path / "missing.onnx"
    data_path = tmp_path / "missing.data"

    monkeypatch.setattr(voice_proxy, "VAD_MODEL_PATH", model_path)
    monkeypatch.setattr(voice_proxy, "VAD_DATA_PATH", data_path)

    with pytest.raises(FileNotFoundError) as exc_info:
        voice_proxy._ensure_ten_vad_model()

    message = str(exc_info.value)
    assert str(model_path) in message
    assert str(data_path) in message
    assert "VOICE_TEN_VAD_MODEL_PATH" in message


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


def test_vad_segments_include_configured_pre_and_post_roll(monkeypatch):
    """Completed VAD segments should include nearby retained input audio."""
    monkeypatch.setattr(voice_proxy, "MIN_ASR_SEGMENT_DURATION_SECONDS", 0.0)
    monkeypatch.setattr(voice_proxy, "VAD_PRE_ROLL_SECONDS", 3 / voice_proxy.VAD_SAMPLE_RATE)
    monkeypatch.setattr(voice_proxy, "VAD_POST_ROLL_SECONDS", 2 / voice_proxy.VAD_SAMPLE_RATE)

    retained_samples = (voice_proxy.np.arange(20, dtype=voice_proxy.np.float32) / 100)
    vad_samples = retained_samples[10:14]

    class FakeVad:
        def __init__(self) -> None:
            self._segments = [
                SimpleNamespace(start=10, samples=vad_samples),
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
    session._history_start_sample = 0
    session._total_samples_seen = len(retained_samples)

    segments = session._drain_completed_segments()

    assert len(segments) == 1
    assert segments[0].samples.tolist() == pytest.approx(retained_samples[7:16].tolist())


def test_vad_segments_skip_empty_vad_segments_without_warning(caplog, monkeypatch):
    """Empty VAD segments are bookkeeping noise and should not warn as bad audio."""
    monkeypatch.setattr(voice_proxy, "MIN_ASR_SEGMENT_DURATION_SECONDS", 0.0)

    class FakeVad:
        def __init__(self) -> None:
            self._segments = [
                SimpleNamespace(
                    start=10,
                    samples=voice_proxy.np.asarray([], dtype=voice_proxy.np.float32),
                ),
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
    session._history = voice_proxy.np.zeros(5, dtype=voice_proxy.np.float32)
    session._history_start_sample = 10
    session._total_samples_seen = 15

    with caplog.at_level(logging.WARNING, logger=voice_proxy.logger.name):
        segments = session._drain_completed_segments()

    assert segments == []
    assert "VAD segment fell outside retained audio history" not in caplog.text
    assert "Dropped invalid VAD segment samples" not in caplog.text


@pytest.mark.anyio
async def test_speechbrain_embedding_uses_speaker_service(monkeypatch):
    """Main API should delegate embedding extraction to the speaker service."""
    calls = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        @staticmethod
        def json() -> dict[str, list[float]]:
            return {"embedding": [1.0, 0.0]}

    class FakeAsyncClient:
        def __init__(self, *, timeout):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url, *, json):
            calls.append((url, json, self.timeout))
            return FakeResponse()

    monkeypatch.setattr(voice_proxy.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(voice_proxy, "SPEAKER_SERVICE_URL", "http://speaker:8090")
    monkeypatch.setattr(voice_proxy, "SPEAKER_SERVICE_TIMEOUT_SECONDS", 12.0)

    embedding = await voice_proxy._compute_speechbrain_embedding(
        voice_proxy.np.ones(voice_proxy.VAD_SAMPLE_RATE, dtype=voice_proxy.np.float32),
        voice_proxy.VAD_SAMPLE_RATE,
        min_seconds=0.1,
    )

    assert embedding.tolist() == pytest.approx([1.0, 0.0])
    assert calls[0][0] == "http://speaker:8090/embed"
    assert calls[0][1]["sample_rate"] == voice_proxy.VAD_SAMPLE_RATE
    assert calls[0][2] == 12.0


@pytest.mark.anyio
async def test_profile_speaker_gate_uses_verification_min_seconds(monkeypatch):
    """Runtime speaker checks should not reuse the longer enrollment minimum."""
    calls = []

    async def fake_compute(samples, sample_rate, *, min_seconds, purpose):
        calls.append((len(samples), sample_rate, min_seconds, purpose))
        return voice_proxy.np.asarray([1.0, 0.0], dtype=voice_proxy.np.float32)

    monkeypatch.setattr(voice_proxy, "_compute_speechbrain_embedding", fake_compute)

    gate = voice_proxy.ProfileSpeakerGate(
        target_embedding=voice_proxy.np.asarray([1.0, 0.0], dtype=voice_proxy.np.float32)
    )

    accepted, score = await gate.verify(
        voice_proxy.np.zeros(
            int(voice_proxy.SPEAKER_VERIFY_MIN_SECONDS * voice_proxy.VAD_SAMPLE_RATE),
            dtype=voice_proxy.np.float32,
        )
    )

    assert accepted
    assert score == pytest.approx(1.0)
    assert calls == [
        (
            int(voice_proxy.SPEAKER_VERIFY_MIN_SECONDS * voice_proxy.VAD_SAMPLE_RATE),
            voice_proxy.VAD_SAMPLE_RATE,
            voice_proxy.SPEAKER_VERIFY_MIN_SECONDS,
            "speaker verification",
        )
    ]


@pytest.mark.anyio
async def test_asr_segments_report_speaker_service_failures_as_rejections():
    """Speaker service outages should not surface as fatal WebSocket errors."""
    messages = []

    class FakeWebSocket:
        async def send_json(self, payload):
            messages.append(payload)

    class UnavailableSpeakerGate:
        threshold = 0.72

        async def verify(self, _samples):
            raise RuntimeError("Speaker service is unavailable for speaker verification")

    segment = SimpleNamespace(
        wav_bytes=b"wav",
        samples=voice_proxy.np.zeros(
            int(voice_proxy.SPEAKER_VERIFY_MIN_SECONDS * voice_proxy.VAD_SAMPLE_RATE),
            dtype=voice_proxy.np.float32,
        ),
    )

    await voice_proxy._send_asr_segments(
        FakeWebSocket(),
        api_key="unused",
        model="unused",
        segments=[segment],
        profile_speaker_gate=UnavailableSpeakerGate(),
    )

    assert messages == [
        {
            "type": "speaker_rejected",
            "mode": voice_proxy.VOICE_MODE_ASR,
            "reason": "Speaker verification is temporarily unavailable",
            "threshold": 0.72,
        }
    ]


@pytest.mark.anyio
async def test_profile_speaker_verification_uses_shorter_verify_minimum(monkeypatch):
    """REST speaker verification should allow shorter samples than enrollment."""
    calls = []

    async def fake_embedding_from_data_uri(data_uri, *, min_seconds, purpose):
        calls.append((data_uri, min_seconds, purpose))
        return voice_proxy.np.asarray([1.0, 0.0], dtype=voice_proxy.np.float32)

    monkeypatch.setattr(
        voice_proxy,
        "_embedding_from_data_uri",
        fake_embedding_from_data_uri,
    )

    profile = voice_proxy.AgentProfileTable(
        id="agent-1",
        name="Agent",
        speaker_verification_enabled=True,
        user_voiceprint_id="vp-1",
        created_at="now",
        updated_at="now",
    )

    response = await voice_proxy._verify_profile_speaker(
        profile=profile,
        audio_data_uri="data:audio/wav;base64,test",
        db=_FakeVoiceprintDb([1.0, 0.0]),
    )

    assert response.accepted
    assert response.score == pytest.approx(1.0)
    assert calls == [
        (
            "data:audio/wav;base64,test",
            voice_proxy.SPEAKER_VERIFY_MIN_SECONDS,
            "speaker verification",
        )
    ]


def test_speaker_enrollment_quality_accepts_clean_speech():
    """Enrollment quality gate should accept loud non-clipped speech."""
    t = voice_proxy.np.linspace(0, 2.0, 32000, endpoint=False, dtype=voice_proxy.np.float32)
    samples = (0.08 * voice_proxy.np.sin(2 * voice_proxy.np.pi * 220 * t)).astype(
        voice_proxy.np.float32
    )

    quality = voice_proxy._evaluate_speaker_enrollment_quality(samples, 16000)

    assert quality.accepted
    assert quality.effective_speech_seconds == pytest.approx(2.0)
    assert quality.active_audio_ratio == pytest.approx(1.0)
    assert quality.rms >= voice_proxy.SPEAKER_ENROLL_MIN_RMS
    assert quality.clipping_ratio == pytest.approx(0.0)


def test_speaker_enrollment_quality_rejects_silent_audio():
    """Enrollment quality gate should reject recordings with no usable speech."""
    samples = voice_proxy.np.zeros(32000, dtype=voice_proxy.np.float32)

    quality = voice_proxy._evaluate_speaker_enrollment_quality(samples, 16000)

    assert not quality.accepted
    assert "Audio volume is too low." in quality.errors
    assert "Audio contains too much silence." in quality.errors
    assert "Recording contains too little active audio." in quality.errors


def test_speaker_enrollment_quality_rejects_clipped_audio():
    """Enrollment quality gate should reject heavily clipped recordings."""
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
        user_voiceprint_id=None,
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
        user_voiceprint_id=None,
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
