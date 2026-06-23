/**
 * Shared voice protocol contracts for web, Android WebView, and the voice
 * WebSocket proxy.
 */

import { z } from "zod"

export const VOICE_PROTOCOL_VERSION = "2026-06-22"

export const voiceStates = [
  "idle",
  "kws",
  "loading",
  "listening",
  "transcribing",
  "processing",
  "speaking",
] as const

export const nativeVoiceEventTypes = [
  "wake",
  "wake_words",
  "audio_ws",
  "voice_state",
  "asr",
  "speaker_rejected",
  "tts_start",
  "tts_audio",
  "tts_done",
  "status",
  "audio_test",
  "audio_record",
  "speaker_enrollment",
  "error",
] as const

export const nativeVoiceStateEvents = [
  "speech_start",
  "manual_asr_start",
  "listening",
  "transcribing",
  "manual_interrupt",
  "cancelled",
  "kws",
  "idle",
  "closed",
] as const

export const voiceSessionClientMessageTypes = ["config", "mode"] as const
export const voiceSessionServerMessageTypes = [
  "ready",
  "detection",
  "mode",
  "speech_start",
  "transcribing",
  "transcript",
  "speaker_rejected",
  "tts_start",
  "tts_audio",
  "tts_done",
  "error",
] as const

export const VoiceStateSchema = z.enum(voiceStates)
export const NativeVoiceEventTypeSchema = z.enum(nativeVoiceEventTypes)
export const NativeVoiceStateEventSchema = z.enum(nativeVoiceStateEvents)
export const VoiceSessionModeSchema = z.enum(["kws", "asr"])

export const VoiceTelemetryContextSchema = z.object({
  voiceSessionId: z.string().min(1),
  traceparent: z.string().min(1),
})

export const SpeakerVerificationConfigSchema = z
  .object({
    agentId: z.string().min(1),
    userId: z.string().min(1),
  })
  .strict()

const NativeVoiceEventBaseSchema = z
  .object({
    type: NativeVoiceEventTypeSchema,
    provider: z.string().optional(),
    timestamp: z.number().optional(),
    timestampMs: z.number().optional(),
    voiceSessionId: z.string().optional(),
    traceparent: z.string().optional(),
  })
  .passthrough()

const NativeSpeakerEnrollmentPayloadSchema = NativeVoiceEventBaseSchema.extend({
  type: z.literal("speaker_enrollment"),
  success: z.boolean(),
  status: z.string(),
  requestId: z.string(),
  message: z.string(),
  recordedBytes: z.number().int().nonnegative().optional(),
  result: z.unknown().optional(),
})

export const NativeVoiceEventPayloadSchema = z.discriminatedUnion("type", [
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("wake"),
    angle: z.number().optional(),
    keyword: z.string().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("wake_words"),
    count: z.number().int().nonnegative().optional(),
    keywords: z.array(z.string()).optional(),
    ignored: z.boolean().optional(),
    reason: z.string().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("audio_ws"),
    status: z.string().optional(),
    mode: VoiceSessionModeSchema.optional(),
    reason: z.string().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("voice_state"),
    state: NativeVoiceStateEventSchema.or(z.string()),
    mode: VoiceSessionModeSchema.optional(),
    reason: z.string().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("asr"),
    text: z.string(),
    isLast: z.boolean().optional(),
    mode: VoiceSessionModeSchema.optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("speaker_rejected"),
    score: z.number().optional(),
    threshold: z.number().optional(),
    reason: z.string().optional(),
    mode: VoiceSessionModeSchema.optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("tts_start"),
    purpose: z.string(),
    text: z.string().optional(),
    format: z.string().optional(),
    sample_rate: z.number().int().positive().optional(),
    sampleRate: z.number().int().positive().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("tts_audio"),
    purpose: z.string(),
    delta: z.string(),
    format: z.string().optional(),
    sample_rate: z.number().int().positive().optional(),
    sampleRate: z.number().int().positive().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("tts_done"),
    purpose: z.string(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("status"),
    status: z.string(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("audio_test"),
    success: z.boolean(),
    message: z.string(),
    audioWebSocketUrl: z.string().optional(),
  }),
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("audio_record"),
    success: z.boolean(),
    message: z.string(),
    recordedBytes: z.number().int().nonnegative().optional(),
    audioWebSocketUrl: z.string().optional(),
  }),
  NativeSpeakerEnrollmentPayloadSchema,
  NativeVoiceEventBaseSchema.extend({
    type: z.literal("error"),
    code: z.string().optional(),
    message: z.string().optional(),
    mode: VoiceSessionModeSchema.optional(),
  }),
])

export const VoiceSessionClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("config"),
      keywords: z.array(z.string()),
      ttsVoice: z.string().nullable().optional(),
      speakerVerification: SpeakerVerificationConfigSchema.nullable().optional(),
      voiceInterruptionEnabled: z.boolean().optional(),
      voiceSessionId: z.string().optional(),
      traceparent: z.string().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("mode"),
      mode: VoiceSessionModeSchema,
    })
    .passthrough(),
])

export const NativeAgentChangedPayloadSchema = z
  .object({
    agentId: z.string(),
    wakeWords: z.array(z.string()),
    ttsVoice: z.string().nullable(),
    speakerVerification: SpeakerVerificationConfigSchema.nullable(),
    voiceInterruptionEnabled: z.boolean(),
  })
  .strict()

export const NativeSpeakerEnrollmentRequestSchema = z
  .object({
    requestId: z.string().min(1),
    agentId: z.string().optional(),
    userId: z.string().optional(),
    sampleText: z.string(),
  })
  .strict()

export const NativeSpeakerEnrollmentResultSchema = z
  .object({
    audioDataUri: z.string().optional(),
    sampleText: z.string().optional(),
    enrolledAt: z.string().optional(),
  })
  .passthrough()

export const NativeSpeakerEnrollmentEventSchema =
  NativeSpeakerEnrollmentPayloadSchema.extend({
    result: NativeSpeakerEnrollmentResultSchema.optional(),
  })

export type VoiceState = z.infer<typeof VoiceStateSchema>
export type VoiceSessionMode = z.infer<typeof VoiceSessionModeSchema>
export type SpeakerVerificationConfig = z.infer<typeof SpeakerVerificationConfigSchema>
export type NativeVoiceEventPayload = z.infer<typeof NativeVoiceEventPayloadSchema>
export type VoiceTelemetryContext = z.infer<typeof VoiceTelemetryContextSchema>
export type VoiceSessionClientMessage = z.infer<typeof VoiceSessionClientMessageSchema>
export type NativeAgentChangedPayload = z.infer<typeof NativeAgentChangedPayloadSchema>
export type NativeSpeakerEnrollmentRequest = z.infer<
  typeof NativeSpeakerEnrollmentRequestSchema
>
export type NativeSpeakerEnrollmentEvent = z.infer<
  typeof NativeSpeakerEnrollmentEventSchema
>

export interface TobNativeVoiceBridgeApi {
  updateWakeWords?: (wakeWordsJson: string) => void
  onAgentChanged?: (
    agentId: string,
    wakeWordsJson: string,
    ttsVoice: string,
    speakerVerificationJson: string,
    voiceInterruptionEnabled: boolean,
  ) => void
  startManualAsr?: () => string
  startAsr?: () => string
  onManualMicClick?: () => string
  exitVoiceMode?: () => string
  stopVoice?: () => string
  stopAsr?: () => string
  returnToKws?: () => string
  configureTelemetry?: (telemetryJson: string) => string
  syncVoiceState?: (state: string) => string
  startSpeakerEnrollment?: (requestJson: string) => string
  stopSpeakerEnrollment?: (requestId: string) => string
}

export interface UnifiedNativeVoiceBridgeApi {
  updateWakeWords?: (wakeWords: string[]) => void
  onAgentChanged?: (
    agentId: string,
    wakeWords: string[],
    ttsVoice: string | null,
    speakerVerification: SpeakerVerificationConfig | null,
    voiceInterruptionEnabled: boolean,
  ) => void
  startManualAsr?: () => string
  startAsr?: () => string
  onManualMicClick?: () => string
  exitVoiceMode?: () => string
  stopVoice?: () => string
  stopAsr?: () => string
  returnToKws?: () => string
  configureTelemetry?: (telemetry: VoiceTelemetryContext) => string
  syncVoiceState?: (state: VoiceState) => string
  startSpeakerEnrollment?: (request: NativeSpeakerEnrollmentRequest) => string
  stopSpeakerEnrollment?: (requestId: string) => string
}

export const nativeVoiceEventFixtures = [
  {
    type: "audio_ws",
    provider: "backend_ws",
    status: "ready",
    mode: "kws",
    timestamp: 1_782_042_000_000,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "wake",
    provider: "backend_kws",
    keyword: "小梯小梯",
    angle: 90,
    timestamp: 1_782_042_000_250,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "voice_state",
    provider: "backend_ws",
    state: "speech_start",
    mode: "asr",
    timestamp: 1_782_042_000_700,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "voice_state",
    provider: "backend_ws",
    state: "transcribing",
    mode: "asr",
    timestamp: 1_782_042_001_800,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "asr",
    provider: "backend_ws",
    text: "帮我介绍一下产品配置",
    isLast: true,
    mode: "asr",
    timestamp: 1_782_042_002_100,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "tts_audio",
    provider: "backend_ws",
    purpose: "wake_ack",
    format: "pcm",
    sample_rate: 24000,
    delta: "AAAA",
    timestamp: 1_782_042_002_400,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "tts_done",
    provider: "backend_ws",
    purpose: "wake_ack",
    timestamp: 1_782_042_002_700,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "speaker_rejected",
    provider: "backend_ws",
    mode: "asr",
    score: 0.42,
    threshold: 0.7,
    reason: "Voiceprint did not match",
    timestamp: 1_782_042_003_000,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "status",
    provider: "csj_sdk",
    status: "started",
    timestamp: 1_782_042_003_100,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "speaker_enrollment",
    provider: "csj_sdk",
    success: true,
    status: "ok",
    requestId: "speaker-enroll-fixture",
    message: "Speaker enrollment completed",
    recordedBytes: 128000,
    timestamp: 1_782_042_003_200,
  },
  {
    type: "error",
    provider: "backend_ws",
    code: "native_audio_backend_error",
    message: "ASR transcription failed",
    timestamp: 1_782_042_003_300,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
] as const satisfies readonly NativeVoiceEventPayload[]

export const voiceSessionClientMessageFixtures = [
  {
    type: "config",
    keywords: ["小梯小梯", "hey assistant"],
    ttsVoice: "Cherry",
    speakerVerification: {
      agentId: "agent-fixture",
      userId: "user-fixture",
    },
    voiceInterruptionEnabled: false,
    voiceSessionId: "voice-fixture-1",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  },
  {
    type: "mode",
    mode: "asr",
  },
] as const satisfies readonly VoiceSessionClientMessage[]

export const parseNativeVoiceEventPayload = (
  detail: unknown,
): NativeVoiceEventPayload | null => {
  const payload = typeof detail === "string" ? safeParseJson(detail) : detail
  const parsed = NativeVoiceEventPayloadSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

export const parseNativeSpeakerEnrollmentEvent = (
  detail: unknown,
): NativeSpeakerEnrollmentEvent | null => {
  const payload = typeof detail === "string" ? safeParseJson(detail) : detail
  const parsed = NativeSpeakerEnrollmentEventSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
