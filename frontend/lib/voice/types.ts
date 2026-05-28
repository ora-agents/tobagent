/**
 * Type definitions for voice features.
 */

/** Voice agent state machine states */
export type VoiceState =
  | "idle" // Not in voice mode
  | "loading" // WASM model downloading / initializing
  | "listening" // ASR active, waiting for speech
  | "processing" // Message sent, waiting for agent reply
  | "speaking" // TTS reading agent reply aloud

// ============================================================================
// TTS event types (DashScope Realtime API)
// ============================================================================

export interface TtsSessionCreated {
  type: "session.created"
  session: { id: string }
}

export interface TtsAudioDelta {
  type: "response.audio.delta"
  delta: string // Base64 PCM 24kHz 16-bit
  response_id?: string
}

export interface TtsAudioDone {
  type: "response.audio.done"
  response_id?: string
}

export interface TtsResponseDone {
  type: "response.done"
  response_id?: string
}

export interface TtsSessionFinished {
  type: "session.finished"
}

export interface TtsError {
  type: "error"
  error: { message: string; code?: string }
}

export type TtsEvent =
  | TtsSessionCreated
  | TtsAudioDelta
  | TtsAudioDone
  | TtsResponseDone
  | TtsSessionFinished
  | TtsError
