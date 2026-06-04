/**
 * Cloud Voice Input Hook
 *
 * Provides speech-to-text using client-side VAD (sherpa-onnx) and
 * REST ASR (qwen3-asr-flash). Captures audio via AudioWorklet,
 * detects speech locally, and sends complete utterances to the backend
 * for transcription.
 *
 * Replaces the previous WebSocket-based cloud voice input.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { AsrClient } from "@/lib/voice/asr-client"
import { VadManager, preloadSherpaOnnxModule, type SpeechSegment } from "@/lib/voice/vad"
import { getAudioContextConstructor, getVoiceSupportError, isVoiceSupported } from "@/lib/voice/utils/browser"

// ============================================================================
// Types
// ============================================================================

interface UseCloudVoiceInputOptions {
  /** Called with finalized transcript text (auto-send candidate) */
  onTranscript: (text: string) => void
  /** Called with interim results for real-time display (unused with REST ASR) */
  onInterimResult?: (text: string) => void
  /** Called when VAD state changes (user starts/stops speaking) */
  onVadStateChange?: (isSpeaking: boolean) => void
}

export interface UseCloudVoiceInputReturn {
  /** Whether audio capture is active */
  isListening: boolean
  /** Whether the browser supports required APIs */
  isSupported: boolean
  /** Whether ASR client is ready */
  isConnected: boolean
  /** Whether VAD WASM is loading */
  isLoading: boolean
  /** Current error message, if any */
  error: string | null
  /** Start listening (requests mic permission if needed) */
  startListening: () => void
  /** Stop listening and disconnect */
  stopListening: () => void
  /** Toggle listening state */
  toggleListening: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Path to AudioWorklet processor (must be in public/ directory) */
const WORKLET_PATH = "/voice/audio-processor.worklet.js"

// ============================================================================
// Hook
// ============================================================================

export function useCloudVoiceInput({
  onTranscript,
  onInterimResult,
  onVadStateChange,
}: UseCloudVoiceInputOptions): UseCloudVoiceInputReturn {
  const [isListening, setIsListening] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Start as false to match SSR; detect support after hydration to avoid mismatch
  const [isSupported, setIsSupported] = useState(false)
  useEffect(() => {
    setIsSupported(isVoiceSupported())
  }, [])

  useEffect(() => {
    if (isSupported) {
      preloadSherpaOnnxModule()
    }
  }, [isSupported])

  // Refs for cleanup
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const asrClientRef = useRef<AsrClient | null>(null)
  const vadManagerRef = useRef<VadManager | null>(null)

  // Use refs for callbacks to avoid recreating clients on every render
  const onTranscriptRef = useRef(onTranscript)
  const onInterimResultRef = useRef(onInterimResult)
  const onVadStateChangeRef = useRef(onVadStateChange)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onInterimResultRef.current = onInterimResult
    onVadStateChangeRef.current = onVadStateChange
  }, [onTranscript, onInterimResult, onVadStateChange])

  /** Clean up all resources */
  const cleanup = useCallback(() => {
    // Dispose VAD
    if (vadManagerRef.current) {
      vadManagerRef.current.dispose()
      vadManagerRef.current = null
    }

    // Disconnect worklet
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "stop" })
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }

    // Close AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    // Stop media stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    // Disconnect ASR client
    if (asrClientRef.current) {
      asrClientRef.current.disconnect()
      asrClientRef.current = null
    }

    setIsListening(false)
    setIsConnected(false)
    setIsLoading(false)
  }, [])

  const startListening = useCallback(async () => {
    if (isListening || isLoading) return
    if (!isSupported) {
      setError(getVoiceSupportError() || "Voice input is not supported in this browser")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // 1. Get microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      mediaStreamRef.current = stream

      // 2. Create AudioContext
      const AudioContextCtor = getAudioContextConstructor()
      if (!AudioContextCtor) {
        throw new Error("Voice input is not supported in this browser")
      }
      const audioContext = new AudioContextCtor()
      audioContextRef.current = audioContext

      // 3. Load AudioWorklet module
      await audioContext.audioWorklet.addModule(WORKLET_PATH)

      // 4. Create worklet node
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-processor",
      )
      workletNodeRef.current = workletNode

      // 5. Create ASR client (HTTP-based)
      const asrClient = new AsrClient({
        onConnected: () => {
          setIsConnected(true)
        },
        onDisconnected: () => {
          setIsConnected(false)
        },
        onTranscript: (text, _isFinal) => {
          onTranscriptRef.current?.(text)
        },
        onError: (errMsg) => {
          setError(errMsg)
        },
      })
      asrClientRef.current = asrClient
      await asrClient.connect()

      // 6. Initialize VAD (lazy-loads WASM)
      const vadManager = new VadManager({
        onSpeechStart: () => {
          onVadStateChangeRef.current?.(true)
        },
        onSpeechEnd: async (segment: SpeechSegment) => {
          onVadStateChangeRef.current?.(false)
          if (asrClientRef.current) {
            await asrClientRef.current.transcribeSegment(segment.pcmInt16)
          }
        },
        onError: (errMsg) => {
          console.error("[VAD]", errMsg)
          setError(errMsg)
        },
      })

      await vadManager.init()
      vadManagerRef.current = vadManager

      // 7. Wire audio pipeline: mic -> worklet -> (messages to main thread)
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)
      // Don't connect to destination (we don't want to hear ourselves)

      // 8. Handle audio frames from worklet → feed to VAD
      workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === "audio" && vadManagerRef.current) {
          const float32 = new Float32Array(event.data.float32)
          const int16 = new Int16Array(event.data.int16)
          vadManagerRef.current.processAudio(float32, int16)
        }
      }

      // 9. Start processing
      workletNode.port.postMessage({ type: "start" })
      setIsLoading(false)
      setIsListening(true)
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone access."
          : err instanceof Error
            ? err.message
            : "Failed to start voice input"
      setError(msg)
      setIsLoading(false)
      cleanup()
    }
  }, [isListening, isLoading, isSupported, cleanup])

  const stopListening = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleListening = useCallback(() => {
    if (isListening || isLoading) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, isLoading, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    isListening,
    isSupported,
    isConnected,
    isLoading,
    error,
    startListening,
    stopListening,
    toggleListening,
  }
}
