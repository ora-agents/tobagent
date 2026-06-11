/**
 * Constants for voice features.
 */

/** ASR API expects 16kHz audio input */
export const ASR_SAMPLE_RATE = 16000

/** TTS API outputs 24kHz audio */
export const TTS_SAMPLE_RATE = 24000

/** WebSocket path for TTS proxy (appended to LANGGRAPH_API_URL) */
export const TTS_WS_PATH = "/ws/voice/tts"

/** WebSocket path for KWS (Keyword Spotting) endpoint */
export const KWS_WS_PATH = "/ws/voice/kws"

/** Unified WebSocket path for KWS + backend VAD + ASR */
export const VOICE_SESSION_WS_PATH = "/ws/voice/session"

/** REST API path for speaker verification */
export const SPEAKER_VERIFY_REST_PATH = "/api/speaker-profiles/verify"

/** Default TTS model */
export const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash-realtime"

/** Default TTS voice */
export const DEFAULT_TTS_VOICE = "Cherry"

/** Voice mode inactivity timeout (ms) before returning to idle */
export const VOICE_IDLE_TIMEOUT_MS = 20000

