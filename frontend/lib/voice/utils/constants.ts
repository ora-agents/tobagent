/**
 * Constants for voice features.
 */

/** ASR API expects 16kHz audio input */
export const ASR_SAMPLE_RATE = 16000

/** TTS API outputs 24kHz audio */
export const TTS_SAMPLE_RATE = 24000

/** WebSocket path for ASR proxy (appended to LANGGRAPH_API_URL) */
export const ASR_WS_PATH = "/ws/voice/asr"

/** WebSocket path for TTS proxy (appended to LANGGRAPH_API_URL) */
export const TTS_WS_PATH = "/ws/voice/tts"

/** Default ASR model */
export const DEFAULT_ASR_MODEL = "qwen3-asr-flash-realtime-2026-02-10"

/** Default TTS model */
export const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash-realtime"

/** Default TTS voice */
export const DEFAULT_TTS_VOICE = "Cherry"

/** Server VAD silence duration in ms */
export const VAD_SILENCE_DURATION_MS = 800

/** Server VAD detection threshold (lower = more sensitive) */
export const VAD_THRESHOLD = 0.2

/** Voice mode inactivity timeout (ms) before returning to idle */
export const VOICE_IDLE_TIMEOUT_MS = 30000
