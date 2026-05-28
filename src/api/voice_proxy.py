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
import logging
import os
import tempfile
from typing import Any

import dashscope  # type: ignore[import-untyped]
import websockets
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger(__name__)

DASHSCOPE_WS_BASE = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"

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
