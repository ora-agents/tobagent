"""Voice WebSocket proxy for DashScope Realtime ASR/TTS APIs.

Frontend connects via ws://host:2024/ws/voice/asr or /ws/voice/tts.
This proxy forwards to DashScope Realtime API while injecting the
DASHSCOPE_API_KEY from server-side environment variables.

Security:
- API key never reaches the browser.
- Optional: add rate limiting, user auth checks for production.
"""

import asyncio
import logging
import os

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

DASHSCOPE_WS_BASE = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"

voice_router = APIRouter()


def _get_dashscope_key() -> str:
    """Retrieve DASHSCOPE_API_KEY from environment."""
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "DASHSCOPE_API_KEY is not set. "
            "Voice proxy requires this environment variable."
        )
    return key


def _upstream_headers() -> dict[str, str]:
    """Build headers for upstream DashScope WebSocket connection."""
    return {
        "Authorization": f"Bearer {_get_dashscope_key()}",
        "OpenAI-Beta": "realtime=v1",
    }


async def _relay(
    client_ws: WebSocket,
    upstream_ws: websockets.WebSocketClientProtocol,
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
                await client_ws.send_text(message)
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


@voice_router.websocket("/ws/voice/asr")
async def asr_proxy(websocket: WebSocket) -> None:
    """ASR WebSocket proxy.

    Browser -> this endpoint -> DashScope ASR API (qwen3-asr-flash-realtime).
    Injects Authorization header with DASHSCOPE_API_KEY.
    All JSON messages are forwarded bidirectionally (session.update,
    input_audio_buffer.append, transcription events, etc.).
    """
    await websocket.accept()

    asr_model = os.environ.get(
        "ASR_MODEL", "qwen3-asr-flash-realtime-2026-02-10"
    )
    upstream_url = f"{DASHSCOPE_WS_BASE}?model={asr_model}"

    try:
        headers = _upstream_headers()
    except RuntimeError as exc:
        logger.error("ASR proxy cannot start: %s", exc)
        await websocket.close(code=1011, reason=str(exc))
        return

    try:
        async with websockets.connect(
            upstream_url,
            additional_headers=headers,
        ) as upstream:
            logger.info("ASR proxy connected to upstream: %s", upstream_url)
            await _relay(websocket, upstream)
    except websockets.InvalidStatusCode as exc:
        logger.error("Upstream ASR rejected connection: %s", exc)
        await websocket.close(code=1011, reason=f"Upstream error: {exc}")
    except Exception as exc:
        logger.error("ASR proxy error: %s", exc)
        try:
            await websocket.close(code=1011, reason="Internal proxy error")
        except Exception:
            pass


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
    except websockets.InvalidStatusCode as exc:
        logger.error("Upstream TTS rejected connection: %s", exc)
        await websocket.close(code=1011, reason=f"Upstream error: {exc}")
    except Exception as exc:
        logger.error("TTS proxy error: %s", exc)
        try:
            await websocket.close(code=1011, reason="Internal proxy error")
        except Exception:
            pass
