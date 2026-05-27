/**
 * TTS WebSocket client for DashScope Realtime API.
 *
 * Connects to the FastAPI proxy endpoint which forwards to DashScope
 * with injected authentication. Supports streaming text input:
 * append text chunks as they arrive from the agent, then call finish()
 * to trigger synthesis.
 *
 * Connection flow:
 *   Browser -> ws://host:2024/ws/voice/tts -> FastAPI -> wss://dashscope
 *
 * Reference: docs/ali.md (TTS section)
 */

import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import {
  DEFAULT_TTS_VOICE,
  TTS_WS_PATH,
} from "./utils/constants"
import type { TtsEvent } from "./types"

/** Build WebSocket URL for TTS proxy from LANGGRAPH_API_URL */
function getTtsWsUrl(): string {
  const base = LANGGRAPH_API_URL.replace(/^http/, "ws")
  return `${base}${TTS_WS_PATH}`
}

/** Callback interface for TTS events */
export interface TtsCallbacks {
  /** Received audio chunk (Base64 PCM 24kHz 16-bit) */
  onAudioChunk?: (pcmBase64: string) => void
  /** Current response synthesis complete */
  onDone?: () => void
  /** Session finished (after disconnect) */
  onFinished?: () => void
  /** Error occurred */
  onError?: (error: string) => void
  /** Connection established and session created */
  onConnected?: () => void
  /** Connection closed */
  onDisconnected?: () => void
}

export class TtsClient {
  private ws: WebSocket | null = null
  private callbacks: TtsCallbacks
  private voice: string

  constructor(callbacks: TtsCallbacks = {}, voice?: string) {
    this.callbacks = callbacks
    this.voice = voice || DEFAULT_TTS_VOICE
  }

  /** Update callbacks */
  setCallbacks(callbacks: TtsCallbacks): void {
    this.callbacks = callbacks
  }

  /** Whether the WebSocket is currently connected */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the TTS proxy and configure the session.
   * Sends session.update with voice and format config.
   */
  async connect(): Promise<void> {
    if (this.isConnected) return

    const url = getTtsWsUrl()

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url)
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err}`))
        return
      }

      this.ws.onopen = () => {
        // Configure TTS session: server_commit mode for streaming text input
        const sessionUpdate = {
          type: "session.update",
          session: {
            voice: this.voice,
            response_format: "pcm_24000hz_mono_16bit",
            mode: "server_commit",
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
        const errorMsg = "TTS WebSocket error"
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
   * Append text for synthesis (streaming input).
   * Call multiple times as text chunks arrive from the agent.
   */
  appendText(text: string): void {
    if (!this.isConnected || !text) return

    const event = {
      type: "input_text_buffer.append",
      text: text,
    }
    this.ws!.send(JSON.stringify(event))
  }

  /**
   * Submit all appended text for synthesis.
   * Call after all text chunks have been appended.
   * Audio chunks will arrive via onAudioChunk callback.
   */
  finish(): void {
    if (!this.isConnected) return

    const event = {
      type: "response.create",
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

  /** Handle incoming messages from the TTS API */
  private handleMessage(rawData: string): void {
    let data: TtsEvent
    try {
      data = JSON.parse(rawData)
    } catch {
      console.error("Failed to parse TTS message:", rawData)
      return
    }

    switch (data.type) {
      case "session.created":
        // Session initialized
        break

      case "response.audio.delta":
        // Audio chunk (Base64 PCM 24kHz 16-bit)
        this.callbacks.onAudioChunk?.(data.delta)
        break

      case "response.done":
        // Current response synthesis complete
        this.callbacks.onDone?.()
        break

      case "session.finished":
        // Session finished
        this.callbacks.onFinished?.()
        break

      case "error":
        this.callbacks.onError?.(data.error?.message || "Unknown TTS error")
        break
    }
  }
}
