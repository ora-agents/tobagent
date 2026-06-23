"""Voice API endpoints for DashScope ASR/TTS integration.

REST endpoint:
- POST /api/asr/transcribe — Transcribe audio using qwen3-asr-flash
  (client-side VAD detects speech segments, sends complete utterances)

WebSocket endpoint:
- /ws/voice/tts — Streaming TTS proxy to DashScope Realtime API

Security:
- DASHSCOPE_API_KEY stays server-side (never reaches the browser).
"""

import asyncio
import base64
import io
import json
import logging
import os
import tempfile
import wave
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import dashscope  # type: ignore[import-untyped]
import httpx
import numpy as np
import websockets
from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from websockets.asyncio.client import ClientConnection

from src.api.kws_router import _create_keyword_stream, _process_audio_chunk
from src.utils.db import AgentProfileTable, SessionLocal, UserVoiceprintTable, get_db
from src.utils.voice_audio_logger import VoiceAudioLogger
from src.utils.voice_telemetry import flatten_attributes, record_voice_event

logger = logging.getLogger(__name__)

# Dedicated file handler for voice proxy diagnostics
_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_file_handler = logging.FileHandler(_LOG_DIR / "voice_proxy.log", encoding="utf-8")
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s %(levelname)s %(message)s")
)
logger.addHandler(_file_handler)


def _env_float(name: str, default: float) -> float:
    """Read a float environment variable with a safe fallback."""
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        logger.warning("Invalid float environment value: %s=%r", name, raw_value)
        return default


DASHSCOPE_WS_BASE = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
VAD_SAMPLE_RATE = 16000
VAD_THRESHOLD = _env_float("VOICE_VAD_THRESHOLD", 0.5)
VAD_MIN_SILENCE_DURATION = _env_float("VOICE_VAD_MIN_SILENCE_DURATION", 0.6)
VAD_MIN_SPEECH_DURATION = _env_float("VOICE_VAD_MIN_SPEECH_DURATION", 0.20)
VAD_MAX_SPEECH_DURATION = _env_float("VOICE_VAD_MAX_SPEECH_DURATION", 20.0)
VAD_WINDOW_SIZE = 256
VAD_HISTORY_SECONDS = VAD_MAX_SPEECH_DURATION + 10.0
VAD_PRE_ROLL_SECONDS = _env_float("VOICE_VAD_PRE_ROLL_SECONDS", 0.35)
VAD_POST_ROLL_SECONDS = _env_float("VOICE_VAD_POST_ROLL_SECONDS", 0.15)
MIN_ASR_SEGMENT_DURATION_SECONDS = _env_float("VOICE_MIN_ASR_SEGMENT_SECONDS", 0.3)
EPSILON = 1e-8
MAX_PCM_CHUNK_SECONDS = float(os.environ.get("VOICE_MAX_PCM_CHUNK_SECONDS", "5"))
MAX_PCM_CHUNK_BYTES = int(VAD_SAMPLE_RATE * 2 * MAX_PCM_CHUNK_SECONDS)
SPEAKER_PROFILE_THRESHOLD = float(
    os.environ.get("VOICE_SPEAKER_PROFILE_THRESHOLD", "0.72")
)
SPEAKER_PROFILE_SAMPLE_TEXT = os.environ.get(
    "VOICE_SPEAKER_PROFILE_SAMPLE_TEXT",
    "请用自然语速朗读：我是本智能体的授权使用者，正在完成声纹绑定。",
)
SPEAKER_PROFILE_MIN_SECONDS = float(
    os.environ.get("VOICE_SPEAKER_PROFILE_MIN_SECONDS", "1.5")
)
SPEAKER_VERIFY_MIN_SECONDS = float(
    os.environ.get("VOICE_SPEAKER_VERIFY_MIN_SECONDS", "0.5")
)
SPEAKER_ENROLL_MIN_EFFECTIVE_SPEECH_SECONDS = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MIN_EFFECTIVE_SPEECH_SECONDS", "1.2")
)
SPEAKER_ENROLL_MIN_RMS = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MIN_RMS", "0.012")
)
SPEAKER_ENROLL_MAX_RMS = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MAX_RMS", "0.35")
)
SPEAKER_ENROLL_MAX_CLIPPING_RATIO = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MAX_CLIPPING_RATIO", "0.01")
)
SPEAKER_ENROLL_MAX_SILENCE_RATIO = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MAX_SILENCE_RATIO", "0.65")
)
SPEAKER_ENROLL_MIN_ACTIVE_AUDIO_RATIO = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_MIN_ACTIVE_AUDIO_RATIO", "0.35")
)
SPEAKER_ENROLL_SILENCE_RMS = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_SILENCE_RMS", "0.006")
)
SPEAKER_ENROLL_FRAME_SECONDS = float(
    os.environ.get("VOICE_SPEAKER_ENROLL_FRAME_SECONDS", "0.1")
)
SPEAKER_SERVICE_URL = os.environ.get(
    "SPEAKER_SERVICE_URL",
    "http://speaker:8090",
).rstrip("/")
SPEAKER_SERVICE_TIMEOUT_SECONDS = _env_float("SPEAKER_SERVICE_TIMEOUT_SECONDS", 30.0)
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_VAD_DATA_PATH = (
    REPO_ROOT
    / "frontend"
    / "public"
    / "sherpa-onnx-wasm-simd-v1.13.2-ten-vad"
    / "sherpa-onnx-wasm-main-vad.data"
)
DEFAULT_VAD_MODEL_PATH = REPO_ROOT / "models" / "vad" / "ten-vad.onnx"
VAD_DATA_PATH = Path(os.environ.get("VOICE_TEN_VAD_DATA_PATH", DEFAULT_VAD_DATA_PATH))
VAD_MODEL_PATH = Path(os.environ.get("VOICE_TEN_VAD_MODEL_PATH", DEFAULT_VAD_MODEL_PATH))
TEN_VAD_DATA_START = 1076
TEN_VAD_DATA_END = 333287

voice_router = APIRouter(tags=["voice"])
_audio_logger = VoiceAudioLogger.from_env()

VOICE_MODE_KWS = "kws"
VOICE_MODE_ASR = "asr"
WAKE_ACK_TEXT = os.environ.get("WAKE_ACK_TEXT", "我在")
WAKE_ACK_PURPOSE = "wake_ack"


@dataclass(frozen=True)
class AsrAudioSegment:
    """VAD-completed audio segment for downstream ASR."""

    wav_bytes: bytes
    samples: np.ndarray
    duration_seconds: float


@dataclass(frozen=True)
class SpeakerEnrollmentQuality:
    """Quality metrics for a candidate voiceprint enrollment sample."""

    duration_seconds: float
    effective_speech_seconds: float
    rms: float
    clipping_ratio: float
    silence_ratio: float
    active_audio_ratio: float
    errors: tuple[str, ...] = ()

    @property
    def accepted(self) -> bool:
        """Return whether all enrollment quality gates passed."""
        return not self.errors


@dataclass(frozen=True)
class ProfileSpeakerGate:
    """Persisted voiceprint gate for a selected agent profile."""

    target_embedding: np.ndarray
    threshold: float = SPEAKER_PROFILE_THRESHOLD

    async def verify(self, samples: np.ndarray) -> tuple[bool, float | None]:
        """Return whether the segment matches the profile voiceprint."""
        embedding = await _compute_speechbrain_embedding(
            samples,
            VAD_SAMPLE_RATE,
            min_seconds=SPEAKER_VERIFY_MIN_SECONDS,
            purpose="speaker verification",
        )
        score = _cosine_similarity(self.target_embedding, embedding)
        return score >= self.threshold, score


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_tts_voice(value: Any) -> str | None:
    """Return a non-empty TTS voice id from a client config value."""
    if not isinstance(value, str):
        return None
    voice = value.strip()
    return voice or None


def _get_dashscope_key() -> str:
    """Retrieve DASHSCOPE_API_KEY from environment."""
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "DASHSCOPE_API_KEY is not set. "
            "Voice proxy requires this environment variable."
        )
    return key


def _ensure_ten_vad_model() -> Path:
    """Extract the bundled Ten VAD ONNX model for server-side use."""
    if VAD_MODEL_PATH.exists():
        return VAD_MODEL_PATH

    if not VAD_DATA_PATH.exists():
        raise FileNotFoundError(
            "Ten VAD model not found. Expected model at "
            f"{VAD_MODEL_PATH}, or bundled data package at {VAD_DATA_PATH}. "
            "For Docker deployments, make sure models/vad/ten-vad.onnx is copied "
            "into the backend image or set VOICE_TEN_VAD_MODEL_PATH."
        )

    data = VAD_DATA_PATH.read_bytes()
    if len(data) < TEN_VAD_DATA_END:
        raise RuntimeError("Ten VAD data package is shorter than expected")

    VAD_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    VAD_MODEL_PATH.write_bytes(data[TEN_VAD_DATA_START:TEN_VAD_DATA_END])
    return VAD_MODEL_PATH


def _float32_to_wav_bytes(samples: np.ndarray, sample_rate: int = VAD_SAMPLE_RATE) -> bytes:
    """Encode float32 audio samples as mono 16-bit PCM WAV bytes."""
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = np.where(clipped < 0, clipped * 32768, clipped * 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _int16_bytes_to_float32(audio_bytes: bytes) -> np.ndarray:
    """Decode little-endian Int16 PCM bytes into float32 samples."""
    if len(audio_bytes) % 2 != 0:
        logger.warning("Dropped malformed PCM chunk with odd byte length: %d", len(audio_bytes))
        return np.asarray([], dtype=np.float32)
    if len(audio_bytes) > MAX_PCM_CHUNK_BYTES:
        logger.warning(
            "Dropped oversized PCM chunk: bytes=%d max_bytes=%d",
            len(audio_bytes),
            MAX_PCM_CHUNK_BYTES,
        )
        return np.asarray([], dtype=np.float32)

    samples_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    if len(samples_int16) == 0:
        return np.asarray([], dtype=np.float32)
    return samples_int16.astype(np.float32) / 32768.0


def _is_valid_float_audio(samples: np.ndarray) -> bool:
    """Return whether samples look like normalized mono PCM."""
    if len(samples) == 0:
        return False
    if not np.all(np.isfinite(samples)):
        return False
    peak = float(np.max(np.abs(samples)))
    return peak <= 1.5


class StreamingVadSession:
    """Run sherpa-onnx VAD for one browser audio stream."""

    def __init__(self) -> None:
        """Initialize the sherpa-onnx Ten VAD detector."""
        import sherpa_onnx

        model_path = _ensure_ten_vad_model()
        config = sherpa_onnx.VadModelConfig(
            ten_vad=sherpa_onnx.TenVadModelConfig(
                model=str(model_path),
                threshold=VAD_THRESHOLD,
                min_silence_duration=VAD_MIN_SILENCE_DURATION,
                min_speech_duration=VAD_MIN_SPEECH_DURATION,
                window_size=VAD_WINDOW_SIZE,
                max_speech_duration=VAD_MAX_SPEECH_DURATION,
            ),
            sample_rate=VAD_SAMPLE_RATE,
            num_threads=1,
            provider="cpu",
            debug=False,
        )
        self.vad = sherpa_onnx.VoiceActivityDetector(config, 30)
        self.was_speech_detected = False
        self._history = np.asarray([], dtype=np.float32)
        self._history_start_sample = 0
        self._total_samples_seen = 0

    def accept_audio(self, audio_bytes: bytes) -> tuple[bool, list[AsrAudioSegment]]:
        """Accept Int16 PCM bytes and return speech-start plus ASR segments."""
        samples_float32 = _int16_bytes_to_float32(audio_bytes)
        if len(samples_float32) == 0:
            return False, []

        self._append_history(samples_float32)
        self.vad.accept_waveform(samples_float32)

        is_speech_detected = self.vad.is_speech_detected()
        speech_started = is_speech_detected and not self.was_speech_detected
        speech_segments = self._drain_completed_segments()
        self.was_speech_detected = is_speech_detected
        return speech_started, speech_segments

    def _append_history(self, samples: np.ndarray) -> None:
        """Keep recent normalized input audio for reconstructing VAD segments."""
        self._history = np.concatenate((self._history, samples.astype(np.float32)))
        self._total_samples_seen += len(samples)

        max_history_samples = int(VAD_HISTORY_SECONDS * VAD_SAMPLE_RATE)
        if len(self._history) <= max_history_samples:
            return

        trim_count = len(self._history) - max_history_samples
        self._history = self._history[trim_count:]
        self._history_start_sample += trim_count

    def _segment_samples_from_history(
        self,
        *,
        start_sample: int,
        sample_count: int,
        pre_roll_samples: int = 0,
        post_roll_samples: int = 0,
    ) -> np.ndarray | None:
        """Return original input samples for a completed VAD segment if retained."""
        if sample_count <= 0:
            return None

        history_end_sample = self._history_start_sample + len(self._history)
        segment_end_sample = start_sample + sample_count
        if segment_end_sample <= self._history_start_sample:
            return None
        if start_sample >= history_end_sample:
            return None

        padded_start_sample = max(
            self._history_start_sample,
            start_sample - max(0, pre_roll_samples),
        )
        padded_end_sample = min(
            history_end_sample,
            segment_end_sample + max(0, post_roll_samples),
        )

        start_index = padded_start_sample - self._history_start_sample
        end_index = padded_end_sample - self._history_start_sample
        if start_index < 0 or end_index > len(self._history) or start_index >= end_index:
            return None

        return self._history[start_index:end_index].copy()

    def _drain_completed_segments(self) -> list[AsrAudioSegment]:
        """Drain completed VAD segments and encode accepted ASR payloads."""
        segments: list[AsrAudioSegment] = []

        while not self.vad.empty():
            segment = self.vad.front
            self.vad.pop()

            vad_samples = np.asarray(segment.samples, dtype=np.float32)
            if len(vad_samples) == 0:
                logger.debug(
                    "Skipped empty VAD segment: start=%d history_start=%d "
                    "history_count=%d total_seen=%d",
                    int(segment.start),
                    self._history_start_sample,
                    len(self._history),
                    self._total_samples_seen,
                )
                continue

            speech_duration_seconds = len(vad_samples) / VAD_SAMPLE_RATE
            if speech_duration_seconds < MIN_ASR_SEGMENT_DURATION_SECONDS:
                continue

            samples = self._segment_samples_from_history(
                start_sample=int(segment.start),
                sample_count=len(vad_samples),
                pre_roll_samples=int(VAD_PRE_ROLL_SECONDS * VAD_SAMPLE_RATE),
                post_roll_samples=int(VAD_POST_ROLL_SECONDS * VAD_SAMPLE_RATE),
            )
            if samples is None:
                logger.warning(
                    "VAD segment fell outside retained audio history: "
                    "start=%d count=%d history_start=%d history_count=%d total_seen=%d",
                    int(segment.start),
                    len(vad_samples),
                    self._history_start_sample,
                    len(self._history),
                    self._total_samples_seen,
                )
                samples = vad_samples

            if not _is_valid_float_audio(samples):
                finite_samples = samples[np.isfinite(samples)]
                peak = float(np.max(np.abs(finite_samples))) if len(finite_samples) else 0.0
                logger.warning(
                    "Dropped invalid VAD segment samples: count=%d finite=%s peak=%s",
                    len(samples),
                    bool(np.all(np.isfinite(samples))) if len(samples) else False,
                    peak,
                )
                continue

            duration_seconds = len(samples) / VAD_SAMPLE_RATE
            segments.append(
                AsrAudioSegment(
                    wav_bytes=_float32_to_wav_bytes(samples),
                    samples=samples,
                    duration_seconds=duration_seconds,
                )
            )

        return segments


def _cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    """Compute cosine similarity for two embedding vectors."""
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= EPSILON:
        return 0.0
    return float(np.dot(left, right) / denominator)


# ---------------------------------------------------------------------------
# REST ASR endpoint
# ---------------------------------------------------------------------------


class AsrTranscribeRequest(BaseModel):
    """Audio data URI for transcription.

    Expected format: ``data:audio/wav;base64,<base64_encoded_wav>``
    """

    audio: str = Field(
        description="Base64 audio data URI, for example `data:audio/wav;base64,<payload>`.",
        examples=["data:audio/wav;base64,UklGRiQAAABXQVZF..."],
    )


class AsrTranscribeResponse(BaseModel):
    """Transcription result."""

    text: str = Field(description="Recognized transcript text.")
    language: str | None = Field(default=None, description="Detected language code when available.")
    duration_seconds: float | None = Field(default=None, description="Audio duration in seconds when available.")


class SpeakerVerificationRequest(BaseModel):
    """Verify a speech segment against an agent profile voiceprint."""

    audio: str = Field(
        description="Base64 speech sample data URI, for example `data:audio/wav;base64,<payload>`.",
        examples=["data:audio/wav;base64,UklGRiQAAABXQVZF..."],
    )
    agentId: str = Field(description="Agent profile id whose bound voiceprint should be used.")


class SpeakerVerificationResponse(BaseModel):
    """Speaker verification result."""

    accepted: bool = Field(description="Whether the sample passed speaker verification.")
    enabled: bool = Field(description="Whether the selected agent has speaker verification enabled.")
    bound: bool = Field(description="Whether the selected agent has a user voiceprint bound.")
    score: float | None = Field(default=None, description="Cosine similarity score when verification ran.")
    threshold: float = Field(default=SPEAKER_PROFILE_THRESHOLD, description="Minimum score required for acceptance.")


class UserVoiceprintCreateRequest(BaseModel):
    """Create a user-level voiceprint from an audio sample."""

    name: str = Field(default="My Voiceprint", description="Human-readable voiceprint name.")
    audio: str = Field(
        description="Base64 enrollment audio data URI, for example `data:audio/wav;base64,<payload>`.",
        examples=["data:audio/wav;base64,UklGRiQAAABXQVZF..."],
    )
    sampleText: str | None = Field(default=None, description="Text the user read while enrolling.")


class UserVoiceprintResponse(BaseModel):
    """User-level voiceprint metadata (no embedding exposed)."""

    id: str = Field(description="Voiceprint id.")
    name: str = Field(description="Human-readable voiceprint name.")
    sampleText: str | None = Field(default=None, description="Enrollment sample text.")
    enrolledAt: str | None = Field(default=None, description="Enrollment timestamp in ISO format.")
    createdAt: str = Field(description="Creation timestamp in ISO format.")


class VoiceTelemetryEventRequest(BaseModel):
    """Client-side voice latency event for OpenTelemetry export."""

    event: str = Field(description="Short event name, appended to the `voice.client.` span name.")
    voiceSessionId: str | None = Field(default=None, description="Client-generated voice session id.")
    traceparent: str | None = Field(default=None, description="W3C traceparent header value for trace correlation.")
    timestampMs: float | None = Field(default=None, description="Client event timestamp in milliseconds.")
    payload: dict[str, Any] = Field(default_factory=dict, description="Additional telemetry attributes.")


def _extract_bearer_user_id(authorization: str | None) -> str:
    """Extract the bearer user id used by the app's lightweight auth."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")
    user_id = authorization.strip()
    if user_id.lower().startswith("bearer "):
        user_id = user_id.split(" ", 1)[1].strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


def _require_agent_profile(
    db: Session,
    *,
    agent_id: str,
    user_id: str,
) -> AgentProfileTable:
    """Return an agent profile owned by the current user."""
    profile = db.query(AgentProfileTable).filter(
        AgentProfileTable.id == agent_id,
        AgentProfileTable.owner_user_id == user_id,
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Agent profile not found")
    return profile


def _decode_wav_data_uri_to_float32(data_uri: str) -> tuple[np.ndarray, int]:
    """Decode a mono/stereo PCM WAV data URI into mono float32 samples."""
    if not data_uri.startswith("data:audio/"):
        raise ValueError("Expected data:audio/...;base64,...")

    audio_bytes = _decode_data_uri(data_uri)
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise ValueError("Only 16-bit PCM WAV audio is supported")

    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples.astype(np.float32), sample_rate


def _resample_mono_float32(
    samples: np.ndarray,
    source_rate: int,
    target_rate: int = VAD_SAMPLE_RATE,
) -> np.ndarray:
    """Resample mono float32 audio with linear interpolation."""
    if source_rate == target_rate or len(samples) == 0:
        return samples.astype(np.float32)

    duration = len(samples) / source_rate
    target_length = max(1, int(round(duration * target_rate)))
    source_positions = np.linspace(0.0, duration, num=len(samples), endpoint=False)
    target_positions = np.linspace(0.0, duration, num=target_length, endpoint=False)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


def _audio_rms(samples: np.ndarray) -> float:
    """Return root-mean-square amplitude for normalized PCM samples."""
    if len(samples) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples)) + EPSILON))


def _frame_rms_values(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Return RMS values for fixed-size enrollment quality frames."""
    frame_size = max(1, int(round(SPEAKER_ENROLL_FRAME_SECONDS * sample_rate)))
    if len(samples) == 0:
        return np.asarray([], dtype=np.float32)

    values: list[float] = []
    for start in range(0, len(samples), frame_size):
        frame = samples[start:start + frame_size]
        if len(frame) > 0:
            values.append(_audio_rms(frame))
    return np.asarray(values, dtype=np.float32)


def _evaluate_speaker_enrollment_quality(
    samples: np.ndarray,
    sample_rate: int,
) -> SpeakerEnrollmentQuality:
    """Return quality metrics and rejection reasons for voiceprint binding."""
    normalized = _resample_mono_float32(samples, sample_rate, VAD_SAMPLE_RATE)
    duration_seconds = len(normalized) / VAD_SAMPLE_RATE
    if len(normalized) == 0 or not np.all(np.isfinite(normalized)):
        return SpeakerEnrollmentQuality(
            duration_seconds=duration_seconds,
            effective_speech_seconds=0.0,
            rms=0.0,
            clipping_ratio=0.0,
            silence_ratio=1.0,
            active_audio_ratio=0.0,
            errors=("Audio is empty or contains invalid samples.",),
        )

    rms = _audio_rms(normalized)
    clipping_ratio = float(np.mean(np.abs(normalized) >= 0.98))
    frame_rms = _frame_rms_values(normalized, VAD_SAMPLE_RATE)
    silence_ratio = (
        float(np.mean(frame_rms < SPEAKER_ENROLL_SILENCE_RMS))
        if len(frame_rms)
        else 1.0
    )
    active_audio_ratio = 1.0 - silence_ratio
    effective_speech_seconds = duration_seconds * active_audio_ratio

    errors: list[str] = []
    if duration_seconds < SPEAKER_PROFILE_MIN_SECONDS:
        errors.append(
            f"Audio is too short; need at least {SPEAKER_PROFILE_MIN_SECONDS:.1f}s."
        )
    if effective_speech_seconds < SPEAKER_ENROLL_MIN_EFFECTIVE_SPEECH_SECONDS:
        errors.append(
            "Effective speech is too short; "
            f"need at least {SPEAKER_ENROLL_MIN_EFFECTIVE_SPEECH_SECONDS:.1f}s."
        )
    if rms < SPEAKER_ENROLL_MIN_RMS:
        errors.append("Audio volume is too low.")
    if rms > SPEAKER_ENROLL_MAX_RMS:
        errors.append("Audio volume is too high.")
    if clipping_ratio > SPEAKER_ENROLL_MAX_CLIPPING_RATIO:
        errors.append("Audio is clipped; move farther from the microphone.")
    if silence_ratio > SPEAKER_ENROLL_MAX_SILENCE_RATIO:
        errors.append("Audio contains too much silence.")
    if active_audio_ratio < SPEAKER_ENROLL_MIN_ACTIVE_AUDIO_RATIO:
        errors.append("Recording contains too little active audio.")

    return SpeakerEnrollmentQuality(
        duration_seconds=duration_seconds,
        effective_speech_seconds=effective_speech_seconds,
        rms=rms,
        clipping_ratio=clipping_ratio,
        silence_ratio=silence_ratio,
        active_audio_ratio=active_audio_ratio,
        errors=tuple(errors),
    )


def _format_enrollment_quality_error(quality: SpeakerEnrollmentQuality) -> str:
    """Build a compact API error for failed voiceprint enrollment quality."""
    metrics = (
        f"duration={quality.duration_seconds:.2f}s, "
        f"speech={quality.effective_speech_seconds:.2f}s, "
        f"rms={quality.rms:.4f}, "
        f"clipping={quality.clipping_ratio:.2%}, "
        f"silence={quality.silence_ratio:.2%}, "
        f"active={quality.active_audio_ratio:.2%}"
    )
    return "Voiceprint enrollment audio quality is too low: " + (
        "; ".join(quality.errors) + f" ({metrics})"
    )


async def _compute_speechbrain_embedding(
    samples: np.ndarray,
    sample_rate: int,
    *,
    min_seconds: float = SPEAKER_PROFILE_MIN_SECONDS,
    purpose: str = "speaker binding",
) -> np.ndarray:
    """Compute an ECAPA-TDNN speaker embedding through the speaker service."""
    duration_seconds = len(samples) / max(sample_rate, 1)
    if duration_seconds < min_seconds:
        raise ValueError(
            f"Audio is too short for {purpose}; need at least {min_seconds:.1f}s"
        )

    samples = _resample_mono_float32(samples, sample_rate, VAD_SAMPLE_RATE)
    if len(samples) == 0 or not np.all(np.isfinite(samples)):
        raise ValueError(f"Audio is empty or invalid for {purpose}")

    payload = {
        "samples": base64.b64encode(samples.astype(np.float32).tobytes()).decode("ascii"),
        "sample_rate": VAD_SAMPLE_RATE,
    }
    try:
        async with httpx.AsyncClient(timeout=SPEAKER_SERVICE_TIMEOUT_SECONDS) as client:
            response = await client.post(f"{SPEAKER_SERVICE_URL}/embed", json=payload)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        raise RuntimeError(f"Speaker service rejected {purpose}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(
            f"Speaker service is unavailable for {purpose}: {exc}"
        ) from exc

    data = response.json()
    embedding = np.asarray(data.get("embedding"), dtype=np.float32)
    if len(embedding) == 0 or not np.all(np.isfinite(embedding)):
        raise RuntimeError("Speaker service returned an invalid embedding")
    return embedding


async def _embedding_from_data_uri(
    data_uri: str,
    *,
    min_seconds: float = SPEAKER_PROFILE_MIN_SECONDS,
    purpose: str = "speaker binding",
) -> np.ndarray:
    """Decode a WAV data URI and compute a SpeechBrain speaker embedding."""
    samples, sample_rate = _decode_wav_data_uri_to_float32(data_uri)
    return await _compute_speechbrain_embedding(
        samples,
        sample_rate,
        min_seconds=min_seconds,
        purpose=purpose,
    )


async def _enrollment_embedding_from_data_uri(
    data_uri: str,
) -> tuple[np.ndarray, SpeakerEnrollmentQuality]:
    """Decode enrollment audio, enforce quality gates, and compute embedding."""
    samples, sample_rate = _decode_wav_data_uri_to_float32(data_uri)
    quality = _evaluate_speaker_enrollment_quality(samples, sample_rate)
    if not quality.accepted:
        raise ValueError(_format_enrollment_quality_error(quality))
    embedding = await _compute_speechbrain_embedding(
        samples,
        sample_rate,
        min_seconds=SPEAKER_PROFILE_MIN_SECONDS,
        purpose="speaker binding",
    )
    return embedding, quality


def _profile_embedding(
    profile: AgentProfileTable,
    db: Session | None = None,
) -> np.ndarray | None:
    """Return the user-level voiceprint embedding referenced by a profile."""
    vp_id = getattr(profile, "user_voiceprint_id", None)
    if vp_id and db is not None:
        vp = (
            db.query(UserVoiceprintTable)
            .filter(UserVoiceprintTable.id == vp_id)
            .first()
        )
        if vp and isinstance(vp.embedding, list) and vp.embedding:
            return np.asarray(vp.embedding, dtype=np.float32)

    return None


async def _verify_profile_speaker(
    *,
    profile: AgentProfileTable,
    audio_data_uri: str,
    db: Session | None = None,
) -> SpeakerVerificationResponse:
    """Verify a data URI against a profile voiceprint."""
    enabled = bool(profile.speaker_verification_enabled)
    target_embedding = _profile_embedding(profile, db=db)
    if not enabled:
        return SpeakerVerificationResponse(
            accepted=True,
            enabled=False,
            bound=target_embedding is not None,
        )
    if target_embedding is None:
        return SpeakerVerificationResponse(
            accepted=False,
            enabled=True,
            bound=False,
        )

    probe_embedding = await _embedding_from_data_uri(
        audio_data_uri,
        min_seconds=SPEAKER_VERIFY_MIN_SECONDS,
        purpose="speaker verification",
    )
    score = _cosine_similarity(target_embedding, probe_embedding)
    return SpeakerVerificationResponse(
        accepted=score >= SPEAKER_PROFILE_THRESHOLD,
        enabled=True,
        bound=True,
        score=score,
    )


def _load_profile_speaker_gate(agent_id: str, user_id: str) -> ProfileSpeakerGate | None:
    """Load a persisted speaker gate for a WebSocket voice session."""
    db = SessionLocal()
    try:
        profile = db.query(AgentProfileTable).filter(
            AgentProfileTable.id == agent_id,
            AgentProfileTable.owner_user_id == user_id,
        ).first()
        if not profile or not profile.speaker_verification_enabled:
            return None

        embedding = _profile_embedding(profile, db=db)
        if embedding is None:
            raise ValueError("Speaker verification is enabled but no voiceprint is bound")
        return ProfileSpeakerGate(target_embedding=embedding)
    finally:
        db.close()


def _decode_data_uri(data_uri: str) -> bytes:
    """Extract raw bytes from a ``data:`` URI.

    Supports ``data:<mime>;base64,<payload>`` format.
    """
    if not data_uri.startswith("data:"):
        raise ValueError("Not a valid data URI")
    header, _, payload = data_uri.partition(",")
    if not payload:
        raise ValueError("Missing payload in data URI")
    return base64.b64decode(payload)


def _call_dashscope_asr(
    *,
    api_key: str,
    model: str,
    audio_bytes: bytes,
) -> Any:
    """Run the blocking DashScope ASR request from a worker thread."""
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".wav", delete=False, dir=tempfile.gettempdir()
        ) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        return dashscope.MultiModalConversation.call(
            api_key=api_key,
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [{"audio": f"file://{tmp_path}"}],
                }
            ],
            result_format="message",
            asr_options={"enable_lid": True, "enable_itn": False},
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@voice_router.post(
    "/api/asr/transcribe",
    response_model=AsrTranscribeResponse,
    summary="Transcribe an audio sample",
    description=(
        "Transcribes a base64 audio data URI using the configured DashScope ASR model. "
        "Expected input is `data:audio/...;base64,<payload>`."
    ),
)
async def asr_transcribe(request: AsrTranscribeRequest) -> AsrTranscribeResponse:
    """Transcribe a speech segment using DashScope ``qwen3-asr-flash``.

    Accepts a base64-encoded WAV audio data URI, writes it to a temporary
    file, and calls ``dashscope.MultiModalConversation.call()``.
    """
    try:
        api_key = _get_dashscope_key()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not request.audio.startswith("data:audio/"):
        raise HTTPException(
            status_code=400,
            detail="Invalid audio data URI format. Expected data:audio/...;base64,...",
        )

    model = os.environ.get("ASR_MODEL", "qwen3-asr-flash")

    # Decode and write to a temporary WAV file for the SDK
    try:
        audio_bytes = _decode_data_uri(request.audio)
    except (ValueError, Exception) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to decode audio data URI: {exc}",
        ) from exc

    try:
        response: Any = await asyncio.to_thread(
            _call_dashscope_asr,
            api_key=api_key,
            model=model,
            audio_bytes=audio_bytes,
        )

        # Parse response
        return _parse_asr_response(response)

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ASR transcription failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"ASR transcription failed: {exc}",
        ) from exc


@voice_router.post(
    "/api/voice/telemetry",
    summary="Record a voice telemetry event",
    description="Records one browser or native voice latency event as an OpenTelemetry span.",
)
async def record_voice_telemetry_event(
    request: VoiceTelemetryEventRequest,
) -> dict[str, bool]:
    """Record one client/native voice latency event as an OpenTelemetry span."""
    event = request.event.strip()
    if not event:
        raise HTTPException(status_code=400, detail="event is required")

    payload = request.payload if isinstance(request.payload, dict) else {}
    recorded = record_voice_event(
        name=f"voice.client.{event}",
        voice_session_id=request.voiceSessionId,
        traceparent=request.traceparent,
        timestamp_ms=request.timestampMs,
        attributes={
            "voice.event": event,
            "voice.source": "client",
            **flatten_attributes("voice.payload", payload),
        },
    )
    return {"recorded": recorded}


@voice_router.get(
    "/api/speaker-profiles/sample-text",
    summary="Get voiceprint enrollment sample text",
    description="Returns the sentence users should read when enrolling a voiceprint.",
)
async def get_speaker_profile_sample_text() -> dict[str, str]:
    """Return the sentence users should read for voiceprint enrollment."""
    return {"sampleText": SPEAKER_PROFILE_SAMPLE_TEXT}


# ---------------------------------------------------------------------------
# User-level voiceprint CRUD
# ---------------------------------------------------------------------------
# Voiceprints stored per-user (not per-agent). Agents reference them by ID.


def _voiceprint_to_response(vp: UserVoiceprintTable) -> UserVoiceprintResponse:
    return UserVoiceprintResponse(
        id=vp.id,
        name=vp.name,
        sampleText=vp.sample_text,
        enrolledAt=vp.enrolled_at,
        createdAt=vp.created_at,
    )


@voice_router.get(
    "/api/user-voiceprints",
    response_model=list[UserVoiceprintResponse],
    summary="List user voiceprints",
    description="Lists voiceprint metadata for the authenticated user. Speaker embeddings are never returned.",
)
async def list_user_voiceprints(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[UserVoiceprintResponse]:
    """List all voiceprints for the current user."""
    user_id = _extract_bearer_user_id(authorization)
    voiceprints = (
        db.query(UserVoiceprintTable)
        .filter(UserVoiceprintTable.owner_user_id == user_id)
        .order_by(UserVoiceprintTable.created_at.desc())
        .all()
    )
    return [_voiceprint_to_response(vp) for vp in voiceprints]


@voice_router.post(
    "/api/user-voiceprints",
    response_model=UserVoiceprintResponse,
    summary="Enroll a user voiceprint",
    description=(
        "Creates a user-level speaker voiceprint from an audio data URI after audio quality checks. "
        "The returned response contains metadata only, not the embedding."
    ),
)
async def create_user_voiceprint(
    request: UserVoiceprintCreateRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> UserVoiceprintResponse:
    """Enroll a new user-level voiceprint from an audio sample."""
    import uuid

    user_id = _extract_bearer_user_id(authorization)

    try:
        embedding, quality = await _enrollment_embedding_from_data_uri(request.audio)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("User voiceprint enrollment failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Voiceprint enrollment failed: {exc}",
        ) from exc

    now = datetime.utcnow().isoformat()
    sample_text = (request.sampleText or SPEAKER_PROFILE_SAMPLE_TEXT).strip()
    voiceprint_id = str(uuid.uuid4())

    vp = UserVoiceprintTable(
        id=voiceprint_id,
        owner_user_id=user_id,
        name=request.name.strip() or "My Voiceprint",
        embedding=embedding.astype(float).tolist(),
        sample_text=sample_text,
        enrolled_at=now,
        created_at=now,
    )
    db.add(vp)
    db.commit()
    db.refresh(vp)

    logger.info(
        "User voiceprint enrolled: id=%s user_id=%s duration=%.2fs speech=%.2fs rms=%.4f",
        voiceprint_id,
        user_id,
        quality.duration_seconds,
        quality.effective_speech_seconds,
        quality.rms,
    )
    return _voiceprint_to_response(vp)


@voice_router.delete(
    "/api/user-voiceprints/{voiceprint_id}",
    summary="Delete a user voiceprint",
    description="Deletes one voiceprint owned by the authenticated user and clears agent profile bindings to it.",
)
async def delete_user_voiceprint(
    voiceprint_id: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """Delete a user-level voiceprint."""
    user_id = _extract_bearer_user_id(authorization)
    vp = (
        db.query(UserVoiceprintTable)
        .filter(
            UserVoiceprintTable.id == voiceprint_id,
            UserVoiceprintTable.owner_user_id == user_id,
        )
        .first()
    )
    if not vp:
        raise HTTPException(status_code=404, detail="Voiceprint not found")

    # Also clear any agent profiles that referenced this voiceprint
    db.query(AgentProfileTable).filter(
        AgentProfileTable.owner_user_id == user_id,
        AgentProfileTable.user_voiceprint_id == voiceprint_id,
    ).update({AgentProfileTable.user_voiceprint_id: None})

    db.delete(vp)
    db.commit()
    return {"deleted": True}


@voice_router.post(
    "/api/speaker-profiles/verify",
    response_model=SpeakerVerificationResponse,
    summary="Verify an agent speaker",
    description=(
        "Verifies an audio sample against the voiceprint bound to the selected agent profile. "
        "Returns whether verification is enabled, whether a voiceprint is bound, the score, and threshold."
    ),
)
async def verify_agent_speaker(
    request: SpeakerVerificationRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> SpeakerVerificationResponse:
    """Verify a speech sample against the selected agent's voiceprint."""
    user_id = _extract_bearer_user_id(authorization)
    profile = _require_agent_profile(db, agent_id=request.agentId, user_id=user_id)

    try:
        return await _verify_profile_speaker(profile=profile, audio_data_uri=request.audio, db=db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Speaker verification failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Speaker verification failed: {exc}",
        ) from exc


def _parse_asr_response(response: Any) -> AsrTranscribeResponse:
    """Parse the DashScope MultiModalConversation response into our model."""
    # The SDK returns a dict-like object
    if hasattr(response, "status_code") and response.status_code != 200:
        error_msg = getattr(response, "message", "Unknown error")
        raise HTTPException(
            status_code=502,
            detail=f"DashScope ASR error ({response.status_code}): {error_msg}",
        )

    try:
        # Response structure: output.choices[0].message.content[0].text
        if hasattr(response, "output"):
            output = response.output
        elif isinstance(response, dict):
            output = response.get("output", {})
        else:
            raise RuntimeError(f"Unexpected response type: {type(response)}")

        choices = output.get("choices", []) if isinstance(output, dict) else getattr(output, "choices", [])
        if not choices:
            raise RuntimeError("No choices in ASR response")

        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else getattr(choices[0], "message", {})
        content = message.get("content", []) if isinstance(message, dict) else getattr(message, "content", [])

        text = ""
        if content:
            first_content = content[0] if isinstance(content, list) else content
            text = first_content.get("text", "") if isinstance(first_content, dict) else getattr(first_content, "text", "")

        # Extract language from annotations if present
        language: str | None = None
        annotations = (
            message.get("annotations", [])
            if isinstance(message, dict)
            else getattr(message, "annotations", [])
        )
        if annotations:
            ann = annotations[0] if isinstance(annotations, list) else annotations
            language = ann.get("language") if isinstance(ann, dict) else getattr(ann, "language", None)

        # Extract duration from usage if present
        duration: float | None = None
        usage = response.get("usage", {}) if isinstance(response, dict) else getattr(response, "usage", {})
        if isinstance(usage, dict):
            seconds = usage.get("seconds")
            if seconds is not None:
                duration = float(seconds)
        elif hasattr(usage, "seconds"):
            duration = float(usage.seconds)

        return AsrTranscribeResponse(
            text=text.strip(),
            language=language,
            duration_seconds=duration,
        )
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        logger.error("Failed to parse ASR response: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Unexpected ASR response format: {exc}",
        ) from exc


# ---------------------------------------------------------------------------
# WebSocket ASR with server-side VAD
# ---------------------------------------------------------------------------


@voice_router.websocket(
    "/ws/voice/asr",
    name="Voice ASR stream",
)
async def asr_stream(websocket: WebSocket) -> None:
    """Stream microphone PCM to backend VAD and return ASR transcripts."""
    await websocket.accept()

    audio_log_session_id = _audio_logger.new_session()

    try:
        api_key = _get_dashscope_key()
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011, reason="ASR is not configured")
        _audio_logger.end_session(audio_log_session_id)
        return

    try:
        vad_session = await asyncio.to_thread(StreamingVadSession)
    except Exception as exc:
        logger.error("Failed to initialize streaming VAD: %s", exc)
        await websocket.send_json({
            "type": "error",
            "message": f"Failed to initialize voice activity detection: {exc}",
        })
        await websocket.close(code=1011, reason="VAD initialization failed")
        _audio_logger.end_session(audio_log_session_id)
        return

    model = os.environ.get("ASR_MODEL", "qwen3-asr-flash")
    await websocket.send_json({"type": "ready"})

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect

            audio_bytes = message.get("bytes")
            if audio_bytes is None:
                continue

            _audio_logger.log_raw_pcm(audio_log_session_id, audio_bytes)

            speech_started, segments = vad_session.accept_audio(audio_bytes)
            if speech_started:
                await websocket.send_json({"type": "speech_start"})

            for segment in segments:
                _audio_logger.log_vad_segment(
                    audio_log_session_id, segment.wav_bytes,
                )
                await websocket.send_json({"type": "transcribing"})
                try:
                    response: Any = await asyncio.to_thread(
                        _call_dashscope_asr,
                        api_key=api_key,
                        model=model,
                        audio_bytes=segment.wav_bytes,
                    )
                    result = _parse_asr_response(response)
                except HTTPException as exc:
                    await websocket.send_json({
                        "type": "error",
                        "message": str(exc.detail),
                    })
                    continue
                except Exception as exc:
                    logger.error("Streaming ASR transcription failed: %s", exc)
                    await websocket.send_json({
                        "type": "error",
                        "message": f"ASR transcription failed: {exc}",
                    })
                    continue

                await websocket.send_json({
                    "type": "transcript",
                    "text": result.text,
                    "language": result.language,
                    "duration_seconds": result.duration_seconds,
                })
    except WebSocketDisconnect:
        logger.debug("Streaming ASR client disconnected")
    except Exception as exc:
        logger.error("Streaming ASR WebSocket error: %s", exc)
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Streaming ASR failed: {exc}",
            })
            await websocket.close(code=1011, reason="Streaming ASR failed")
        except Exception:
            pass
    finally:
        _audio_logger.end_session(audio_log_session_id)


# ---------------------------------------------------------------------------
# Unified WebSocket KWS + VAD + ASR session
# ---------------------------------------------------------------------------


async def _send_asr_segments(
    websocket: WebSocket,
    *,
    api_key: str,
    model: str,
    segments: list[AsrAudioSegment],
    send_lock: asyncio.Lock | None = None,
    profile_speaker_gate: ProfileSpeakerGate | None = None,
    audio_log_session_id: str = "",
    voice_session_id: str | None = None,
    traceparent: str | None = None,
) -> None:
    """Transcribe completed VAD segments and send transcript messages."""

    async def send_json(payload: dict[str, Any]) -> None:
        if send_lock is None:
            await websocket.send_json(payload)
            return

        async with send_lock:
            await websocket.send_json(payload)

    for segment in segments:
        _audio_logger.log_vad_segment(audio_log_session_id, segment.wav_bytes)
        record_voice_event(
            name="voice.vad.segment",
            voice_session_id=voice_session_id or audio_log_session_id,
            traceparent=traceparent,
            attributes={
                "voice.segment.duration_seconds": segment.duration_seconds,
                "voice.segment.bytes": len(segment.wav_bytes),
            },
        )
        if profile_speaker_gate is not None:
            try:
                record_voice_event(
                    name="voice.speaker.verify.start",
                    voice_session_id=voice_session_id or audio_log_session_id,
                    traceparent=traceparent,
                )
                profile_accepted, profile_score = await profile_speaker_gate.verify(
                    segment.samples
                )
                record_voice_event(
                    name="voice.speaker.verify.done",
                    voice_session_id=voice_session_id or audio_log_session_id,
                    traceparent=traceparent,
                    attributes={
                        "voice.speaker.accepted": profile_accepted,
                        "voice.speaker.score": profile_score or 0.0,
                        "voice.speaker.threshold": profile_speaker_gate.threshold,
                    },
                )
            except ValueError as exc:
                logger.info("Dropped ASR segment by profile speaker gate: %s", exc)
                await send_json({
                    "type": "speaker_rejected",
                    "mode": VOICE_MODE_ASR,
                    "reason": str(exc),
                    "threshold": profile_speaker_gate.threshold,
                })
                continue
            except RuntimeError as exc:
                logger.warning("Profile speaker verification unavailable: %s", exc)
                await send_json({
                    "type": "speaker_rejected",
                    "mode": VOICE_MODE_ASR,
                    "reason": "Speaker verification is temporarily unavailable",
                    "threshold": profile_speaker_gate.threshold,
                })
                continue
            except Exception as exc:
                logger.error("Profile speaker verification failed: %s", exc)
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_ASR,
                    "message": f"Speaker verification failed: {exc}",
                })
                continue

            if not profile_accepted:
                logger.info(
                    "Dropped ASR segment by profile speaker gate: "
                    "duration=%.2fs score=%.3f threshold=%.3f",
                    segment.duration_seconds,
                    profile_score if profile_score is not None else -1,
                    profile_speaker_gate.threshold,
                )
                await send_json({
                    "type": "speaker_rejected",
                    "mode": VOICE_MODE_ASR,
                    "score": profile_score,
                    "threshold": profile_speaker_gate.threshold,
                })
                continue

        await send_json({"type": "transcribing", "mode": VOICE_MODE_ASR})
        try:
            record_voice_event(
                name="voice.asr.dashscope.start",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
                attributes={
                    "voice.asr.model": model,
                    "voice.asr.audio_duration_seconds": segment.duration_seconds,
                    "voice.asr.audio_bytes": len(segment.wav_bytes),
                },
            )
            response: Any = await asyncio.to_thread(
                _call_dashscope_asr,
                api_key=api_key,
                model=model,
                audio_bytes=segment.wav_bytes,
            )
            result = _parse_asr_response(response)
            record_voice_event(
                name="voice.asr.dashscope.done",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
                attributes={
                    "voice.asr.model": model,
                    "voice.asr.text_length": len(result.text),
                    "voice.asr.duration_seconds": result.duration_seconds or 0.0,
                    "voice.asr.language": result.language or "",
                },
            )
        except HTTPException as exc:
            record_voice_event(
                name="voice.asr.dashscope.error",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
                attributes={"voice.asr.error": str(exc.detail)},
            )
            await send_json({
                "type": "error",
                "mode": VOICE_MODE_ASR,
                "message": str(exc.detail),
            })
            continue
        except Exception as exc:
            logger.error("Voice session ASR transcription failed: %s", exc)
            record_voice_event(
                name="voice.asr.dashscope.error",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
                attributes={"voice.asr.error": str(exc)},
            )
            await send_json({
                "type": "error",
                "mode": VOICE_MODE_ASR,
                "message": f"ASR transcription failed: {exc}",
            })
            continue

        await send_json({
            "type": "transcript",
            "mode": VOICE_MODE_ASR,
            "text": result.text,
            "language": result.language,
            "duration_seconds": result.duration_seconds,
        })


async def _send_wake_ack_tts(
    websocket: WebSocket,
    *,
    text: str,
    voice: str,
    send_lock: asyncio.Lock,
    audio_log_session_id: str = "",
    voice_session_id: str | None = None,
    traceparent: str | None = None,
) -> None:
    """Synthesize and stream the short wake acknowledgement over session WS."""
    if not text.strip():
        return

    try:
        headers = _upstream_headers()
    except RuntimeError as exc:
        logger.warning("Wake acknowledgement TTS skipped: %s", exc)
        return

    tts_model = os.environ.get(
        "TTS_MODEL", "qwen3-tts-instruct-flash-realtime"
    )
    upstream_url = f"{DASHSCOPE_WS_BASE}?model={tts_model}"

    async def send_json(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    try:
        record_voice_event(
            name="voice.tts.wake_ack.start",
            voice_session_id=voice_session_id or audio_log_session_id,
            traceparent=traceparent,
            attributes={"voice.tts.voice": voice, "voice.tts.text_length": len(text)},
        )
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
        ) as upstream:
            event_id = f"wake_ack_{int(asyncio.get_running_loop().time() * 1000)}"
            await upstream.send(json.dumps({
                "type": "session.update",
                "event_id": f"{event_id}_session",
                "session": {
                    "voice": voice,
                    "response_format": "pcm",
                    "sample_rate": 24000,
                    "mode": "server_commit",
                },
            }))
            await upstream.send(json.dumps({
                "type": "input_text_buffer.append",
                "event_id": f"{event_id}_append",
                "text": text,
            }))
            await upstream.send(json.dumps({
                "type": "session.finish",
                "event_id": f"{event_id}_finish",
            }))

            await send_json({
                "type": "tts_start",
                "purpose": WAKE_ACK_PURPOSE,
                "text": text,
                "sample_rate": 24000,
                "format": "pcm",
            })

            _audio_logger.start_tts_accumulation(audio_log_session_id)

            async for raw_message in upstream:
                if not isinstance(raw_message, str):
                    continue
                try:
                    message = json.loads(raw_message)
                except json.JSONDecodeError:
                    continue

                message_type = message.get("type")
                if message_type == "response.audio.delta":
                    delta = message.get("delta")
                    if isinstance(delta, str) and delta:
                        record_voice_event(
                            name="voice.tts.wake_ack.audio_delta",
                            voice_session_id=voice_session_id or audio_log_session_id,
                            traceparent=traceparent,
                            attributes={"voice.tts.delta_length": len(delta)},
                        )
                        _audio_logger.log_tts_chunk(audio_log_session_id, delta)
                        await send_json({
                            "type": "tts_audio",
                            "purpose": WAKE_ACK_PURPOSE,
                            "format": "pcm",
                            "sample_rate": 24000,
                            "delta": delta,
                        })
                elif message_type == "session.finished":
                    break
                elif message_type == "error":
                    error = message.get("error")
                    logger.warning("Wake acknowledgement TTS error: %s", error)
                    break

            _audio_logger.flush_tts(audio_log_session_id)

            record_voice_event(
                name="voice.tts.wake_ack.done",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
            )
            await send_json({
                "type": "tts_done",
                "purpose": WAKE_ACK_PURPOSE,
            })
    except Exception as exc:
        record_voice_event(
            name="voice.tts.wake_ack.error",
            voice_session_id=voice_session_id or audio_log_session_id,
            traceparent=traceparent,
            attributes={"voice.tts.error": str(exc)},
        )
        logger.warning("Wake acknowledgement TTS failed: %s", exc)


@voice_router.websocket(
    "/ws/voice/session",
    name="Unified voice session stream",
)
async def voice_session(websocket: WebSocket) -> None:
    """Unified voice session WebSocket for KWS + VAD + ASR.

    Client protocol:
    - {"type":"config","keywords":[...]} updates KWS wake words.
    - {"type":"mode","mode":"kws"|"asr"} selects how binary PCM frames are handled.
    - Binary frames are raw 16kHz mono Int16 PCM.

    TTS intentionally remains on /ws/voice/tts.
    """
    await websocket.accept()

    audio_log_session_id = _audio_logger.new_session()

    spotter = getattr(websocket.app.state, "kws_spotter", None)
    keyword_processor = getattr(websocket.app.state, "kws_processor", None)
    kws_stream = None
    kws_keywords: list[str] = []
    api_key: str | None = None
    vad_session: StreamingVadSession | None = None
    mode = VOICE_MODE_KWS
    model = os.environ.get("ASR_MODEL", "qwen3-asr-flash")
    tts_voice = os.environ.get("TTS_VOICE", "Cherry")
    send_lock = asyncio.Lock()
    wake_ack_tasks: set[asyncio.Task[None]] = set()
    profile_speaker_gate: ProfileSpeakerGate | None = None
    voice_session_id: str | None = None
    traceparent: str | None = None

    async def send_json(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def ensure_asr_session(
        *,
        activate: bool = True,
        report_errors: bool = True,
    ) -> bool:
        nonlocal api_key, vad_session, mode
        if api_key is not None and vad_session is not None:
            if activate:
                mode = VOICE_MODE_ASR
            return True

        try:
            next_api_key = _get_dashscope_key()
            next_vad_session = await asyncio.to_thread(StreamingVadSession)
            api_key = next_api_key
            vad_session = next_vad_session
            if activate:
                mode = VOICE_MODE_ASR
            return True
        except RuntimeError as exc:
            if report_errors:
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_ASR,
                    "message": str(exc),
                })
            else:
                logger.warning("Failed to prewarm voice session ASR: %s", exc)
        except Exception as exc:
            if report_errors:
                logger.error("Failed to initialize voice session VAD: %s", exc)
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_ASR,
                    "message": (
                        "Failed to initialize voice activity detection: "
                        f"{exc}"
                    ),
                })
            else:
                logger.warning("Failed to prewarm voice session VAD: %s", exc)

        if activate:
            mode = VOICE_MODE_KWS
        return False

    await send_json({
        "type": "ready",
        "mode": mode,
        "kws": spotter is not None,
        "asr": True,
    })

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect

            audio_bytes = message.get("bytes")
            if audio_bytes is not None:
                _audio_logger.log_raw_pcm(audio_log_session_id, audio_bytes)
                if mode == VOICE_MODE_ASR:
                    if api_key is None or vad_session is None:
                        await send_json({
                            "type": "error",
                            "mode": VOICE_MODE_ASR,
                            "message": "ASR is not initialized",
                        })
                        continue
                    speech_started, segments = vad_session.accept_audio(audio_bytes)
                    if speech_started:
                        record_voice_event(
                            name="voice.vad.speech_start",
                            voice_session_id=voice_session_id or audio_log_session_id,
                            traceparent=traceparent,
                            attributes={"voice.mode": VOICE_MODE_ASR},
                        )
                        await send_json({
                            "type": "speech_start",
                            "mode": VOICE_MODE_ASR,
                        })
                    await _send_asr_segments(
                        websocket,
                        api_key=api_key,
                        model=model,
                        segments=segments,
                        send_lock=send_lock,
                        profile_speaker_gate=profile_speaker_gate,
                        audio_log_session_id=audio_log_session_id,
                        voice_session_id=voice_session_id,
                        traceparent=traceparent,
                    )
                elif spotter is not None and kws_stream is not None:
                    detected = await asyncio.to_thread(
                        _process_audio_chunk, spotter, kws_stream, audio_bytes
                    )
                    if detected:
                        logger.info("Voice session KWS detection: '%s'", detected)
                        record_voice_event(
                            name="voice.kws.detect",
                            voice_session_id=voice_session_id or audio_log_session_id,
                            traceparent=traceparent,
                            attributes={"voice.kws.keyword": detected},
                        )
                        await send_json({
                            "type": "detection",
                            "mode": VOICE_MODE_KWS,
                            "keyword": detected,
                        })
                        if await ensure_asr_session():
                            await send_json({"type": "mode", "mode": mode})
                            task = asyncio.create_task(
                                _send_wake_ack_tts(
                                    websocket,
                                    text=WAKE_ACK_TEXT,
                                    voice=tts_voice,
                                    send_lock=send_lock,
                                    audio_log_session_id=audio_log_session_id,
                                    voice_session_id=voice_session_id,
                                    traceparent=traceparent,
                                )
                            )
                            wake_ack_tasks.add(task)
                            task.add_done_callback(wake_ack_tasks.discard)
                continue

            text = message.get("text")
            if text is None:
                continue

            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                await send_json({
                    "type": "error",
                    "message": "Invalid JSON control message",
                })
                continue

            payload_type = payload.get("type")
            if payload_type == "mode":
                next_mode = payload.get("mode")
                if next_mode not in {VOICE_MODE_KWS, VOICE_MODE_ASR}:
                    await send_json({
                        "type": "error",
                        "message": "Invalid voice mode",
                    })
                    continue
                mode = next_mode
                if mode == VOICE_MODE_ASR:
                    if not await ensure_asr_session():
                        continue
                await send_json({"type": "mode", "mode": mode})
                continue

            if payload_type != "config":
                continue

            next_voice_session_id = payload.get("voiceSessionId") or payload.get(
                "voice_session_id"
            )
            if isinstance(next_voice_session_id, str) and next_voice_session_id.strip():
                voice_session_id = next_voice_session_id.strip()
            next_traceparent = payload.get("traceparent")
            if isinstance(next_traceparent, str) and next_traceparent.strip():
                traceparent = next_traceparent.strip()

            record_voice_event(
                name="voice.session.config",
                voice_session_id=voice_session_id or audio_log_session_id,
                traceparent=traceparent,
                attributes={
                    "voice.mode": mode,
                    "voice.kws.enabled": spotter is not None,
                    "voice.session.audio_log_id": audio_log_session_id,
                },
            )

            if "speakerVerification" in payload:
                speaker_config = payload.get("speakerVerification")
                if isinstance(speaker_config, dict):
                    agent_id = str(speaker_config.get("agentId") or "").strip()
                    user_id = str(speaker_config.get("userId") or "").strip()
                    if agent_id and user_id:
                        try:
                            profile_speaker_gate = await asyncio.to_thread(
                                _load_profile_speaker_gate,
                                agent_id,
                                user_id,
                            )
                            await send_json({
                                "type": "speaker_config",
                                "mode": VOICE_MODE_ASR,
                                "enabled": profile_speaker_gate is not None,
                                "bound": profile_speaker_gate is not None,
                                "threshold": SPEAKER_PROFILE_THRESHOLD,
                            })
                        except ValueError as exc:
                            profile_speaker_gate = None
                            await send_json({
                                "type": "speaker_config",
                                "mode": VOICE_MODE_ASR,
                                "enabled": True,
                                "bound": False,
                                "message": str(exc),
                                "threshold": SPEAKER_PROFILE_THRESHOLD,
                            })
                        except Exception as exc:
                            profile_speaker_gate = None
                            logger.error("Failed to load profile speaker gate: %s", exc)
                            await send_json({
                                "type": "error",
                                "mode": VOICE_MODE_ASR,
                                "message": f"Failed to load speaker verification: {exc}",
                            })
                    else:
                        profile_speaker_gate = None
                else:
                    profile_speaker_gate = None

            next_keywords = payload.get("keywords", [])
            next_tts_voice = _coerce_tts_voice(
                payload.get("ttsVoice", payload.get("tts_voice"))
            )
            if next_tts_voice:
                tts_voice = next_tts_voice
            if not isinstance(next_keywords, list):
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_KWS,
                    "message": "keywords must be a list",
                })
                continue
            if not next_keywords:
                continue

            if spotter is None:
                loading_task = getattr(websocket.app.state, "kws_loading_task", None)
                message_text = (
                    "KWS model is still loading on server"
                    if loading_task and not loading_task.done()
                    else "KWS model not available on server"
                )
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_KWS,
                    "message": message_text,
                })
                continue

            next_stream, keywords_string = await _create_keyword_stream(
                spotter, keyword_processor, [str(item) for item in next_keywords]
            )
            if next_stream is None or not keywords_string:
                await send_json({
                    "type": "error",
                    "mode": VOICE_MODE_KWS,
                    "message": "Failed to process keywords",
                })
                continue

            kws_stream = next_stream
            kws_keywords = [str(item) for item in next_keywords]
            logger.info(
                "Voice session KWS configured: keywords=%s, formatted=%s",
                kws_keywords,
                keywords_string[:100],
            )
            await ensure_asr_session(activate=False, report_errors=False)
            await send_json({
                "type": "config",
                "mode": VOICE_MODE_KWS,
                "keywords": kws_keywords,
            })
    except WebSocketDisconnect:
        logger.debug("Voice session client disconnected")
    except Exception as exc:
        logger.error("Voice session WebSocket error: %s", exc, exc_info=True)
        try:
            await send_json({
                "type": "error",
                "message": f"Voice session failed: {exc}",
            })
            await websocket.close(code=1011, reason="Voice session failed")
        except Exception:
            pass
    finally:
        _audio_logger.end_session(audio_log_session_id)
        for task in wake_ack_tasks:
            task.cancel()


# ---------------------------------------------------------------------------
# WebSocket TTS proxy (unchanged)
# ---------------------------------------------------------------------------


def _upstream_headers() -> dict[str, str]:
    """Build headers for upstream DashScope WebSocket connection."""
    return {
        "Authorization": f"Bearer {_get_dashscope_key()}",
        "OpenAI-Beta": "realtime=v1",
    }


TTS_UPSTREAM_KEEPALIVE_SECONDS = float(
    os.environ.get("TTS_UPSTREAM_KEEPALIVE_SECONDS", "5")
)


async def _relay(
    client_ws: WebSocket,
    upstream_ws: ClientConnection,
    *,
    audio_log_session_id: str = "",
    voice_session_id: str | None = None,
    traceparent: str | None = None,
) -> None:
    """Bidirectional relay between client WebSocket and upstream WebSocket.

    Runs three concurrent tasks:
    - client_to_upstream: forward messages from browser to DashScope
    - upstream_to_client: forward messages from DashScope to browser
    - keepalive: send periodic heartbeat to DashScope to prevent
      application-level idle timeout during agent processing gaps
      (e.g. tool calls) when no text chunks are being forwarded

    When either relay direction disconnects, all tasks are cancelled.
    """
    upstream_send_lock = asyncio.Lock()
    last_activity = asyncio.get_event_loop().time()

    async def client_to_upstream() -> None:
        """Forward messages from the browser client to DashScope."""
        nonlocal last_activity
        try:
            while True:
                data = await client_ws.receive_text()
                last_activity = asyncio.get_event_loop().time()
                # Start TTS accumulation when new text is appended
                if audio_log_session_id:
                    try:
                        msg = json.loads(data)
                        if (
                            msg.get("type") == "input_text_buffer.append"
                            and msg.get("text")
                        ):
                            record_voice_event(
                                name="voice.tts.text_append",
                                voice_session_id=voice_session_id or audio_log_session_id,
                                traceparent=traceparent,
                                attributes={
                                    "voice.tts.text_length": len(str(msg.get("text"))),
                                },
                            )
                            _audio_logger.start_tts_accumulation(
                                audio_log_session_id,
                            )
                    except (json.JSONDecodeError, TypeError):
                        pass
                async with upstream_send_lock:
                    await upstream_ws.send(data)
        except WebSocketDisconnect:
            logger.info("[TTS relay] Client disconnected (client_to_upstream)")
        except websockets.ConnectionClosed as exc:
            logger.info(
                "[TTS relay] Upstream closed (client_to_upstream) "
                "code=%s reason=%s",
                exc.code, exc.reason,
            )

    async def upstream_to_client() -> None:
        """Forward messages from DashScope to the browser client."""
        try:
            async for message in upstream_ws:
                if isinstance(message, str):
                    # Intercept TTS audio for logging
                    if audio_log_session_id:
                        try:
                            msg = json.loads(message)
                            msg_type = msg.get("type")
                            if msg_type == "response.audio.delta":
                                delta = msg.get("delta")
                                if isinstance(delta, str) and delta:
                                    record_voice_event(
                                        name="voice.tts.audio_delta",
                                        voice_session_id=voice_session_id or audio_log_session_id,
                                        traceparent=traceparent,
                                        attributes={"voice.tts.delta_length": len(delta)},
                                    )
                                    _audio_logger.log_tts_chunk(
                                        audio_log_session_id, delta,
                                    )
                            elif msg_type in ("response.done", "session.finished"):
                                record_voice_event(
                                    name=f"voice.tts.{msg_type.replace('.', '_')}",
                                    voice_session_id=voice_session_id or audio_log_session_id,
                                    traceparent=traceparent,
                                )
                                _audio_logger.flush_tts(audio_log_session_id)
                        except (json.JSONDecodeError, TypeError):
                            pass
                    await client_ws.send_text(message)
                else:
                    await client_ws.send_bytes(message)
        except WebSocketDisconnect:
            logger.info("[TTS relay] Client disconnected (upstream_to_client)")
        except websockets.ConnectionClosed as exc:
            logger.info(
                "[TTS relay] Upstream closed (upstream_to_client) "
                "code=%s reason=%s",
                exc.code, exc.reason,
            )
            # Flush any remaining TTS audio on unexpected close
            _audio_logger.flush_tts(audio_log_session_id)

    async def keepalive() -> None:
        """Send periodic heartbeat to DashScope to prevent idle timeout.

        During agent processing gaps (tool calls, extended thinking), no
        text chunks flow upstream. DashScope Realtime API may close the
        session after an application-level idle timeout. This heartbeat
        sends empty ``input_text_buffer.append`` messages to keep the
        session alive.
        """
        nonlocal last_activity
        try:
            while True:
                await asyncio.sleep(TTS_UPSTREAM_KEEPALIVE_SECONDS)
                now = asyncio.get_event_loop().time()
                if now - last_activity >= TTS_UPSTREAM_KEEPALIVE_SECONDS:
                    async with upstream_send_lock:
                        await upstream_ws.send(json.dumps({
                            "type": "input_text_buffer.append",
                            "text": "",
                        }))
                    last_activity = now
                    logger.info("[TTS keepalive] Sent (idle %.1fs)", now - last_activity)
        except websockets.ConnectionClosed as exc:
            logger.info("[TTS keepalive] Connection closed code=%s reason=%s", exc.code, exc.reason)
        except asyncio.CancelledError:
            pass

    logger.info("[TTS relay] Started")
    done, pending = await asyncio.wait(
        [
            asyncio.create_task(client_to_upstream()),
            asyncio.create_task(upstream_to_client()),
            asyncio.create_task(keepalive()),
        ],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()


@voice_router.websocket(
    "/ws/voice/tts",
    name="Voice TTS proxy stream",
)
async def tts_proxy(websocket: WebSocket) -> None:
    """TTS WebSocket proxy.

    Browser -> this endpoint -> DashScope TTS API (qwen3-tts-instruct-flash-realtime).
    Injects Authorization header with DASHSCOPE_API_KEY.
    Forwards text input (input_text_buffer.append) and audio output
    (response.audio.delta) bidirectionally.
    """
    client_addr = websocket.client.host if websocket.client else "unknown"
    logger.info("[TTS proxy] Client connecting from %s", client_addr)
    await websocket.accept()
    logger.info("[TTS proxy] Client accepted from %s", client_addr)

    audio_log_session_id = _audio_logger.new_session()
    voice_session_id = websocket.query_params.get("voiceSessionId") or None
    traceparent = websocket.query_params.get("traceparent") or None

    tts_model = os.environ.get(
        "TTS_MODEL", "qwen3-tts-instruct-flash-realtime"
    )
    upstream_url = f"{DASHSCOPE_WS_BASE}?model={tts_model}"
    logger.info("[TTS proxy] Upstream URL: %s", upstream_url)

    try:
        headers = _upstream_headers()
    except RuntimeError as exc:
        logger.error("[TTS proxy] Cannot start — DASHSCOPE_API_KEY missing: %s", exc)
        await websocket.close(code=1011, reason=str(exc))
        _audio_logger.end_session(audio_log_session_id)
        return

    try:
        logger.info("[TTS proxy] Connecting to DashScope upstream...")
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
        ) as upstream:
            logger.info("[TTS proxy] Upstream connected OK — starting relay")
            await _relay(
                websocket, upstream,
                audio_log_session_id=audio_log_session_id,
                voice_session_id=voice_session_id,
                traceparent=traceparent,
            )
            logger.info("[TTS proxy] Relay finished (normal)")
    except websockets.InvalidStatus as exc:
        logger.error(
            "[TTS proxy] Upstream REJECTED connection: status=%s response=%s",
            getattr(exc, "response", None), exc,
        )
        await websocket.close(code=1011, reason=f"Upstream error: {exc}")
    except websockets.ConnectionClosed as exc:
        logger.error(
            "[TTS proxy] Upstream connection CLOSED during handshake: "
            "code=%s reason=%s",
            exc.code, exc.reason,
        )
        try:
            await websocket.close(code=1011, reason=f"Upstream closed: {exc.code}")
        except Exception:
            pass
    except Exception as exc:
        logger.error("[TTS proxy] Unexpected error: %s: %s", type(exc).__name__, exc, exc_info=True)
        try:
            await websocket.close(code=1011, reason="Internal proxy error")
        except Exception:
            pass
    finally:
        _audio_logger.end_session(audio_log_session_id)
