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
import logging
import os
import tempfile
import wave
from pathlib import Path
from typing import Any

import dashscope  # type: ignore[import-untyped]
import numpy as np
import websockets
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger(__name__)

DASHSCOPE_WS_BASE = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
VAD_SAMPLE_RATE = 16000
VAD_THRESHOLD = 0.65
VAD_MIN_SILENCE_DURATION = 0.35
VAD_MIN_SPEECH_DURATION = 0.25
VAD_MAX_SPEECH_DURATION = 20.0
VAD_WINDOW_SIZE = 256
MIN_ASR_SEGMENT_DURATION_SECONDS = 0.3
REPO_ROOT = Path(__file__).resolve().parents[2]
VAD_DATA_PATH = (
    REPO_ROOT
    / "frontend"
    / "public"
    / "sherpa-onnx-wasm-simd-v1.13.2-ten-vad"
    / "sherpa-onnx-wasm-main-vad.data"
)
VAD_MODEL_PATH = REPO_ROOT / "models" / "vad" / "ten-vad.onnx"
TEN_VAD_DATA_START = 1076
TEN_VAD_DATA_END = 333287

voice_router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
        raise FileNotFoundError(f"Ten VAD data package not found: {VAD_DATA_PATH}")

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

    def accept_audio(self, audio_bytes: bytes) -> tuple[bool, list[bytes]]:
        """Accept Int16 PCM bytes and return speech-start plus completed WAVs."""
        samples_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
        if len(samples_int16) == 0:
            return False, []

        samples_float32 = samples_int16.astype(np.float32) / 32768.0
        self.vad.accept_waveform(samples_float32)

        is_speech_detected = self.vad.is_speech_detected()
        speech_started = is_speech_detected and not self.was_speech_detected
        speech_segments = self._drain_completed_segments()
        self.was_speech_detected = is_speech_detected
        return speech_started, speech_segments

    def _drain_completed_segments(self) -> list[bytes]:
        """Drain completed VAD segments and encode them as WAV payloads."""
        segments: list[bytes] = []

        while not self.vad.empty():
            segment = self.vad.front
            self.vad.pop()

            samples = np.asarray(segment.samples, dtype=np.float32)
            duration_seconds = len(samples) / VAD_SAMPLE_RATE
            if duration_seconds < MIN_ASR_SEGMENT_DURATION_SECONDS:
                continue

            segments.append(_float32_to_wav_bytes(samples))

        return segments


# ---------------------------------------------------------------------------
# REST ASR endpoint
# ---------------------------------------------------------------------------


class AsrTranscribeRequest(BaseModel):
    """Audio data URI for transcription.

    Expected format: ``data:audio/wav;base64,<base64_encoded_wav>``
    """

    audio: str


class AsrTranscribeResponse(BaseModel):
    """Transcription result."""

    text: str
    language: str | None = None
    duration_seconds: float | None = None


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


@voice_router.post("/api/asr/transcribe", response_model=AsrTranscribeResponse)
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


@voice_router.websocket("/ws/voice/asr")
async def asr_stream(websocket: WebSocket) -> None:
    """Stream microphone PCM to backend VAD and return ASR transcripts."""
    await websocket.accept()

    try:
        api_key = _get_dashscope_key()
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011, reason="ASR is not configured")
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

            speech_started, wav_segments = vad_session.accept_audio(audio_bytes)
            if speech_started:
                await websocket.send_json({"type": "speech_start"})

            for wav_bytes in wav_segments:
                await websocket.send_json({"type": "transcribing"})
                try:
                    response: Any = await asyncio.to_thread(
                        _call_dashscope_asr,
                        api_key=api_key,
                        model=model,
                        audio_bytes=wav_bytes,
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


# ---------------------------------------------------------------------------
# WebSocket TTS proxy (unchanged)
# ---------------------------------------------------------------------------


def _upstream_headers() -> dict[str, str]:
    """Build headers for upstream DashScope WebSocket connection."""
    return {
        "Authorization": f"Bearer {_get_dashscope_key()}",
        "OpenAI-Beta": "realtime=v1",
    }


async def _relay(
    client_ws: WebSocket,
    upstream_ws: ClientConnection,
) -> None:
    """Bidirectional relay between client WebSocket and upstream WebSocket.

    Runs two concurrent tasks:
    - client_to_upstream: forward messages from browser to DashScope
    - upstream_to_client: forward messages from DashScope to browser

    When either side disconnects, the other task is cancelled.
    """

    async def client_to_upstream() -> None:
        """Forward messages from the browser client to DashScope."""
        try:
            while True:
                data = await client_ws.receive_text()
                await upstream_ws.send(data)
        except WebSocketDisconnect:
            logger.debug("Client disconnected (client_to_upstream)")
        except websockets.ConnectionClosed:
            logger.debug("Upstream closed (client_to_upstream)")

    async def upstream_to_client() -> None:
        """Forward messages from DashScope to the browser client."""
        try:
            async for message in upstream_ws:
                if isinstance(message, str):
                    await client_ws.send_text(message)
                else:
                    await client_ws.send_bytes(message)
        except WebSocketDisconnect:
            logger.debug("Client disconnected (upstream_to_client)")
        except websockets.ConnectionClosed:
            logger.debug("Upstream closed (upstream_to_client)")

    done, pending = await asyncio.wait(
        [
            asyncio.create_task(client_to_upstream()),
            asyncio.create_task(upstream_to_client()),
        ],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()


@voice_router.websocket("/ws/voice/tts")
async def tts_proxy(websocket: WebSocket) -> None:
    """TTS WebSocket proxy.

    Browser -> this endpoint -> DashScope TTS API (qwen3-tts-instruct-flash-realtime).
    Injects Authorization header with DASHSCOPE_API_KEY.
    Forwards text input (input_text_buffer.append) and audio output
    (response.audio.delta) bidirectionally.
    """
    await websocket.accept()

    tts_model = os.environ.get(
        "TTS_MODEL", "qwen3-tts-instruct-flash-realtime"
    )
    upstream_url = f"{DASHSCOPE_WS_BASE}?model={tts_model}"

    try:
        headers = _upstream_headers()
    except RuntimeError as exc:
        logger.error("TTS proxy cannot start: %s", exc)
        await websocket.close(code=1011, reason=str(exc))
        return

    try:
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
        ) as upstream:
            logger.info("TTS proxy connected to upstream: %s", upstream_url)
            await _relay(websocket, upstream)
    except websockets.InvalidStatus as exc:
        logger.error("Upstream TTS rejected connection: %s", exc)
        await websocket.close(code=1011, reason=f"Upstream error: {exc}")
    except Exception as exc:
        logger.error("TTS proxy error: %s", exc)
        try:
            await websocket.close(code=1011, reason="Internal proxy error")
        except Exception:
            pass
