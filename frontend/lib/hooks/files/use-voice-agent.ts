/**
 * Voice Agent Hook
 *
 * Orchestrates the complete voice agent experience:
 * - Backend VAD + ASR for speech detection and transcription
 * - Cloud TTS for agent reply playback (via WebSocket proxy)
 * - Backend KWS (sherpa-onnx) for always-on wake word detection
 * - Android WebView native voice provider when ?native_voice_provider=csj_sdk
 * - State machine: idle/kws -> loading -> listening -> processing -> speaking -> loop
 * - Interruption: user can speak during TTS to interrupt the agent
 * - Auto-send: ASR final transcript is sent automatically
 * - Timeout: returns to kws (or idle) after 30s of inactivity
 *
 * In web mode the browser streams 16kHz Int16 PCM and VAD runs on the backend.
 * In Android WebView native mode the app listens for `nativeVoiceEvent`.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { StreamingAsrClient } from "@/lib/voice/asr-stream-client"
import { TtsClient } from "@/lib/voice/tts-client"
import { TtsPlayer } from "@/lib/voice/tts-player"
import { KwsClient } from "@/lib/voice/kws/kws-client"
import type { VoiceState } from "@/lib/voice/types"
import { VOICE_IDLE_TIMEOUT_MS } from "@/lib/voice/utils/constants"
import { getAudioContextConstructor, getVoiceSupportError, isVoiceSupported } from "@/lib/voice/utils/browser"

// ============================================================================
// Types
// ============================================================================

interface UseVoiceAgentOptions {
  /** Send a text message to the agent */
  onSendMessage: (text: string) => void
  /** Interrupt the current agent response */
  onInterrupt: () => void
  /** Called with interim ASR transcript for real-time display in input box */
  onInterimTranscript?: (text: string) => void
  /** Wake words for always-on KWS detection (empty = KWS disabled) */
  wakeWords?: string[]
  /** DashScope TTS voice id used for spoken replies */
  ttsVoice?: string | null
}

export interface UseVoiceAgentReturn {
  /** Current voice state machine state */
  voiceState: VoiceState
  /** Whether the browser supports voice features */
  isSupported: boolean
  /** Whether ASR client is ready */
  asrConnected: boolean
  /** Whether TTS WebSocket is connected */
  ttsConnected: boolean
  /** Current interim transcript (unused — no interim results with REST ASR) */
  currentTranscript: string
  /** Whether TTS audio is currently playing */
  isSpeaking: boolean
  /** Whether KWS is actively listening for wake words */
  isKwsActive: boolean
  /** Error message, if any */
  error: string | null

  /** Enter voice mode (start listening) */
  enterVoiceMode: () => void
  /** Exit voice mode (stop everything, return to idle) */
  exitVoiceMode: () => void
  /** Toggle voice mode */
  toggleVoiceMode: () => void

  /**
   * Feed a text chunk to TTS for streaming synthesis.
   * Call this as agent response tokens arrive.
   */
  feedTtsChunk: (text: string) => void

  /**
   * Signal that the agent stream has ended.
   * Finalizes TTS synthesis.
   */
  onAgentStreamEnd: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Path to AudioWorklet processor (served from public/) */
const WORKLET_PATH = "/voice/audio-processor.worklet.js"
const NATIVE_VOICE_PROVIDER_PARAM = "native_voice_provider"
const CSJ_NATIVE_VOICE_PROVIDER = "csj_sdk"

declare global {
  interface Window {
    TobNativeVoice?: {
      updateWakeWords?: (wakeWordsJson: string) => void
      onAgentChanged?: (agentId: string, wakeWordsJson: string) => void
    }
    __TOB_NATIVE_VOICE__?: {
      updateWakeWords?: (wakeWords: string[]) => void
      onAgentChanged?: (agentId: string, wakeWords: string[]) => void
    }
  }
}

type NativeVoiceProvider = typeof CSJ_NATIVE_VOICE_PROVIDER

type NativeVoiceEventPayload = {
  type?: unknown
  angle?: unknown
  text?: unknown
  status?: unknown
  state?: unknown
  code?: unknown
  message?: unknown
}

const getNativeVoiceProvider = (): NativeVoiceProvider | null => {
  if (typeof window === "undefined") return null

  const params = new URLSearchParams(window.location.search)
  return params.get(NATIVE_VOICE_PROVIDER_PARAM) === CSJ_NATIVE_VOICE_PROVIDER
    ? CSJ_NATIVE_VOICE_PROVIDER
    : null
}

const parseNativeVoiceEventPayload = (
  detail: unknown,
): NativeVoiceEventPayload | null => {
  if (typeof detail === "string") {
    try {
      const parsed = JSON.parse(detail)
      return parsed && typeof parsed === "object"
        ? (parsed as NativeVoiceEventPayload)
        : null
    } catch {
      return null
    }
  }

  return detail && typeof detail === "object"
    ? (detail as NativeVoiceEventPayload)
    : null
}

// ============================================================================
// Hook
// ============================================================================

export function useVoiceAgent({
  onSendMessage,
  onInterrupt,
  onInterimTranscript,
  wakeWords = [],
  ttsVoice,
}: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle")
  const [asrConnected, setAsrConnected] = useState(false)
  const [ttsConnected, setTtsConnected] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState("")
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nativeVoiceProvider, setNativeVoiceProvider] =
    useState<NativeVoiceProvider | null>(null)
  const isNativeVoiceProvider = nativeVoiceProvider === CSJ_NATIVE_VOICE_PROVIDER

  // Start as false to match SSR; detect support after hydration to avoid mismatch
  const [isSupported, setIsSupported] = useState(false)
  useEffect(() => {
    const provider = getNativeVoiceProvider()
    setNativeVoiceProvider(provider)
    setIsSupported(!!provider || isVoiceSupported())
  }, [])

  // Refs for clients and audio resources
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const asrClientRef = useRef<StreamingAsrClient | null>(null)
  const ttsClientRef = useRef<TtsClient | null>(null)
  const ttsPlayerRef = useRef<TtsPlayer | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Incremented whenever a full voice session starts or exits. Async callbacks
  // must match the current id before mutating state.
  const voiceSessionIdRef = useRef(0)
  const isNativeVoiceProviderRef = useRef(false)
  // Promise tracking TTS connection in progress (prevents duplicate connections)
  const ttsConnectingRef = useRef<Promise<void> | null>(null)
  // KWS client for always-on wake word detection
  const kwsClientRef = useRef<KwsClient | null>(null)
  const wakeAcknowledgementPendingRef = useRef(false)
  const wakeWordsKey = wakeWords.filter(Boolean).join("\u0000")
  // Ref for wakeWords to avoid stale closures
  const wakeWordsRef = useRef(wakeWords)
  useEffect(() => {
    wakeWordsRef.current = wakeWordsKey ? wakeWordsKey.split("\u0000") : []
  }, [wakeWordsKey])

  useEffect(() => {
    isNativeVoiceProviderRef.current = isNativeVoiceProvider
  }, [isNativeVoiceProvider])

  // Ref for enterVoiceMode to avoid stale closure in KWS callback
  const enterVoiceModeRef = useRef<() => void>(() => {})

  // Refs for callbacks to avoid stale closures
  const onSendMessageRef = useRef(onSendMessage)
  const onInterruptRef = useRef(onInterrupt)
  const onInterimTranscriptRef = useRef(onInterimTranscript)
  useEffect(() => {
    onSendMessageRef.current = onSendMessage
    onInterruptRef.current = onInterrupt
    onInterimTranscriptRef.current = onInterimTranscript
  }, [onSendMessage, onInterrupt, onInterimTranscript])

  // Track voice state in ref for use in callbacks
  const voiceStateRef = useRef<VoiceState>(voiceState)
  useEffect(() => {
    voiceStateRef.current = voiceState
  }, [voiceState])
  const setVoiceStateSync = useCallback((nextState: VoiceState) => {
    voiceStateRef.current = nextState
    setVoiceState(nextState)
  }, [])

  // Whether we're currently in an active voice session (TTS has been started for current reply)
  const ttsActiveRef = useRef(false)
  // Whether the agent text stream has ended (no more text chunks will arrive)
  const ttsStreamEndedRef = useRef(false)
  // Debounce timer for onPlaybackEnd → listening transition
  const playbackEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Reset the idle timeout timer */
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    idleTimerRef.current = setTimeout(() => {
      // Only timeout if we're in listening or speaking state
      if (
        voiceStateRef.current === "listening" ||
        voiceStateRef.current === "transcribing" ||
        voiceStateRef.current === "speaking"
      ) {
        exitVoiceModeInternal()
      }
    }, VOICE_IDLE_TIMEOUT_MS)
  }, [])

  /**
   * Cancel the pending playback-end transition.
   * Called when new audio arrives (gap was temporary).
   */
  const cancelPlaybackEndTimer = useCallback(() => {
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current)
      playbackEndTimerRef.current = null
    }
  }, [])

  /**
   * Schedule a transition from speaking → listening after a short debounce.
   * If new audio arrives before the timer fires, it will be cancelled.
   */
  const schedulePlaybackEndTransition = useCallback(() => {
    cancelPlaybackEndTimer()
    playbackEndTimerRef.current = setTimeout(() => {
      playbackEndTimerRef.current = null
      // Only transition if agent stream has ended and we're still in speaking state
      if (
        ttsStreamEndedRef.current &&
        voiceStateRef.current === "speaking"
      ) {
        setIsSpeaking(false)
        setVoiceStateSync("listening")
        resetIdleTimer()
        // Clean up TTS resources for next turn
        if (ttsClientRef.current) {
          ttsClientRef.current.disconnect()
          ttsClientRef.current = null
        }
        setTtsConnected(false)
        ttsActiveRef.current = false
      }
    }, 800) // 800ms grace period for inter-chunk gaps
  }, [cancelPlaybackEndTimer, resetIdleTimer, setVoiceStateSync])

  /** Stop the idle timer */
  const stopIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  /** Start KWS (Keyword Spotting) for always-on wake word detection */
  const startKwsListening = useCallback(async () => {
    const kw = wakeWordsRef.current
    if (!kw.length) return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return

    // Don't start if already active
    if (kwsClientRef.current?.isActive) return

    try {
      const kwsClient = new KwsClient({
        onDetection: (_keyword) => {
          // Wake word detected — stop KWS and enter full voice mode
          if (kwsClientRef.current) {
            kwsClientRef.current.stop()
            kwsClientRef.current = null
          }
          wakeAcknowledgementPendingRef.current = true
          enterVoiceModeRef.current()
        },
        onError: (err) => {
          console.warn("[KWS] Error:", err)
        },
        onConnected: () => {
          setVoiceStateSync("kws")
        },
        onDisconnected: () => {
          // Only reset to idle if still in kws state
          if (voiceStateRef.current === "kws") {
            setVoiceStateSync("idle")
          }
        },
      })
      kwsClientRef.current = kwsClient
      await kwsClient.start(kw)
    } catch (err) {
      // Mic permission denied or other failure — graceful degradation
      console.warn("[KWS] Cannot start:", err)
    }
  }, [setVoiceStateSync]) // enterVoiceMode accessed via ref to avoid stale closure

  /** Stop KWS listening */
  const stopKwsListening = useCallback(() => {
    if (kwsClientRef.current) {
      kwsClientRef.current.stop()
      kwsClientRef.current = null
    }
  }, [])

  const stopCurrentTts = useCallback(() => {
    cancelPlaybackEndTimer()
    ttsStreamEndedRef.current = false

    if (ttsPlayerRef.current) {
      ttsPlayerRef.current.stop()
      ttsPlayerRef.current.dispose()
      ttsPlayerRef.current = null
    }
    setIsSpeaking(false)

    if (ttsClientRef.current) {
      ttsClientRef.current.disconnect()
      ttsClientRef.current = null
    }
    setTtsConnected(false)
    ttsActiveRef.current = false
  }, [cancelPlaybackEndTimer])

  /** Internal exit function (used by timeout and explicit exit) */
  const exitVoiceModeInternal = useCallback((restartKws = true) => {
    voiceSessionIdRef.current += 1
    stopIdleTimer()
    cancelPlaybackEndTimer()
    ttsStreamEndedRef.current = false

    // Disconnect ASR client
    if (asrClientRef.current) {
      asrClientRef.current.disconnect()
      asrClientRef.current = null
    }
    setAsrConnected(false)

    // Stop and disconnect TTS
    if (ttsClientRef.current) {
      ttsClientRef.current.disconnect()
      ttsClientRef.current = null
    }
    setTtsConnected(false)
    ttsActiveRef.current = false

    // Stop TTS playback
    if (ttsPlayerRef.current) {
      ttsPlayerRef.current.stop()
      ttsPlayerRef.current.dispose()
      ttsPlayerRef.current = null
    }
    setIsSpeaking(false)

    // Stop audio capture
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "stop" })
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }

    setCurrentTranscript("")
    onInterimTranscriptRef.current?.("")
    setVoiceStateSync(
      restartKws && isNativeVoiceProviderRef.current ? "kws" : "idle",
    )

    // Return to KWS listening if wake words configured, otherwise idle.
    // The Android WebView provider owns wake/ASR capture natively, so the web
    // app only keeps the passive KWS state and listens for native events.
    if (
      restartKws &&
      !isNativeVoiceProviderRef.current &&
      wakeWordsRef.current.length
    ) {
      startKwsListening()
    }
  }, [stopIdleTimer, cancelPlaybackEndTimer, startKwsListening, setVoiceStateSync])

  /** Interrupt TTS and agent response when user speaks during playback */
  const interruptAndListen = useCallback(() => {
    stopCurrentTts()
    // Signal interrupt to the agent
    onInterruptRef.current()

    // Enter listening state for new speech
    setVoiceStateSync("listening")
    resetIdleTimer()
  }, [resetIdleTimer, setVoiceStateSync, stopCurrentTts])

  const handleFinalTranscript = useCallback((text: string) => {
    const trimmed = text.trim()

    setCurrentTranscript("")
    onInterimTranscriptRef.current?.("")

    // Filter noise (very short results)
    if (trimmed.length < 2) {
      if (
        voiceStateRef.current === "transcribing" ||
        voiceStateRef.current === "listening"
      ) {
        setVoiceStateSync("listening")
        resetIdleTimer()
      }
      return
    }

    // If the agent is still answering, native ASR may deliver the final text
    // without a prior web speech_start signal. Stop playback and interrupt
    // before sending the new user turn.
    if (
      voiceStateRef.current === "processing" ||
      voiceStateRef.current === "speaking"
    ) {
      stopCurrentTts()
      onInterruptRef.current()
    }

    onSendMessageRef.current(trimmed)
    setVoiceStateSync("processing")
    ttsStreamEndedRef.current = false
    stopIdleTimer()
  }, [resetIdleTimer, setVoiceStateSync, stopCurrentTts, stopIdleTimer])

  /** Speak a short acknowledgement immediately after KWS wakes voice mode. */
  const speakWakeAcknowledgement = useCallback(async (sessionId: number) => {
    const isCurrentSession = () => voiceSessionIdRef.current === sessionId

    if (ttsClientRef.current) {
      ttsClientRef.current.disconnect()
      ttsClientRef.current = null
    }

    ttsStreamEndedRef.current = false
    ttsActiveRef.current = true
    setVoiceStateSync("speaking")

    const finishAcknowledgement = () => {
      if (!isCurrentSession()) return
      ttsStreamEndedRef.current = true
      ttsActiveRef.current = false

      if (ttsClientRef.current) {
        ttsClientRef.current.disconnect()
        ttsClientRef.current = null
      }

      if (!ttsPlayerRef.current?.playing && voiceStateRef.current === "speaking") {
        setIsSpeaking(false)
        setVoiceStateSync("listening")
        resetIdleTimer()
      }
    }

    const ttsClient = new TtsClient({
      onAudioChunk: (pcmBase64) => {
        if (!isCurrentSession()) return
        cancelPlaybackEndTimer()
        ttsPlayerRef.current?.init().then(() => {
          if (!isCurrentSession()) return
          ttsPlayerRef.current?.enqueueAudio(pcmBase64)
        })
      },
      onFinished: finishAcknowledgement,
      onError: (errMsg) => {
        if (!isCurrentSession()) return
        console.error("Wake acknowledgement TTS error:", errMsg)
        setError(errMsg)
        finishAcknowledgement()
      },
      onConnected: () => {
        if (!isCurrentSession()) return
        setTtsConnected(true)
      },
      onDisconnected: () => {
        if (!isCurrentSession()) return
        setTtsConnected(false)
      },
    }, ttsVoice || undefined)

    ttsClientRef.current = ttsClient

    try {
      await ttsClient.connect()
      if (!isCurrentSession()) {
        ttsClient.disconnect()
        return
      }
      ttsClient.appendText("我在")
      ttsClient.finish()
    } catch (err) {
      if (!isCurrentSession()) return
      console.error("Failed to speak wake acknowledgement:", err)
      finishAcknowledgement()
    }
  }, [
    ttsVoice,
    resetIdleTimer,
    cancelPlaybackEndTimer,
    setVoiceStateSync,
  ])

  /** Start voice mode: set up audio capture, VAD, and ASR */
  const enterVoiceMode = useCallback(async () => {
    // Allow entering from both idle and kws states
    if (
      (voiceStateRef.current !== "idle" && voiceStateRef.current !== "kws") ||
      !isSupported
    ) {
      const supportError = getVoiceSupportError()
      if (supportError) setError(supportError)
      return
    }

    const sessionId = voiceSessionIdRef.current + 1
    voiceSessionIdRef.current = sessionId
    const isCurrentSession = () => voiceSessionIdRef.current === sessionId

    // Stop KWS if active (free mic for voice mode)
    if (kwsClientRef.current) {
      kwsClientRef.current.stop()
      kwsClientRef.current = null
    }

    setError(null)

    if (isNativeVoiceProvider) {
      setAsrConnected(true)
      setCurrentTranscript("")
      onInterimTranscriptRef.current?.("")
      setVoiceStateSync("listening")
      resetIdleTimer()
      return
    }

    try {
      // 1. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      if (!isCurrentSession()) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      mediaStreamRef.current = stream

      // 2. Create AudioContext
      const AudioContextCtor = getAudioContextConstructor()
      if (!AudioContextCtor) {
        throw new Error("Voice input is not supported in this browser")
      }
      const audioContext = new AudioContextCtor()
      if (!isCurrentSession()) {
        audioContext.close().catch(() => {})
        return
      }
      audioContextRef.current = audioContext

      // 3. Load AudioWorklet
      await audioContext.audioWorklet.addModule(WORKLET_PATH)
      if (!isCurrentSession()) {
        audioContext.close().catch(() => {})
        return
      }

      // 4. Create worklet node
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-processor",
      )
      workletNodeRef.current = workletNode

      // 4b. Create backend ASR/VAD stream client
      const asrClient = new StreamingAsrClient({
        onConnected: () => {
          if (!isCurrentSession()) return
          setAsrConnected(true)
        },
        onDisconnected: () => {
          if (!isCurrentSession()) return
          setAsrConnected(false)
        },
        onSpeechStart: () => {
          if (!isCurrentSession()) return
          resetIdleTimer()
          if (
            voiceStateRef.current === "processing" ||
            voiceStateRef.current === "speaking"
          ) {
            interruptAndListen()
          }
        },
        onTranscribing: () => {
          if (!isCurrentSession()) return
          setVoiceStateSync("transcribing")
          setCurrentTranscript("...")
          onInterimTranscriptRef.current?.("...")
        },
        onTranscript: (text) => {
          if (!isCurrentSession()) return
          handleFinalTranscript(text)
        },
        onError: (errMsg) => {
          if (!isCurrentSession()) return
          setError(errMsg)
          // Don't exit voice mode on ASR error — return to listening
          if (
            voiceStateRef.current === "processing" ||
            voiceStateRef.current === "transcribing"
          ) {
            setVoiceStateSync("listening")
            resetIdleTimer()
          }
        },
      })
      asrClientRef.current = asrClient

      // 5. Show loading state while backend ASR/VAD WebSocket connects
      setVoiceStateSync("loading")

      // 7. Create TTS player
      const ttsPlayer = new TtsPlayer({
        onPlaybackStart: () => {
          if (!isCurrentSession()) return
          // New audio arrived — cancel any pending end-of-speech transition
          cancelPlaybackEndTimer()
          setIsSpeaking(true)
          setVoiceStateSync("speaking")
        },
        onPlaybackEnd: () => {
          if (!isCurrentSession()) return
          // Audio queue drained — but more chunks may be incoming.
          // Only transition to listening after debounce + stream ended.
          if (ttsStreamEndedRef.current) {
            schedulePlaybackEndTransition()
          }
        },
      })
      ttsPlayerRef.current = ttsPlayer

      const shouldSpeakWakeAcknowledgement = wakeAcknowledgementPendingRef.current
      if (shouldSpeakWakeAcknowledgement) {
        wakeAcknowledgementPendingRef.current = false
        void speakWakeAcknowledgement(sessionId)
      }

      // 8. Connect backend ASR/VAD stream
      await asrClient.connect()
      if (!isCurrentSession()) return

      // 9. Wire audio: mic -> worklet -> backend ASR/VAD WebSocket
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)

      workletNode.port.onmessage = (event: MessageEvent) => {
        if (!isCurrentSession()) return
        if (event.data.type === "audio" && asrClientRef.current?.isConnected) {
          asrClientRef.current.sendAudio(event.data.int16)
        }
      }

      // 10. Start processing
      workletNode.port.postMessage({ type: "start" })

      // 11. Ready — transition to listening
      if (!isCurrentSession()) return
      if (!shouldSpeakWakeAcknowledgement) {
        setVoiceStateSync("listening")
      }
      resetIdleTimer()
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied."
          : err instanceof Error
            ? err.message
            : "Failed to start voice mode"
      setError(msg)
      exitVoiceModeInternal()
    }
  }, [
    isNativeVoiceProvider,
    isSupported,
    resetIdleTimer,
    interruptAndListen,
    exitVoiceModeInternal,
    cancelPlaybackEndTimer,
    schedulePlaybackEndTransition,
    speakWakeAcknowledgement,
    handleFinalTranscript,
    setVoiceStateSync,
  ])

  // Keep enterVoiceModeRef in sync with the latest enterVoiceMode
  useEffect(() => {
    enterVoiceModeRef.current = enterVoiceMode
  }, [enterVoiceMode])

  const exitVoiceMode = useCallback(() => {
    exitVoiceModeInternal()
  }, [exitVoiceModeInternal])

  const toggleVoiceMode = useCallback(() => {
    if (voiceState === "idle" || voiceState === "kws") {
      enterVoiceMode()
    } else {
      exitVoiceMode()
    }
  }, [voiceState, enterVoiceMode, exitVoiceMode])

  /**
   * Feed a text chunk to TTS for streaming synthesis.
   * Called as agent response tokens arrive from the stream handler.
   */
  const feedTtsChunk = useCallback((text: string) => {
    const sessionId = voiceSessionIdRef.current
    const isCurrentSession = () => voiceSessionIdRef.current === sessionId

    // Only feed TTS when in processing or speaking state
    if (
      voiceStateRef.current !== "processing" &&
      voiceStateRef.current !== "speaking"
    )
      return

    // Helper to ensure TTS client is connected (returns a promise)
    const ensureConnected = async (): Promise<boolean> => {
      // Already connected
      if (ttsClientRef.current?.isConnected) return true

      // Connection in progress - wait for it
      if (ttsConnectingRef.current) {
        try {
          await ttsConnectingRef.current
          return ttsClientRef.current?.isConnected ?? false
        } catch {
          return false
        }
      }

      // Start new connection
      const connectPromise = (async () => {
        const ttsClient = new TtsClient({
          onAudioChunk: (pcmBase64) => {
            if (!isCurrentSession()) return
            // New audio arrived — cancel any pending end-of-speech transition
            cancelPlaybackEndTimer()

            // Initialize player if needed
            if (!ttsPlayerRef.current) {
              const player = new TtsPlayer({
                onPlaybackStart: () => {
                  if (!isCurrentSession()) return
                  cancelPlaybackEndTimer()
                  setIsSpeaking(true)
                  setVoiceStateSync("speaking")
                },
                onPlaybackEnd: () => {
                  if (!isCurrentSession()) return
                  if (ttsStreamEndedRef.current) {
                    schedulePlaybackEndTransition()
                  }
                },
              })
              ttsPlayerRef.current = player
            }
            ttsPlayerRef.current?.init().then(() => {
              if (!isCurrentSession()) return
              ttsPlayerRef.current?.enqueueAudio(pcmBase64)
            })
          },
          onDone: () => {
            // Current response synthesis done
          },
          onFinished: () => {
            if (!isCurrentSession()) return
            ttsActiveRef.current = false
            // Session ended on server side - clean up client
            // so next turn creates a fresh connection
            if (ttsClientRef.current) {
              ttsClientRef.current.disconnect()
              ttsClientRef.current = null
            }
            if (
              ttsStreamEndedRef.current &&
              voiceStateRef.current === "processing" &&
              !ttsPlayerRef.current?.playing
            ) {
              setVoiceStateSync("listening")
              resetIdleTimer()
            }
          },
          onError: (errMsg) => {
            if (!isCurrentSession()) return
            console.error("TTS error:", errMsg)
            setError(errMsg)
            ttsActiveRef.current = false
            // Clean up broken client
            if (ttsClientRef.current) {
              ttsClientRef.current.disconnect()
              ttsClientRef.current = null
            }
            if (
              voiceStateRef.current === "processing" ||
              voiceStateRef.current === "speaking"
            ) {
              setIsSpeaking(false)
              setVoiceStateSync("listening")
              resetIdleTimer()
            }
          },
          onConnected: () => {
            if (!isCurrentSession()) return
            setTtsConnected(true)
          },
          onDisconnected: () => {
            if (!isCurrentSession()) return
            setTtsConnected(false)
          },
        }, ttsVoice || undefined)
        ttsClientRef.current = ttsClient

        try {
          await ttsClient.connect()
          if (!isCurrentSession()) {
            ttsClient.disconnect()
            throw new Error("Stale TTS session")
          }
          ttsActiveRef.current = true
        } catch (err) {
          console.error("Failed to connect TTS:", err)
          throw err
        }
      })()

      ttsConnectingRef.current = connectPromise
      try {
        await connectPromise
        return true
      } catch {
        return false
      } finally {
        ttsConnectingRef.current = null
      }
    }

    // Run async connection + append (fire-and-forget)
    ensureConnected().then((connected) => {
      if (connected && isCurrentSession()) {
        ttsClientRef.current?.appendText(text)
      }
    })
  }, [ttsVoice, resetIdleTimer, cancelPlaybackEndTimer, schedulePlaybackEndTransition, setVoiceStateSync])

  /**
   * Called when the agent stream ends.
   * Marks the stream as ended so that onPlaybackEnd knows no more audio
   * will arrive. Does NOT immediately disconnect TTS — remaining audio
   * may still be in flight from DashScope.
   */
  const onAgentStreamEnd = useCallback(() => {
    const sessionId = voiceSessionIdRef.current
    const isCurrentSession = () => voiceSessionIdRef.current === sessionId
    ttsStreamEndedRef.current = true

    if (ttsActiveRef.current || ttsConnectingRef.current) {
      const finishCurrentTts = () => {
        if (!isCurrentSession()) return
        if (ttsClientRef.current?.isConnected) {
          ttsClientRef.current.finish()
        } else if (
          voiceStateRef.current === "processing" &&
          !ttsPlayerRef.current?.playing
        ) {
          setVoiceStateSync("listening")
          resetIdleTimer()
        }
      }

      if (ttsConnectingRef.current) {
        ttsConnectingRef.current.then(finishCurrentTts).catch(finishCurrentTts)
      } else {
        finishCurrentTts()
      }
      // TTS was used — let onPlaybackEnd handle the transition
      // after all queued audio finishes playing
    } else if (voiceStateRef.current === "processing") {
      // No TTS was used (e.g. agent returned no text) — go back to listening
      setVoiceStateSync("listening")
      resetIdleTimer()
    }
  }, [resetIdleTimer, setVoiceStateSync])

  useEffect(() => {
    if (!isNativeVoiceProvider) return

    stopKwsListening()
    setError(null)
    setAsrConnected(true)

    if (voiceStateRef.current === "idle") {
      setVoiceStateSync("kws")
    }
  }, [isNativeVoiceProvider, setVoiceStateSync, stopKwsListening])

  useEffect(() => {
    if (!isNativeVoiceProvider || typeof window === "undefined") return

    const keywords = wakeWordsRef.current
      .map((word) => word.trim())
      .filter(Boolean)

    try {
      if (window.__TOB_NATIVE_VOICE__?.onAgentChanged) {
        window.__TOB_NATIVE_VOICE__.onAgentChanged("active", keywords)
      } else if (window.TobNativeVoice?.onAgentChanged) {
        window.TobNativeVoice.onAgentChanged("active", JSON.stringify(keywords))
      } else if (window.__TOB_NATIVE_VOICE__?.updateWakeWords) {
        window.__TOB_NATIVE_VOICE__.updateWakeWords(keywords)
      } else if (window.TobNativeVoice?.updateWakeWords) {
        window.TobNativeVoice.updateWakeWords(JSON.stringify(keywords))
      }
    } catch (err) {
      console.error("[NativeVoice] failed to sync wake words:", err)
    }
  }, [isNativeVoiceProvider, wakeWordsKey])

  useEffect(() => {
    if (!isNativeVoiceProvider || typeof window === "undefined") return

    const handleNativeVoiceEvent = (event: Event) => {
      const payload = parseNativeVoiceEventPayload(
        (event as CustomEvent<unknown>).detail,
      )
      if (!payload || typeof payload.type !== "string") return

      if (payload.type === "wake") {
        console.log("[NativeVoice] wake angle:", payload.angle)
        setError(null)
        setCurrentTranscript("")
        onInterimTranscriptRef.current?.("")

        if (
          voiceStateRef.current === "processing" ||
          voiceStateRef.current === "speaking"
        ) {
          interruptAndListen()
          return
        }

        if (
          voiceStateRef.current === "idle" ||
          voiceStateRef.current === "kws"
        ) {
          voiceSessionIdRef.current += 1
          setVoiceStateSync("listening")
        }
        resetIdleTimer()
        return
      }

      if (payload.type === "audio_ws") {
        const status = typeof payload.status === "string" ? payload.status : ""
        if (status === "connected" || status === "ready") {
          setAsrConnected(true)
          setError(null)
          if (voiceStateRef.current === "idle") {
            setVoiceStateSync("kws")
          }
        } else if (status === "closed" || status === "closing") {
          setAsrConnected(false)
        }
        return
      }

      if (payload.type === "voice_state") {
        const state = typeof payload.state === "string" ? payload.state : ""
        if (state === "speech_start") {
          resetIdleTimer()
          if (
            voiceStateRef.current === "processing" ||
            voiceStateRef.current === "speaking"
          ) {
            interruptAndListen()
          } else if (
            voiceStateRef.current === "idle" ||
            voiceStateRef.current === "kws"
          ) {
            voiceSessionIdRef.current += 1
            setVoiceStateSync("listening")
          }
        } else if (state === "transcribing") {
          setVoiceStateSync("transcribing")
          setCurrentTranscript("...")
          onInterimTranscriptRef.current?.("...")
        }
        return
      }

      if (payload.type === "error") {
        const message =
          typeof payload.message === "string" ? payload.message : "Native voice error"
        setError(message)
        return
      }

      if (payload.type === "asr") {
        const text = typeof payload.text === "string" ? payload.text : ""
        console.log("[NativeVoice] asr text:", text)
        if (!text.trim()) return

        if (
          voiceStateRef.current === "idle" ||
          voiceStateRef.current === "kws"
        ) {
          voiceSessionIdRef.current += 1
        }

        setError(null)
        setVoiceStateSync("transcribing")
        handleFinalTranscript(text)
      }
    }

    window.addEventListener("nativeVoiceEvent", handleNativeVoiceEvent)
    return () => {
      window.removeEventListener("nativeVoiceEvent", handleNativeVoiceEvent)
    }
  }, [
    handleFinalTranscript,
    interruptAndListen,
    isNativeVoiceProvider,
    resetIdleTimer,
    setVoiceStateSync,
  ])

  // Auto-start KWS on page load if wake words are configured. Only the visible
  // tab listens, which avoids duplicate wake detections from background chats.
  useEffect(() => {
    if (isNativeVoiceProvider) {
      stopKwsListening()
      return
    }

    if (!isSupported || !wakeWordsRef.current.length) {
      stopKwsListening()
      return
    }
    if (typeof document === "undefined") return

    const syncKwsWithVisibility = () => {
      if (document.visibilityState !== "visible") {
        stopKwsListening()
        return
      }

      if (voiceStateRef.current === "idle") {
        startKwsListening()
      } else if (voiceStateRef.current === "kws") {
        kwsClientRef.current?.updateKeywords(wakeWordsRef.current)
      }
    }

    syncKwsWithVisibility()
    document.addEventListener("visibilitychange", syncKwsWithVisibility)

    return () => {
      document.removeEventListener("visibilitychange", syncKwsWithVisibility)
    }
  }, [
    wakeWordsKey,
    isNativeVoiceProvider,
    isSupported,
    startKwsListening,
    stopKwsListening,
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopKwsListening()
      exitVoiceModeInternal(false)
    }
  }, [exitVoiceModeInternal, stopKwsListening])

  return {
    voiceState,
    isSupported,
    asrConnected: isNativeVoiceProvider || asrConnected,
    ttsConnected,
    currentTranscript,
    isSpeaking,
    isKwsActive: voiceState === "kws",
    error,
    enterVoiceMode,
    exitVoiceMode,
    toggleVoiceMode,
    feedTtsChunk,
    onAgentStreamEnd,
  }
}
