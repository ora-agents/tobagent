/**
 * Type definitions for voice features.
 */

export type { VoiceState } from "@/lib/voice/protocol"

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
