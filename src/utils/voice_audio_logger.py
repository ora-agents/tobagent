"""Voice audio logger — saves WAV files at each stage of the voice pipeline.

Controlled by environment variables:

    VOICE_AUDIO_LOG_ENABLED   Master switch (default: ``false``).
    VOICE_AUDIO_LOG_DIR       Output directory (default: ``logs/voice_audio``).
    VOICE_AUDIO_LOG_RAW       Log raw microphone PCM (default: follow master).
    VOICE_AUDIO_LOG_VAD       Log completed VAD segments (default: follow master).
    VOICE_AUDIO_LOG_TTS       Log TTS synthesized output (default: follow master).

When disabled (the default), all public methods are no-ops with negligible
overhead — a single boolean guard at the call site.

File layout::

    {VOICE_AUDIO_LOG_DIR}/{session_id}/
        raw_input.wav            # Full accumulated microphone audio
        vad_000.wav              # VAD-completed speech segment #0
        vad_001.wav              # VAD-completed speech segment #1
        tts_000.wav              # TTS utterance #0
        tts_wake_ack_000.wav     # Wake acknowledgement TTS #0

Session IDs are ``{YYYYmmdd_HHMMSS}_{4-hex-random}`` strings.
"""

from __future__ import annotations

import io
import logging
import os
import secrets
import threading
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PCM_SAMPLE_RATE = 16_000
_TTS_SAMPLE_RATE = 24_000

# Flush raw PCM accumulator to disk after this many bytes (~60 s of 16 kHz
# Int16 audio).  Prevents unbounded memory growth for long sessions.
_RAW_FLUSH_THRESHOLD = _PCM_SAMPLE_RATE * 2 * 60


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _int16_bytes_to_wav(audio_bytes: bytes, sample_rate: int) -> bytes:
    """Encode raw Int16 PCM bytes as a mono 16-bit WAV."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio_bytes)
    return buffer.getvalue()


def _float32_to_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    """Encode float32 samples as a mono 16-bit WAV."""
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = np.where(clipped < 0, clipped * 32768, clipped * 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _generate_session_id() -> str:
    """Return a ``YYYYmmdd_HHMMSS_{4-hex}`` session identifier."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = secrets.token_hex(2)
    return f"{ts}_{suffix}"


# ---------------------------------------------------------------------------
# Per-session state
# ---------------------------------------------------------------------------


class _SessionState:
    """Mutable per-session audio accumulator (thread-safe)."""

    def __init__(self, session_dir: Path, *, log_raw: bool) -> None:
        self.session_dir = session_dir
        self.log_raw = log_raw
        self._lock = threading.Lock()
        self._raw_buffer = bytearray()
        self._raw_parts: list[bytes] = []  # flushed raw chunks
        self._vad_count = 0
        self._tts_count = 0
        self._tts_wake_ack_count = 0
        self._tts_accumulator: bytearray | None = None
        self._closed = False

        session_dir.mkdir(parents=True, exist_ok=True)

    # -- raw PCM ---------------------------------------------------------

    def append_raw_pcm(self, audio_bytes: bytes) -> None:
        """Append Int16 PCM bytes to the raw accumulator."""
        if not self.log_raw:
            return
        with self._lock:
            if self._closed:
                return
            self._raw_buffer.extend(audio_bytes)
            if len(self._raw_buffer) >= _RAW_FLUSH_THRESHOLD:
                self._raw_parts.append(bytes(self._raw_buffer))
                self._raw_buffer.clear()

    def flush_raw(self) -> None:
        """Write all accumulated raw PCM as ``raw_input.wav``."""
        if not self.log_raw:
            return
        with self._lock:
            if self._raw_buffer:
                self._raw_parts.append(bytes(self._raw_buffer))
                self._raw_buffer.clear()
            if not self._raw_parts:
                return
            all_pcm = b"".join(self._raw_parts)
            self._raw_parts.clear()

        wav_bytes = _int16_bytes_to_wav(all_pcm, _PCM_SAMPLE_RATE)
        out_path = self.session_dir / "raw_input.wav"
        out_path.write_bytes(wav_bytes)
        logger.debug("Voice audio log: wrote %s (%d bytes)", out_path, len(wav_bytes))

    # -- VAD segments ----------------------------------------------------

    def write_vad_segment(self, wav_bytes: bytes) -> None:
        """Write a completed VAD segment WAV immediately."""
        with self._lock:
            index = self._vad_count
            self._vad_count += 1
        out_path = self.session_dir / f"vad_{index:03d}.wav"
        out_path.write_bytes(wav_bytes)
        logger.debug("Voice audio log: wrote %s", out_path)

    # -- TTS output ------------------------------------------------------

    def start_tts_accumulation(self) -> None:
        """Begin accumulating TTS audio deltas for one utterance."""
        with self._lock:
            self._tts_accumulator = bytearray()

    def append_tts_pcm_base64(self, pcm_base64: str) -> None:
        """Decode a base64 Int16 PCM chunk and accumulate it."""
        import base64

        with self._lock:
            if self._tts_accumulator is None:
                return
            try:
                raw = base64.b64decode(pcm_base64)
                self._tts_accumulator.extend(raw)
            except Exception:
                pass

    def flush_tts(self, sample_rate: int = _TTS_SAMPLE_RATE) -> None:
        """Flush accumulated TTS audio as a WAV file."""
        with self._lock:
            if self._tts_accumulator is None or not self._tts_accumulator:
                self._tts_accumulator = None
                return
            pcm = bytes(self._tts_accumulator)
            self._tts_accumulator = None
            index = self._tts_count
            self._tts_count += 1

        wav_bytes = _int16_bytes_to_wav(pcm, sample_rate)
        out_path = self.session_dir / f"tts_{index:03d}.wav"
        out_path.write_bytes(wav_bytes)
        logger.debug("Voice audio log: wrote %s (%d bytes)", out_path, len(wav_bytes))

    def write_tts_wav(self, wav_bytes: bytes, *, purpose: str = "wake_ack") -> None:
        """Write a pre-built TTS WAV file (e.g. wake acknowledgement)."""
        with self._lock:
            if purpose == "wake_ack":
                index = self._tts_wake_ack_count
                self._tts_wake_ack_count += 1
            else:
                index = self._tts_count
                self._tts_count += 1

        filename = (
            f"tts_{purpose}_{index:03d}.wav"
            if purpose != "tts"
            else f"tts_{index:03d}.wav"
        )
        out_path = self.session_dir / filename
        out_path.write_bytes(wav_bytes)
        logger.debug("Voice audio log: wrote %s", out_path)

    # -- lifecycle -------------------------------------------------------

    def close(self) -> None:
        """Flush raw PCM and mark session as closed."""
        with self._lock:
            self._closed = True
        self.flush_raw()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class VoiceAudioLogger:
    """Voice pipeline audio logger.

    Instantiate once at module level via :meth:`from_env`.  Each WebSocket
    session calls :meth:`new_session` to get a session ID, then uses the
    ``log_*`` methods during the session, and :meth:`end_session` on close.
    """

    def __init__(
        self,
        base_dir: Path,
        *,
        enabled: bool,
        log_raw: bool,
        log_vad: bool,
        log_tts: bool,
    ) -> None:
        """Initialize the voice audio logger."""
        self.base_dir = base_dir
        self.enabled = enabled
        self.log_raw = log_raw
        self.log_vad = log_vad
        self.log_tts = log_tts
        self._sessions: dict[str, _SessionState] = {}
        self._lock = threading.Lock()

        if enabled:
            base_dir.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Voice audio logging ENABLED: dir=%s raw=%s vad=%s tts=%s",
                base_dir, log_raw, log_vad, log_tts,
            )

    @classmethod
    def from_env(cls) -> VoiceAudioLogger:
        """Create a logger from environment variables."""
        enabled = os.environ.get("VOICE_AUDIO_LOG_ENABLED", "false").lower() in (
            "1", "true", "yes",
        )
        base_dir = Path(
            os.environ.get("VOICE_AUDIO_LOG_DIR", "logs/voice_audio")
        )

        def _stage_env(name: str) -> bool:
            val = os.environ.get(name)
            if val is None:
                return enabled  # follow master switch
            return val.lower() in ("1", "true", "yes")

        return cls(
            base_dir,
            enabled=enabled,
            log_raw=_stage_env("VOICE_AUDIO_LOG_RAW"),
            log_vad=_stage_env("VOICE_AUDIO_LOG_VAD"),
            log_tts=_stage_env("VOICE_AUDIO_LOG_TTS"),
        )

    # -- session lifecycle -----------------------------------------------

    def new_session(self) -> str:
        """Create a new logging session and return its ID.

        Returns an empty string if logging is disabled (callers should
        treat empty string as "no session").
        """
        if not self.enabled:
            return ""

        session_id = _generate_session_id()
        session_dir = self.base_dir / session_id
        state = _SessionState(session_dir, log_raw=self.log_raw)

        with self._lock:
            self._sessions[session_id] = state

        logger.info("Voice audio log: session started: %s", session_id)
        return session_id

    def end_session(self, session_id: str) -> None:
        """Flush remaining audio and close the session."""
        if not session_id:
            return

        with self._lock:
            state = self._sessions.pop(session_id, None)

        if state is None:
            return

        state.close()
        logger.info("Voice audio log: session ended: %s", session_id)

    # -- raw PCM ---------------------------------------------------------

    def log_raw_pcm(self, session_id: str, audio_bytes: bytes) -> None:
        """Accumulate raw Int16 PCM bytes for the session."""
        if not session_id or not self.log_raw:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.append_raw_pcm(audio_bytes)

    # -- VAD segments ----------------------------------------------------

    def log_vad_segment(self, session_id: str, wav_bytes: bytes) -> None:
        """Write a completed VAD segment WAV file."""
        if not session_id or not self.log_vad:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.write_vad_segment(wav_bytes)

    # -- TTS output ------------------------------------------------------

    def start_tts_accumulation(self, session_id: str) -> None:
        """Begin accumulating TTS audio deltas for one utterance."""
        if not session_id or not self.log_tts:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.start_tts_accumulation()

    def log_tts_chunk(self, session_id: str, pcm_base64: str) -> None:
        """Accumulate a base64-encoded Int16 PCM TTS chunk."""
        if not session_id or not self.log_tts:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.append_tts_pcm_base64(pcm_base64)

    def flush_tts(self, session_id: str, sample_rate: int = _TTS_SAMPLE_RATE) -> None:
        """Flush accumulated TTS audio as a WAV file."""
        if not session_id or not self.log_tts:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.flush_tts(sample_rate)

    def log_tts_wav(
        self,
        session_id: str,
        wav_bytes: bytes,
        *,
        purpose: str = "wake_ack",
    ) -> None:
        """Write a pre-built TTS WAV file."""
        if not session_id or not self.log_tts:
            return
        with self._lock:
            state = self._sessions.get(session_id)
        if state is None:
            return
        state.write_tts_wav(wav_bytes, purpose=purpose)
