/**
 * ASR WebSocket client for DashScope Realtime API.
 *
 * Connects to the FastAPI proxy endpoint which forwards to DashScope
 * with injected authentication. Uses Server VAD mode: the server
 * detects speech boundaries, the client just streams audio frames.
 *
 * Connection flow:
 *   Browser -> ws://host:2024/ws/voice/asr -> FastAPI -> wss://dashscope
 *
 * Reference: docs/ali.md (ASR section)
 */

import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import {
  ASR_WS_PATH,
  VAD_SILENCE_DURATION_MS,
  VAD_THRESHOLD,
} from "./utils/constants"
import type { AsrEvent } from "./types"

/** Build WebSocket URL for ASR proxy from LANGGRAPH_API_URL */
function getAsrWsUrl(): string {
  // LANGGRAPH_API_URL is like http://localhost:2024 or https://...
  const base = LANGGRAPH_API_URL.replace(/^http/, "ws")
  return `${base}${ASR_WS_PATH}`
}

/** Callback interface for ASR events */
export interface AsrCallbacks {
  /** Server detected speech start */
  onSpeechStarted?: () => void
  /** Server detected speech end */
  onSpeechEnded?: () => void
  /** Transcription result (interim or final) */
  onTranscript?: (text: string, isFinal: boolean) => void
  /** Error occurred */
  onError?: (error: string) => void
  /** Connection established */
  onConnected?: () => void
  /** Connection closed */
  onDisconnected?: () => void
}

export class AsrClient {
  private ws: WebSocket | null = null
  private callbacks: AsrCallbacks

  constructor(callbacks: AsrCallbacks = {}) {
    this.callbacks = callbacks
  }

  /** Update callbacks (useful when React state changes) */
  setCallbacks(callbacks: AsrCallbacks): void {
    this.callbacks = callbacks
  }

  /** Whether the WebSocket is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the ASR proxy and configure the session.
   * Sends session.update with Server VAD config on connection.
   */
  async connect(): Promise<void> {
    if (this.isConnected) return

    const url = getAsrWsUrl()

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url)
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err}`))
        return
      }

      this.ws.onopen = () => {
        // Send session.update with Server VAD configuration
        const sessionUpdate = {
          event_id: `event_init_${Date.now()}`,
          type: "session.update",
          session: {
            modalities: ["text"],
            input_audio_format: "pcm",
            sample_rate: 16000,
            input_audio_transcription: {
              language: "zh",
            },
            turn_detection: {
              type: "server_vad",
              threshold: VAD_THRESHOLD,
              silence_duration_ms: VAD_SILENCE_DURATION_MS,
            },
          },
        }
        this.ws!.send(JSON.stringify(sessionUpdate))
        this.callbacks.onConnected?.()
        resolve()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (event: Event) => {
        const errorMsg = "ASR WebSocket error"
        console.error(errorMsg, event)
        this.callbacks.onError?.(errorMsg)
        reject(new Error(errorMsg))
      }

      this.ws.onclose = () => {
        this.callbacks.onDisconnected?.()
        this.ws = null
      }
    })
  }

  /**
   * Send an audio frame (Base64-encoded 16kHz PCM 16-bit).
   * No-op if not connected.
   */
  sendAudio(pcmBase64: string): void {
    if (!this.isConnected) return

    const event = {
      event_id: `event_${Date.now()}`,
      type: "input_audio_buffer.append",
      audio: pcmBase64,
    }
    this.ws!.send(JSON.stringify(event))
  }

  /** Disconnect the WebSocket */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /** Handle incoming messages from the ASR API */
  private handleMessage(rawData: string): void {
    let data: AsrEvent
    try {
      data = JSON.parse(rawData)
    } catch {
      console.error("Failed to parse ASR message:", rawData)
      return
    }

    switch (data.type) {
      case "session.created":
        // Session initialized, ready to receive audio
        break

      case "input_audio_buffer.speech_started":
        this.callbacks.onSpeechStarted?.()
        break

      case "input_audio_buffer.speech_stopped":
        this.callbacks.onSpeechEnded?.()
        break

      case "conversation.item.input_audio_transcription.delta":
        // Interim result (real-time display)
        this.callbacks.onTranscript?.(data.delta, false)
        break

      case "conversation.item.input_audio_transcription.completed":
        // Final result (auto-send)
        this.callbacks.onTranscript?.(data.transcript, true)
        break

      case "error":
        this.callbacks.onError?.(data.error?.message || "Unknown ASR error")
        break
    }
  }
}
