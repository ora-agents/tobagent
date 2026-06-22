"use client"

import { useCallback, useRef, useState } from "react"
import {
  parseNativeSpeakerEnrollmentEvent,
  type NativeSpeakerEnrollmentEvent,
  type NativeSpeakerEnrollmentRequest,
} from "@/lib/voice/protocol"
import { int16PcmToWavDataUri } from "@/lib/voice/utils/audio-encoder"
import { isAndroidWebView } from "@/lib/voice/utils/browser"

/** Audio MIME types accepted for voiceprint upload. */
const SPEAKER_AUDIO_ACCEPT = "audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.webm,.flac"
const SPEAKER_AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".webm", ".flac"]

/** Minimum recording duration in seconds. */
const MIN_RECORDING_SECONDS = 2
/** Maximum recording/upload duration in seconds. */
const MAX_RECORDING_SECONDS = 100

export { SPEAKER_AUDIO_ACCEPT }

// ---------------------------------------------------------------------------
// Native bridge types
// ---------------------------------------------------------------------------

interface NativeSpeakerBridge {
  start: (request: NativeSpeakerEnrollmentRequest) => void
  stop: (requestId: string) => void
}

// ---------------------------------------------------------------------------
// Native bridge helpers
// ---------------------------------------------------------------------------

function getNativeSpeakerEnrollmentBridge(): NativeSpeakerBridge | null {
  if (typeof window === "undefined" || !isAndroidWebView()) return null
  const nativeVoice = window.__TOB_NATIVE_VOICE__
  const startNativeEnrollment = nativeVoice?.startSpeakerEnrollment
  const stopNativeEnrollment = nativeVoice?.stopSpeakerEnrollment
  if (startNativeEnrollment && stopNativeEnrollment) {
    return {
      start: (req) => startNativeEnrollment(req),
      stop: (requestId) => stopNativeEnrollment(requestId),
    }
  }
  const tobNativeVoice = window.TobNativeVoice
  const startTobEnrollment = tobNativeVoice?.startSpeakerEnrollment
  const stopTobEnrollment = tobNativeVoice?.stopSpeakerEnrollment
  if (startTobEnrollment && stopTobEnrollment) {
    return {
      start: (req) => startTobEnrollment(JSON.stringify(req)),
      stop: (requestId) => stopTobEnrollment(requestId),
    }
  }
  return null
}

function waitForNativeSpeakerEnrollment(requestId: string): Promise<NativeSpeakerEnrollmentEvent> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("nativeVoiceEvent", handleEvent)
      reject(new Error("Native voiceprint binding timed out"))
    }, 150_000)

    const handleEvent = (event: Event) => {
      const payload = parseNativeSpeakerEnrollmentEvent(
        (event as CustomEvent<unknown>).detail,
      )
      if (!payload || payload.type !== "speaker_enrollment" || payload.requestId !== requestId) return
      if (payload.status !== "bound" && payload.status !== "failed") return
      window.clearTimeout(timeout)
      window.removeEventListener("nativeVoiceEvent", handleEvent)
      if (payload.success && payload.status === "bound") {
        resolve(payload)
      } else {
        reject(new Error(typeof payload.message === "string" ? payload.message : "Native voiceprint binding failed"))
      }
    }

    window.addEventListener("nativeVoiceEvent", handleEvent)
  })
}

// ---------------------------------------------------------------------------
// Audio file → WAV data URI
// ---------------------------------------------------------------------------

/**
 * Decode an arbitrary audio file to PCM Int16 and re-encode as a WAV data URI.
 */
export async function audioFileToWavDataUri(file: File): Promise<string> {
  const fileName = file.name.toLowerCase()
  const isAudioFile =
    file.type.startsWith("audio/") ||
    SPEAKER_AUDIO_EXTENSIONS.some((ext) => fileName.endsWith(ext))
  if (!isAudioFile) {
    throw new Error("Unsupported audio file type")
  }

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioContextCtor) {
    throw new Error("Audio decoding is not supported in this browser")
  }

  const context = new AudioContextCtor()
  try {
    const arrayBuffer = await file.arrayBuffer()
    const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
    if (audioBuffer.duration > MAX_RECORDING_SECONDS) {
      throw new Error(`Audio is too long. Please keep it within ${MAX_RECORDING_SECONDS} seconds.`)
    }
    const channelCount = audioBuffer.numberOfChannels
    const frameCount = audioBuffer.length
    const pcm = new Int16Array(frameCount)

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      let mixedSample = 0
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
        mixedSample += audioBuffer.getChannelData(channelIndex)[frameIndex] || 0
      }
      const sample = Math.max(-1, Math.min(1, mixedSample / Math.max(channelCount, 1)))
      pcm[frameIndex] = sample < 0 ? sample * 32768 : sample * 32767
    }

    return int16PcmToWavDataUri(pcm, audioBuffer.sampleRate)
  } finally {
    await context.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseVoiceprintRecorderOptions {
  /** Language for status messages. */
  locale: "zh" | "en"
  /**
   * Called with the WAV data URI after recording or upload completes.
   * The caller is responsible for the actual enrollment API call.
   */
  onAudioReady: (audioDataUri: string) => Promise<void>
  /**
   * Optional agent/user ID passed to the native enrollment bridge.
   */
  agentId?: string
  userId?: string
  /** The sample text the user should read aloud. */
  sampleText: string
}

interface RecorderState {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  chunks: Int16Array[]
}

export interface UseVoiceprintRecorderReturn {
  isRecording: boolean
  isProcessing: boolean
  status: string | null
  audioInputRef: React.RefObject<HTMLInputElement>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  handleAudioUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  /** Whether a native (Android WebView) enrollment bridge is available. */
  hasNativeBridge: boolean
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useVoiceprintRecorder({
  locale,
  onAudioReady,
  agentId,
  userId,
  sampleText,
}: UseVoiceprintRecorderOptions): UseVoiceprintRecorderReturn {
  const zh = locale === "zh"
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const audioInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<RecorderState | null>(null)
  const recordingModeRef = useRef<"web" | "native" | null>(null)
  const nativeRequestIdRef = useRef<string | null>(null)
  const maxRecordingTimerRef = useRef<number | null>(null)

  const clearMaxRecordingTimer = useCallback(() => {
    if (maxRecordingTimerRef.current === null) return
    window.clearTimeout(maxRecordingTimerRef.current)
    maxRecordingTimerRef.current = null
  }, [])

  // ---- Stop recording ----
  const stopRecording = useCallback(async () => {
    clearMaxRecordingTimer()

    if (recordingModeRef.current === "native") {
      const requestId = nativeRequestIdRef.current
      const bridge = getNativeSpeakerEnrollmentBridge()
      if (!requestId || !bridge) {
        setIsRecording(false)
        setIsProcessing(false)
        recordingModeRef.current = null
        nativeRequestIdRef.current = null
        return
      }

      setIsRecording(false)
      setIsProcessing(true)
      setStatus(zh ? "正在生成声纹..." : "Creating voiceprint...")
      try {
        const resultPromise = waitForNativeSpeakerEnrollment(requestId)
        bridge.stop(requestId)
        const result = await resultPromise
        const audioDataUri = result.result?.audioDataUri
        if (typeof audioDataUri !== "string" || !audioDataUri.startsWith("data:audio/")) {
          throw new Error("Native voiceprint recording did not return audio")
        }
        await onAudioReady(audioDataUri)
        setStatus(zh ? "声纹已录制。" : "Voiceprint recorded.")
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setStatus(`${zh ? "声纹录制失败" : "Voiceprint recording failed"}: ${message}`)
      } finally {
        setIsRecording(false)
        setIsProcessing(false)
        recordingModeRef.current = null
        nativeRequestIdRef.current = null
      }
      return
    }

    const recorder = recorderRef.current
    if (!recorder) return

    recorderRef.current = null
    recordingModeRef.current = null
    setIsRecording(false)
    setIsProcessing(true)

    try {
      const sampleRate = recorder.context.sampleRate
      recorder.processor.disconnect()
      recorder.source.disconnect()
      recorder.stream.getTracks().forEach((track) => track.stop())
      await recorder.context.close().catch(() => {})

      const totalLength = recorder.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const pcm = new Int16Array(totalLength)
      let offset = 0
      for (const chunk of recorder.chunks) {
        pcm.set(chunk, offset)
        offset += chunk.length
      }

      if (pcm.length < sampleRate * MIN_RECORDING_SECONDS) {
        setStatus(zh ? `录音太短，请至少朗读 ${MIN_RECORDING_SECONDS} 秒。` : `Recording is too short. Please read for at least ${MIN_RECORDING_SECONDS} seconds.`)
        return
      }

      setStatus(zh ? "正在生成声纹..." : "Creating voiceprint...")
      await onAudioReady(int16PcmToWavDataUri(pcm, sampleRate))
    } finally {
      setIsRecording(false)
      setIsProcessing(false)
    }
  }, [zh, onAudioReady, clearMaxRecordingTimer])

  // ---- Start recording ----
  const startRecording = useCallback(async () => {
    clearMaxRecordingTimer()

    // Try native bridge first
    const nativeBridge = getNativeSpeakerEnrollmentBridge()
    if (nativeBridge) {
      try {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        nativeBridge.start({
          requestId,
          agentId,
          userId,
          sampleText,
        })
        nativeRequestIdRef.current = requestId
        recordingModeRef.current = "native"
        maxRecordingTimerRef.current = window.setTimeout(() => {
          setStatus(zh ? `已达到 ${MAX_RECORDING_SECONDS} 秒上限，正在停止录音...` : `Reached the ${MAX_RECORDING_SECONDS} second limit. Stopping recording...`)
          void stopRecording()
        }, MAX_RECORDING_SECONDS * 1000)
        setIsRecording(true)
        setStatus(zh ? `正在录音，请连续朗读指定文本至少 2 秒，最多 ${MAX_RECORDING_SECONDS} 秒。` : `Recording. Please read the sample text continuously for at least 2 seconds and at most ${MAX_RECORDING_SECONDS} seconds.`)
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setStatus(`${zh ? "无法开始原生录音" : "Cannot start native recording"}: ${message}`)
        return
      }
    }

    // Web recording via getUserMedia + ScriptProcessorNode
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      const context = new AudioContextCtor({ sampleRate: 16000 })
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const chunks: Int16Array[] = []

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const chunk = new Int16Array(input.length)
        for (let i = 0; i < input.length; i++) {
          const sample = Math.max(-1, Math.min(1, input[i]))
          chunk[i] = sample < 0 ? sample * 32768 : sample * 32767
        }
        chunks.push(chunk)
      }

      source.connect(processor)
      processor.connect(context.destination)
      recorderRef.current = { stream, context, source, processor, chunks }
      recordingModeRef.current = "web"
      maxRecordingTimerRef.current = window.setTimeout(() => {
        setStatus(zh ? `已达到 ${MAX_RECORDING_SECONDS} 秒上限，正在停止录音...` : `Reached the ${MAX_RECORDING_SECONDS} second limit. Stopping recording...`)
        void stopRecording()
      }, MAX_RECORDING_SECONDS * 1000)
      setIsRecording(true)
      setStatus(zh ? `正在录音，请连续朗读指定文本至少 2 秒，最多 ${MAX_RECORDING_SECONDS} 秒。` : `Recording. Please read the sample text continuously for at least 2 seconds and at most ${MAX_RECORDING_SECONDS} seconds.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(`${zh ? "无法开始录音" : "Cannot start recording"}: ${message}`)
    }
  }, [zh, agentId, userId, sampleText, stopRecording, clearMaxRecordingTimer])

  // ---- Audio file upload ----
  const handleAudioUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ""
      if (!file) return

      try {
        setIsProcessing(true)
        setStatus(zh ? "正在读取音频文件..." : "Reading audio file...")
        const audioDataUri = await audioFileToWavDataUri(file)
        await onAudioReady(audioDataUri)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setStatus(`${zh ? "音频文件无法用于声纹绑定" : "Audio file cannot be used for voiceprint binding"}: ${message}`)
      } finally {
        setIsProcessing(false)
      }
    },
    [zh, onAudioReady],
  )

  const hasNativeBridge = typeof window !== "undefined" && getNativeSpeakerEnrollmentBridge() !== null

  return {
    isRecording,
    isProcessing,
    status,
    audioInputRef,
    startRecording,
    stopRecording,
    handleAudioUpload,
    hasNativeBridge,
  }
}
