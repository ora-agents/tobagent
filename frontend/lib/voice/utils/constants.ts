/**
 * Constants for voice features.
 */

/** ASR API expects 16kHz audio input */
export const ASR_SAMPLE_RATE = 16000

/** TTS API outputs 24kHz audio */
export const TTS_SAMPLE_RATE = 24000

/** WebSocket path for TTS proxy (appended to LANGGRAPH_API_URL) */
export const TTS_WS_PATH = "/ws/voice/tts"

/** REST API path for ASR transcription */
export const ASR_REST_PATH = "/api/asr/transcribe"

/** Default TTS model */
export const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash-realtime"

/** Default TTS voice */
export const DEFAULT_TTS_VOICE = "Cherry"

/** Voice mode inactivity timeout (ms) before returning to idle */
export const VOICE_IDLE_TIMEOUT_MS = 30000

// ============================================================================
// Client-side VAD (sherpa-onnx / Silero VAD) configuration
// ============================================================================

/** Path to sherpa-onnx WASM resources in public/ */
export const SHERPA_ONNX_BASE_PATH =
  "/sherpa-onnx-wasm-simd-1.13.2-vad-asr-zh-zipformer_wenetspeech"

/** VAD window size in samples (32ms at 16kHz) */
export const VAD_WINDOW_SIZE = 512

/** VAD sample rate (Hz) */
export const VAD_SAMPLE_RATE = 16000

/** VAD detection threshold (lower = more sensitive) */
export const VAD_THRESHOLD = 0.5

/** Minimum silence duration (seconds) before VAD declares speech ended */
export const VAD_MIN_SILENCE_DURATION = 0.5

/** Minimum speech duration (seconds) to accept as real speech */
export const VAD_MIN_SPEECH_DURATION = 0.25
