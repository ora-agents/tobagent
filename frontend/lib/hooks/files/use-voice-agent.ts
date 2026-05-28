/**
 * Voice Agent Hook
 *
 * Orchestrates the complete voice agent experience:
 * - Client-side VAD (sherpa-onnx / Silero VAD via WASM) for speech detection
 * - REST ASR (qwen3-asr-flash) for transcription of complete speech segments
 * - Cloud TTS for agent reply playback (via WebSocket proxy)
 * - Backend KWS (sherpa-onnx) for always-on wake word detection
 * - State machine: idle/kws -> loading -> listening -> processing -> speaking -> loop
 * - Interruption: user can speak during TTS to interrupt the agent
 * - Auto-send: ASR final transcript is sent automatically
 * - Timeout: returns to kws (or idle) after 30s of inactivity
 *
 * The VAD WASM module (~93MB) is lazy-loaded on first voice mode entry.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { AsrClient } from "@/lib/voice/asr-client"
import { TtsClient } from "@/lib/voice/tts-client"
import { TtsPlayer } from "@/lib/voice/tts-player"
import { VadManager, type SpeechSegment } from "@/lib/voice/vad"
import { KwsClient } from "@/lib/voice/kws/kws-client"
import type { VoiceState } from "@/lib/voice/types"
import { VOICE_IDLE_TIMEOUT_MS } from "@/lib/voice/utils/constants"

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

// ============================================================================
// Hook
// ============================================================================

export function useVoiceAgent({
  onSendMessage,
  onInterrupt,
  onInterimTranscript,
  wakeWords = [],
}: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle")
  const [asrConnected, setAsrConnected] = useState(false)
  const [ttsConnected, setTtsConnected] = useState(false)
  const [currentTranscript, setCurrentTranscript] = useState("")
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start as false to match SSR; detect support after hydration to avoid mismatch
  const [isSupported, setIsSupported] = useState(false)
  useEffect(() => {
    setIsSupported(
      !!(
        window.AudioContext &&
        navigator.mediaDevices &&
        window.WebAssembly
      )
    )
  }, [])

  // Refs for clients and audio resources
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const asrClientRef = useRef<AsrClient | null>(null)
  const vadManagerRef = useRef<VadManager | null>(null)
  const ttsClientRef = useRef<TtsClient | null>(null)
  const ttsPlayerRef = useRef<TtsPlayer | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Promise tracking TTS connection in progress (prevents duplicate connections)
  const ttsConnectingRef = useRef<Promise<void> | null>(null)
  // KWS client for always-on wake word detection
  const kwsClientRef = useRef<KwsClient | null>(null)
  // Ref for wakeWords to avoid stale closures
  const wakeWordsRef = useRef(wakeWords)
  useEffect(() => {
    wakeWordsRef.current = wakeWords
  }, [wakeWords])

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
        setVoiceState("listening")
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
  }, [cancelPlaybackEndTimer, resetIdleTimer])

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
          enterVoiceModeRef.current()
        },
        onError: (err) => {
          console.warn("[KWS] Error:", err)
        },
        onConnected: () => {
          setVoiceState("kws")
        },
        onDisconnected: () => {
          // Only reset to idle if still in kws state
          if (voiceStateRef.current === "kws") {
            setVoiceState("idle")
          }
        },
      })
      kwsClientRef.current = kwsClient
      await kwsClient.start(kw)
    } catch (err) {
      // Mic permission denied or other failure — graceful degradation
      console.warn("[KWS] Cannot start:", err)
    }
  }, []) // enterVoiceMode accessed via ref to avoid stale closure

  /** Stop KWS listening */
  const stopKwsListening = useCallback(() => {
    if (kwsClientRef.current) {
      kwsClientRef.current.stop()
      kwsClientRef.current = null
    }
  }, [])

  /** Internal exit function (used by timeout and explicit exit) */
  const exitVoiceModeInternal = useCallback(() => {
    stopIdleTimer()
    cancelPlaybackEndTimer()
    ttsStreamEndedRef.current = false

    // Dispose VAD manager (frees WASM resources)
    if (vadManagerRef.current) {
      vadManagerRef.current.dispose()
      vadManagerRef.current = null
    }

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

    // Return to KWS listening if wake words configured, otherwise idle
    if (wakeWordsRef.current.length) {
      startKwsListening()
    } else {
      setVoiceState("idle")
    }
  }, [stopIdleTimer, cancelPlaybackEndTimer, startKwsListening])

  /** Interrupt TTS and agent response when user speaks during playback */
  const interruptAndListen = useCallback(() => {
    cancelPlaybackEndTimer()
    ttsStreamEndedRef.current = false

    // Stop TTS playback
    if (ttsPlayerRef.current) {
      ttsPlayerRef.current.stop()
      ttsPlayerRef.current.dispose()
      ttsPlayerRef.current = null
    }
    setIsSpeaking(false)

    // Disconnect TTS client
    if (ttsClientRef.current) {
      ttsClientRef.current.disconnect()
      ttsClientRef.current = null
    }
    setTtsConnected(false)
    ttsActiveRef.current = false

    // Signal interrupt to the agent
    onInterruptRef.current()

    // Enter listening state for new speech
    setVoiceState("listening")
    resetIdleTimer()
  }, [resetIdleTimer, cancelPlaybackEndTimer])

  /** Start voice mode: set up audio capture, VAD, and ASR */
  const enterVoiceMode = useCallback(async () => {
    // Allow entering from both idle and kws states
    if (
      (voiceStateRef.current !== "idle" && voiceStateRef.current !== "kws") ||
      !isSupported
    )
      return

    // Stop KWS if active (free mic for voice mode)
    if (kwsClientRef.current) {
      kwsClientRef.current.stop()
      kwsClientRef.current = null
    }

    setError(null)

    try {
      // 1. Get microphone
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

      // 3. Load AudioWorklet
      await audioContext.audioWorklet.addModule(WORKLET_PATH)

      // 4. Create worklet node
      const workletNode = new AudioWorkletNode(
        audioContext,
        "audio-processor",
      )
      workletNodeRef.current = workletNode

      // 4b. Create ASR client (HTTP-based, no persistent connection)
      const asrClient = new AsrClient({
        onConnected: () => {
          setAsrConnected(true)
        },
        onDisconnected: () => {
          setAsrConnected(false)
        },
        onTranscript: (text, _isFinal) => {
          // ASR result received — clear transcript display
          setCurrentTranscript("")
          onInterimTranscriptRef.current?.("")

          // Filter noise (very short results)
          if (text.trim().length < 2) return

          // If agent is still processing previous response, interrupt first
          if (voiceStateRef.current === "processing") {
            cancelPlaybackEndTimer()
            ttsStreamEndedRef.current = false

            // Stop TTS
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
            onInterruptRef.current()
          }

          // Send the message to the agent
          onSendMessageRef.current(text)
          setVoiceState("processing")
          ttsStreamEndedRef.current = false
          stopIdleTimer()
        },
        onError: (errMsg) => {
          setError(errMsg)
          // Don't exit voice mode on ASR error — return to listening
          if (voiceStateRef.current === "processing") {
            setVoiceState("listening")
            resetIdleTimer()
          }
        },
      })
      asrClientRef.current = asrClient

      // 5. Show loading state while VAD WASM initializes
      setVoiceState("loading")

      // 6. Create and initialize VAD manager (lazy-loads WASM on first use)
      const vadManager = new VadManager({
        onSpeechStart: () => {
          resetIdleTimer()
          // Interrupt agent when user speaks during processing or speaking.
          // Browser echo cancellation (getUserMedia echoCancellation: true)
          // filters TTS playback from mic input, preventing false triggers.
          if (
            voiceStateRef.current === "processing" ||
            voiceStateRef.current === "speaking"
          ) {
            interruptAndListen()
          }
        },
        onSpeechEnd: async (segment: SpeechSegment) => {
          // Speech segment detected — send to ASR for transcription
          if (!asrClientRef.current) return

          // Show that we're transcribing
          setCurrentTranscript("...")
          onInterimTranscriptRef.current?.("...")

          await asrClientRef.current.transcribeSegment(segment.pcmInt16)
        },
        onError: (errMsg) => {
          console.error("[VAD]", errMsg)
          setError(errMsg)
        },
      })

      await vadManager.init()
      vadManagerRef.current = vadManager

      // 7. Create TTS player
      const ttsPlayer = new TtsPlayer({
        onPlaybackStart: () => {
          // New audio arrived — cancel any pending end-of-speech transition
          cancelPlaybackEndTimer()
          setIsSpeaking(true)
          setVoiceState("speaking")
        },
        onPlaybackEnd: () => {
          // Audio queue drained — but more chunks may be incoming.
          // Only transition to listening after debounce + stream ended.
          if (ttsStreamEndedRef.current) {
            schedulePlaybackEndTransition()
          }
        },
      })
      ttsPlayerRef.current = ttsPlayer

      // 8. Connect ASR client (immediate for HTTP)
      await asrClient.connect()

      // 9. Wire audio: mic -> worklet -> main thread -> VAD
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(workletNode)

      workletNode.port.onmessage = (event: MessageEvent) => {
        if (event.data.type === "audio" && vadManagerRef.current) {
          const float32 = new Float32Array(event.data.float32)
          const int16 = new Int16Array(event.data.int16)
          vadManagerRef.current.processAudio(float32, int16)
        }
      }

      // 10. Start processing
      workletNode.port.postMessage({ type: "start" })

      // 11. Ready — transition to listening
      setVoiceState("listening")
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
    voiceState,
    isSupported,
    resetIdleTimer,
    stopIdleTimer,
    interruptAndListen,
    exitVoiceModeInternal,
    cancelPlaybackEndTimer,
    schedulePlaybackEndTransition,
  ])

  // Keep enterVoiceModeRef in sync with the latest enterVoiceMode
  useEffect(() => {
    enterVoiceModeRef.current = enterVoiceMode
  }, [enterVoiceMode])

  const exitVoiceMode = useCallback(() => {
    exitVoiceModeInternal()
  }, [exitVoiceModeInternal])

  const toggleVoiceMode = useCallback(() => {
    if (voiceState === "idle") {
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
            // New audio arrived — cancel any pending end-of-speech transition
            cancelPlaybackEndTimer()

            // Initialize player if needed
            if (!ttsPlayerRef.current) {
              const player = new TtsPlayer({
                onPlaybackStart: () => {
                  cancelPlaybackEndTimer()
                  setIsSpeaking(true)
                  setVoiceState("speaking")
                },
                onPlaybackEnd: () => {
                  if (ttsStreamEndedRef.current) {
                    schedulePlaybackEndTransition()
                  }
                },
              })
              ttsPlayerRef.current = player
            }
            ttsPlayerRef.current?.init().then(() => {
              ttsPlayerRef.current?.enqueueAudio(pcmBase64)
            })
          },
          onDone: () => {
            // Current response synthesis done
          },
          onFinished: () => {
            ttsActiveRef.current = false
            // Session ended on server side - clean up client
            // so next turn creates a fresh connection
            if (ttsClientRef.current) {
              ttsClientRef.current.disconnect()
              ttsClientRef.current = null
            }
          },
          onError: (errMsg) => {
            console.error("TTS error:", errMsg)
            ttsActiveRef.current = false
            // Clean up broken client
            if (ttsClientRef.current) {
              ttsClientRef.current.disconnect()
              ttsClientRef.current = null
            }
          },
          onConnected: () => {
            setTtsConnected(true)
          },
          onDisconnected: () => {
            setTtsConnected(false)
          },
        })
        ttsClientRef.current = ttsClient

        try {
          await ttsClient.connect()
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
      if (connected) {
        ttsClientRef.current?.appendText(text)
      }
    })
  }, [resetIdleTimer, cancelPlaybackEndTimer, schedulePlaybackEndTransition])

  /**
   * Called when the agent stream ends.
   * Marks the stream as ended so that onPlaybackEnd knows no more audio
   * will arrive. Does NOT immediately disconnect TTS — remaining audio
   * may still be in flight from DashScope.
   */
  const onAgentStreamEnd = useCallback(() => {
    ttsStreamEndedRef.current = true

    if (ttsActiveRef.current) {
      // TTS was used — let onPlaybackEnd handle the transition
      // after all queued audio finishes playing
    } else if (voiceStateRef.current === "processing") {
      // No TTS was used (e.g. agent returned no text) — go back to listening
      setVoiceState("listening")
      resetIdleTimer()
    }
  }, [resetIdleTimer])

  // Auto-start KWS on page load if wake words are configured
  useEffect(() => {
    if (wakeWords.length && voiceState === "idle" && isSupported) {
      startKwsListening()
    }
    return () => {
      stopKwsListening()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWords, isSupported])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopKwsListening()
      exitVoiceModeInternal()
    }
  }, [exitVoiceModeInternal, stopKwsListening])

  return {
    voiceState,
    isSupported,
    asrConnected,
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
