"""KWS (Keyword Spotting) WebSocket endpoint.

Accepts a continuous 16kHz Int16 PCM audio stream from the browser,
runs sherpa-onnx keyword spotting, and sends detection events back.

Protocol:
    1. Client sends JSON config: {"type": "config", "keywords": ["小梯小梯", ...]}
    2. Client sends binary frames: raw Int16 PCM (16kHz, mono, little-endian)
    3. Server sends JSON: {"type": "detection", "keyword": "小梯小梯"}
       or {"type": "error", "message": "..."}
"""

import asyncio
import logging

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

kws_router = APIRouter()


def _process_audio_chunk(spotter, stream, audio_bytes: bytes) -> str | None:
    """Process a chunk of Int16 PCM audio and check for keyword detection.

    This is CPU-bound and must be called via asyncio.to_thread().

    Args:
        spotter: sherpa_onnx.KeywordSpotter instance (shared, thread-safe).
        stream: sherpa_onnx keyword stream (per-connection, NOT thread-safe).
        audio_bytes: Raw Int16 PCM bytes (16kHz, mono, little-endian).

    Returns:
        Detected keyword string, or None.
    """
    # Convert Int16 bytes to float32 numpy array [-1, 1]
    samples_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    if len(samples_int16) == 0:
        return None

    samples_float32 = samples_int16.astype(np.float32) / 32768.0

    # Feed audio to the stream
    stream.accept_waveform(16000, samples_float32)

    # Decode and check for detections
    while spotter.is_ready(stream):
        spotter.decode_stream(stream)

    result = spotter.get_result(stream)
    if result:
        # Extract the keyword label (format: "phonemes @label" or just "label")
        keyword = result
        if " @" in result:
            keyword = result.split(" @")[-1].strip()
        elif "@" in result:
            keyword = result.split("@")[-1].strip()

        # Reset the stream for the next detection
        spotter.reset_stream(stream)
        return keyword

    return None


@kws_router.websocket("/ws/voice/kws")
async def kws_websocket(websocket: WebSocket) -> None:
    """KWS WebSocket endpoint for always-on wake word detection."""
    await websocket.accept()

    # Check if KWS is available
    spotter = getattr(websocket.app.state, "kws_spotter", None)
    keyword_processor = getattr(websocket.app.state, "kws_processor", None)

    if spotter is None:
        logger.warning("KWS WebSocket rejected: model not loaded")
        await websocket.send_json({
            "type": "error",
            "message": "KWS model not available on server",
        })
        await websocket.close(code=1011, reason="KWS model not available")
        return

    try:
        # 1. Receive initial config message
        config_msg = await websocket.receive_json()
        if config_msg.get("type") != "config":
            await websocket.send_json({
                "type": "error",
                "message": "Expected config message first",
            })
            await websocket.close(code=1008, reason="Protocol error")
            return

        keywords_list = config_msg.get("keywords", [])
        if not keywords_list:
            await websocket.send_json({
                "type": "error",
                "message": "No keywords configured for this agent",
            })
            await websocket.close(code=1008, reason="No keywords")
            return

        # 2. Convert keywords to phoneme format
        keywords_string = None
        if keyword_processor:
            keywords_string = keyword_processor.format_keywords(keywords_list)

        if not keywords_string:
            await websocket.send_json({
                "type": "error",
                "message": "Failed to process keywords",
            })
            await websocket.close(code=1011, reason="Keyword processing failed")
            return

        logger.info(
            "KWS session started: keywords=%s, formatted=%s",
            keywords_list,
            keywords_string[:100],
        )

        # 3. Create a per-connection stream
        stream = spotter.create_stream(keywords_string)

        # 4. Audio processing loop
        while True:
            # Receive binary PCM audio
            try:
                audio_chunk = await websocket.receive_bytes()
            except ValueError:
                # Client sent text instead of bytes — ignore
                continue

            # Process in thread pool (CPU-bound)
            detected = await asyncio.to_thread(
                _process_audio_chunk, spotter, stream, audio_chunk
            )

            if detected:
                logger.info("KWS detection: '%s'", detected)
                await websocket.send_json({
                    "type": "detection",
                    "keyword": detected,
                })

    except WebSocketDisconnect:
        logger.debug("KWS client disconnected")
    except Exception:
        logger.error("KWS WebSocket error", exc_info=True)
        try:
            await websocket.close(code=1011, reason="Internal error")
        except Exception:
            pass
