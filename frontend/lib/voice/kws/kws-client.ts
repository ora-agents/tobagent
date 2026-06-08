/**
 * KWS (Keyword Spotting) WebSocket Client
 *
 * Manages a continuous audio stream to the backend KWS endpoint for
 * always-on wake word detection. When a wake word is detected, the
 * client signals via callback so the voice agent can transition to
 * full voice mode.
 *
 * Audio pipeline:
 *   Microphone -> AudioWorklet (16kHz resample) -> Int16 PCM -> WebSocket (binary)
 *
 * Protocol:
 *   1. Send JSON config: {"type": "config", "keywords": ["小梯小梯", ...]}
 *   2. Send binary Int16 PCM frames (16kHz, mono)
 *   3. Receive JSON: {"type": "detection", "keyword": "小梯小梯"}
 */

import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import { getAudioContextConstructor } from "@/lib/voice/utils/browser"
import { VOICE_SESSION_WS_PATH } from "../utils/constants"

/** Path to the shared AudioWorklet processor */
const WORKLET_PATH = "/voice/audio-processor.worklet.js"

/** Maximum reconnect attempts */
const MAX_RECONNECT_ATTEMPTS = 3

/** Base reconnect delay in ms (exponential backoff) */
const RECONNECT_BASE_DELAY_MS = 1000

/** Callback interface for KWS events */
export interface KwsCallbacks {
  /** Wake word detected */
  onDetection: (keyword: string) => void
  /** Backend voice mode changed */
  onMode?: (mode: "kws" | "asr") => void
  /** Backend VAD detected speech start */
  onSpeechStart?: () => void
  /** Backend started transcribing a completed speech segment */
  onTranscribing?: () => void
  /** Backend ASR produced final transcript */
  onTranscript?: (text: string) => void
  /** Backend TTS audio chunk for short session sounds */
  onTtsAudio?: (purpose: string, pcmBase64: string) => void
  /** Backend TTS stream finished */
  onTtsDone?: (purpose: string) => void
  /** Connection error or server error */
  onError?: (error: string) => void
  /** WebSocket connected and streaming */
  onConnected?: () => void
  /** WebSocket disconnected */
  onDisconnected?: () => void
}

/** Build WebSocket URL for KWS endpoint */
function getKwsWsUrl(): string {
  const base = LANGGRAPH_API_URL.replace(/^http/, "ws")
  return `${base}${VOICE_SESSION_WS_PATH}`
}

export class KwsClient {
  private ws: WebSocket | null = null
  private audioContext: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private callbacks: KwsCallbacks
  private keywords: string[] = []
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalStop = false
  private connectGeneration = 0
  private isStarting = false

  constructor(callbacks: KwsCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Start KWS listening.
   * Requests microphone access, sets up AudioWorklet, and opens WebSocket.
   */
  async start(keywords: string[]): Promise<void> {
    this.stop()

    if (!keywords.length) return

    this.keywords = keywords
    this.intentionalStop = false
    this.reconnectAttempts = 0
    this.isStarting = true
    const generation = ++this.connectGeneration

    try {
      await this._connect(generation)
    } finally {
      if (this.connectGeneration === generation) {
        this.isStarting = false
      }
    }
  }

  /** Stop KWS listening and release all resources. */
  stop(): void {
    this.intentionalStop = true
    this.connectGeneration++
    this.isStarting = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this._teardown()
  }

  /** Update wake words without restarting microphone capture when connected. */
  updateKeywords(keywords: string[]): void {
    this.keywords = keywords

    if (!keywords.length) {
      this.stop()
      return
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ type: "config", keywords: this.keywords }),
      )
    }
  }

  /** Switch how the unified backend session handles subsequent audio frames. */
  setMode(mode: "kws" | "asr"): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "mode", mode }))
    }
  }

  /** Whether the client is currently connected and streaming. */
  get isActive(): boolean {
    return (
      this.isStarting ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    )
  }

  // ========================================================================
  // Private
  // ========================================================================

  private isCurrentGeneration(generation: number): boolean {
    return !this.intentionalStop && this.connectGeneration === generation
  }

  private async _connect(generation: number): Promise<void> {
    try {
      // 1. Request microphone access
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      if (!this.isCurrentGeneration(generation)) {
        mediaStream.getTracks().forEach((track) => track.stop())
        return
      }
      this.mediaStream = mediaStream

      // 2. Create AudioContext
      const AudioContextCtor = getAudioContextConstructor()
      if (!AudioContextCtor) {
        throw new Error("Voice input is not supported in this browser")
      }
      const audioContext = new AudioContextCtor()
      if (!this.isCurrentGeneration(generation)) {
        audioContext.close().catch(() => {})
        return
      }
      this.audioContext = audioContext

      // 3. Load AudioWorklet
      await audioContext.audioWorklet.addModule(WORKLET_PATH)
      if (!this.isCurrentGeneration(generation)) {
        audioContext.close().catch(() => {})
        this.audioContext = null
        return
      }

      // 4. Create worklet node
      this.workletNode = new AudioWorkletNode(
        audioContext,
        "audio-processor",
      )

      // 5. Open WebSocket
      const url = getKwsWsUrl()
      const ws = new WebSocket(url)
      if (!this.isCurrentGeneration(generation)) {
        ws.close()
        this._teardown()
        return
      }
      this.ws = ws

      ws.onopen = () => {
        if (!this.isCurrentGeneration(generation)) {
          ws.close()
          return
        }
        // Send config message with keywords
        ws.send(
          JSON.stringify({ type: "config", keywords: this.keywords }),
        )
        ws.send(JSON.stringify({ type: "mode", mode: "kws" }))

        // Wire audio: mic -> worklet -> WebSocket
        this.sourceNode = audioContext.createMediaStreamSource(
          this.mediaStream!,
        )
        this.sourceNode.connect(this.workletNode!)

        this.workletNode!.port.onmessage = (event: MessageEvent) => {
          if (
            event.data.type === "audio" &&
            this.ws?.readyState === WebSocket.OPEN
          ) {
            // Send Int16 PCM directly as binary (no base64)
            this.ws.send(event.data.int16)
          }
        }

        // Start the worklet
        this.workletNode!.port.postMessage({ type: "start" })
        this.reconnectAttempts = 0
        this.callbacks.onConnected?.()
      }

      ws.onmessage = (event) => {
        if (!this.isCurrentGeneration(generation)) return
        console.log("[KWS] Received message:", event.data)
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === "detection") {
            console.log("[KWS] Detection event:", msg.keyword)
            this.callbacks.onDetection(msg.keyword)
          } else if (msg.type === "mode") {
            if (msg.mode === "kws" || msg.mode === "asr") {
              this.callbacks.onMode?.(msg.mode)
            }
          } else if (msg.type === "speech_start") {
            this.callbacks.onSpeechStart?.()
          } else if (msg.type === "transcribing") {
            this.callbacks.onTranscribing?.()
          } else if (msg.type === "transcript") {
            if (typeof msg.text === "string") {
              this.callbacks.onTranscript?.(msg.text)
            }
          } else if (msg.type === "tts_audio") {
            if (
              typeof msg.purpose === "string" &&
              typeof msg.delta === "string"
            ) {
              this.callbacks.onTtsAudio?.(msg.purpose, msg.delta)
            }
          } else if (msg.type === "tts_done") {
            if (typeof msg.purpose === "string") {
              this.callbacks.onTtsDone?.(msg.purpose)
            }
          } else if (msg.type === "error") {
            console.error("[KWS] Server error:", msg.message)
            this.callbacks.onError?.(msg.message)
          }
        } catch (err) {
          console.error("[KWS] Failed to parse message:", err)
          // Ignore non-JSON messages
        }
      }

      ws.onclose = (event) => {
        const shouldReconnect = this.isCurrentGeneration(generation)
        this._teardown()
        this.callbacks.onDisconnected?.()

        // Auto-reconnect if not intentional and no keywords error
        if (
          shouldReconnect &&
          event.code !== 1008 && // 1008 = policy violation (no keywords / config error)
          this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
        ) {
          this._scheduleReconnect(generation)
        }
      }

      ws.onerror = () => {
        // onclose will fire after onerror, handling cleanup and reconnect
      }
    } catch (err) {
      // Mic permission denied or other setup failure
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied for wake word detection"
          : err instanceof Error
            ? err.message
            : "Failed to start KWS"

      this._teardown()
      this.callbacks.onError?.(msg)
    }
  }

  private _scheduleReconnect(generation: number): void {
    this.reconnectAttempts++
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1)

    this.reconnectTimer = setTimeout(async () => {
      if (this.isCurrentGeneration(generation)) {
        try {
          await this._connect(generation)
        } catch {
          // _connect handles its own error callback
        }
      }
    }, delay)
  }

  /** Tear down all audio and WebSocket resources. */
  private _teardown(): void {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: "stop" })
      this.workletNode.disconnect()
      this.workletNode = null
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop())
      this.mediaStream = null
    }

    if (this.ws) {
      // Remove handlers before closing to avoid triggering reconnect
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.onopen = null
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close()
      }
      this.ws = null
    }
  }
}
