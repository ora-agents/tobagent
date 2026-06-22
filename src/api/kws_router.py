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
import json
import logging
import os

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

kws_router = APIRouter(tags=["voice"])
KWS_SAMPLE_RATE = 16000
MAX_PCM_CHUNK_SECONDS = float(os.environ.get("VOICE_MAX_PCM_CHUNK_SECONDS", "5"))
MAX_PCM_CHUNK_BYTES = int(KWS_SAMPLE_RATE * 2 * MAX_PCM_CHUNK_SECONDS)


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
    if len(audio_bytes) % 2 != 0:
        logger.warning("Dropped malformed KWS PCM chunk with odd byte length: %d", len(audio_bytes))
        return None
    if len(audio_bytes) > MAX_PCM_CHUNK_BYTES:
        logger.warning(
            "Dropped oversized KWS PCM chunk: bytes=%d max_bytes=%d",
            len(audio_bytes),
            MAX_PCM_CHUNK_BYTES,
        )
        return None

    # Convert Int16 bytes to float32 numpy array [-1, 1]
    samples_int16 = np.frombuffer(audio_bytes, dtype=np.int16)
    if len(samples_int16) == 0:
        return None

    samples_float32 = samples_int16.astype(np.float32) / 32768.0

    # Feed audio to the stream
    stream.accept_waveform(KWS_SAMPLE_RATE, samples_float32)

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


async def _create_keyword_stream(
    spotter,
    keyword_processor,
    keywords_list: list[str],
):
    """Create a KWS stream for the provided wake words."""
    if not keywords_list:
        return None, None

    keywords_string = None
    if keyword_processor:
        keywords_string = await asyncio.to_thread(
            keyword_processor.format_keywords, keywords_list
        )

    if not keywords_string:
        return None, None

    stream = await asyncio.to_thread(spotter.create_stream, keywords_string)
    return stream, keywords_string


@kws_router.websocket(
    "/ws/voice/kws",
    name="Voice keyword spotting stream",
)
async def kws_websocket(websocket: WebSocket) -> None:
    """KWS WebSocket endpoint for always-on wake word detection."""
    await websocket.accept()

    # Check if KWS is available
    spotter = getattr(websocket.app.state, "kws_spotter", None)
    keyword_processor = getattr(websocket.app.state, "kws_processor", None)

    if spotter is None:
        loading_task = getattr(websocket.app.state, "kws_loading_task", None)
        if loading_task and not loading_task.done():
            logger.info("KWS WebSocket rejected: model is still loading")
            await websocket.send_json({
                "type": "error",
                "message": "KWS model is still loading on server",
            })
            await websocket.close(code=1013, reason="KWS model is loading")
            return

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
        stream, keywords_string = await _create_keyword_stream(
            spotter, keyword_processor, keywords_list
        )

        if stream is None or not keywords_string:
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

        # 3. Audio processing loop. Text config messages can update wake words
        # without forcing the browser to release and reopen the microphone.
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect

            if "bytes" in message and message["bytes"] is not None:
                detected = await asyncio.to_thread(
                    _process_audio_chunk, spotter, stream, message["bytes"]
                )

                if detected:
                    logger.info("KWS detection: '%s'", detected)
                    await websocket.send_json({
                        "type": "detection",
                        "keyword": detected,
                    })
                continue

            if "text" not in message or message["text"] is None:
                continue

            try:
                update_msg = json.loads(message["text"])
            except json.JSONDecodeError:
                continue

            if update_msg.get("type") != "config":
                continue

            next_keywords = update_msg.get("keywords", [])
            next_stream, next_keywords_string = await _create_keyword_stream(
                spotter, keyword_processor, next_keywords
            )
            if next_stream is None or not next_keywords_string:
                await websocket.send_json({
                    "type": "error",
                    "message": "Failed to process updated keywords",
                })
                continue

            keywords_list = next_keywords
            stream = next_stream
            logger.info(
                "KWS session updated: keywords=%s, formatted=%s",
                keywords_list,
                next_keywords_string[:100],
            )

    except WebSocketDisconnect:
        logger.debug("KWS client disconnected")
    except Exception:
        logger.error("KWS WebSocket error", exc_info=True)
        try:
            await websocket.close(code=1011, reason="Internal error")
        except Exception:
            pass
