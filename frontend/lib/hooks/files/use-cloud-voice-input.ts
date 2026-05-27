/**
 * Cloud Voice Input Hook
 *
 * Provides speech-to-text using DashScope Realtime ASR via WebSocket proxy.
 * Captures audio via AudioWorklet, sends to backend proxy, receives
 * transcription with Server VAD (server-side voice activity detection).
 *
 * Replaces the Web Speech API-based useVoiceInput for better Chinese
 * recognition and consistent cross-browser behavior.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { AsrClient } from "@/lib/voice/asr-client"
import { pcmBufferToBase64 } from "@/lib/voice/utils/audio"

// ============================================================================
// Types
// ============================================================================

interface UseCloudVoiceInputOptions {
  /** Called with finalized transcript text (auto-send candidate) */
  onTranscript: (text: string) => void
  /** Called with interim results for real-time display */
  onInterimResult?: (text: string) => void
  /** Called when VAD state changes (user starts/stops speaking) */
  onVadStateChange?: (isSpeaking: boolean) => void
}

export interface UseCloudVoiceInputReturn {
  /** Whether audio capture is active */
  isListening: boolean
  /** Whether the browser supports required APIs */
  isSupported: boolean
  /** Whether ASR WebSocket is connected */
  isConnected: boolean
  /** Whether connection is being established */
  isConnecting: boolean
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
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Start as false to match SSR; detect support after hydration to avoid mismatch
  const [isSupported, setIsSupported] = useState(false)
  useEffect(() => {
    setIsSupported(
      !!(
        window.AudioContext &&
        navigator.mediaDevices &&
        window.WebSocket
      )
    )
  }, [])

  // Refs for cleanup
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const asrClientRef = useRef<AsrClient | null>(null)

  // Use refs for callbacks to avoid recreating AsrClient on every render
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
    setIsConnecting(false)
  }, [])

  const startListening = useCallback(async () => {
    if (isListening || isConnecting) return
    if (!isSupported) {
      setError("Voice input is not supported in this browser")
      return
    }

    setIsConnecting(true)
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
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      // 3. Load AudioWorklet module
      await audioContext.audioWorklet.addModule(WORKLET_PATH)

      // 4. Create worklet node
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-processor",
      )
      workletNodeRef.current = workletNode

      // 5. Create ASR client with callbacks
      const asrClient = new AsrClient({
        onConnected: () => {
          setIsConnected(true)
          setIsConnecting(false)
          setIsListening(true)
        },
        onDisconnected: () => {
          setIsConnected(false)
          setIsListening(false)
        },
        onSpeechStarted: () => {
          onVadStateChangeRef.current?.(true)
        },
        onSpeechEnded: () => {
          onVadStateChangeRef.current?.(false)
        },
        onTranscript: (text, isFinal) => {
          if (isFinal) {
            onTranscriptRef.current?.(text)
          } else {
            onInterimResultRef.current?.(text)
          }
        },
        onError: (errMsg) => {
          setError(errMsg)
          cleanup()
        },
      })
      asrClientRef.current = asrClient

      // 6. Connect ASR WebSocket
      await asrClient.connect()

      // 7. Wire audio pipeline: mic -> worklet -> (messages to main thread)
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)
      // Don't connect to destination (we don't want to hear ourselves)

      // 8. Handle audio frames from worklet
      workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === "audio" && asrClient.isConnected) {
          const base64 = pcmBufferToBase64(event.data.buffer)
          asrClient.sendAudio(base64)
        }
      }

      // 9. Start processing
      workletNode.port.postMessage({ type: "start" })
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone access."
          : err instanceof Error
            ? err.message
            : "Failed to start voice input"
      setError(msg)
      setIsConnecting(false)
      cleanup()
    }
  }, [isListening, isConnecting, isSupported, cleanup])

  const stopListening = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleListening = useCallback(() => {
    if (isListening || isConnecting) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, isConnecting, startListening, stopListening])

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
    isConnecting,
    error,
    startListening,
    stopListening,
    toggleListening,
  }
}
