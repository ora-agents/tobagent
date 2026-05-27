/**
 * Type definitions for voice features.
 */

/** Voice agent state machine states */
export type VoiceState =
  | "idle" // Not in voice mode (or KWS standby in Phase 3)
  | "listening" // ASR active, waiting for speech
  | "processing" // Message sent, waiting for agent reply
  | "speaking" // TTS reading agent reply aloud

// ============================================================================
// ASR event types (DashScope Realtime API)
// ============================================================================

export interface AsrSessionCreated {
  type: "session.created"
  session: { id: string }
}

export interface AsrSpeechStarted {
  type: "input_audio_buffer.speech_started"
}

export interface AsrSpeechStopped {
  type: "input_audio_buffer.speech_stopped"
}

export interface AsrTranscriptionDelta {
  type: "conversation.item.input_audio_transcription.delta"
  delta: string
}

export interface AsrTranscriptionCompleted {
  type: "conversation.item.input_audio_transcription.completed"
  transcript: string
}

export interface AsrError {
  type: "error"
  error: { message: string; code?: string }
}

export type AsrEvent =
  | AsrSessionCreated
  | AsrSpeechStarted
  | AsrSpeechStopped
  | AsrTranscriptionDelta
  | AsrTranscriptionCompleted
  | AsrError

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
  | TtsResponseDone
  | TtsSessionFinished
  | TtsError
