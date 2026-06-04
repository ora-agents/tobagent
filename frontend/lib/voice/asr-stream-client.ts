/**
 * Streaming ASR client backed by server-side VAD.
 *
 * The browser streams 16kHz Int16 PCM frames to FastAPI. The server runs VAD,
 * calls ASR when an utterance ends, and returns transcript events.
 */

import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import { ASR_WS_PATH } from "./utils/constants"

export interface StreamingAsrCallbacks {
  onConnected?: () => void
  onDisconnected?: () => void
  onSpeechStart?: () => void
  onTranscribing?: () => void
  onTranscript?: (text: string) => void
  onError?: (error: string) => void
}

type StreamingAsrMessage =
  | { type: "ready" }
  | { type: "speech_start" }
  | { type: "transcribing" }
  | { type: "transcript"; text: string }
  | { type: "error"; message: string }

function getAsrWsUrl(): string {
  const base = LANGGRAPH_API_URL.replace(/^http/, "ws")
  return `${base}${ASR_WS_PATH}`
}

export class StreamingAsrClient {
  private ws: WebSocket | null = null
  private callbacks: StreamingAsrCallbacks

  constructor(callbacks: StreamingAsrCallbacks = {}) {
    this.callbacks = callbacks
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  async connect(): Promise<void> {
    if (this.isConnected) return

    const url = getAsrWsUrl()

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(url)
        this.ws.binaryType = "arraybuffer"
      } catch (err) {
        reject(new Error(`Failed to create ASR WebSocket: ${err}`))
        return
      }

      this.ws.onopen = () => {
        this.callbacks.onConnected?.()
        resolve()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return
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

  sendAudio(int16Buffer: ArrayBuffer): void {
    if (!this.isConnected) return
    this.ws!.send(int16Buffer)
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private handleMessage(rawData: string): void {
    let data: StreamingAsrMessage
    try {
      data = JSON.parse(rawData)
    } catch {
      console.error("Failed to parse ASR message:", rawData)
      return
    }

    switch (data.type) {
      case "ready":
        break
      case "speech_start":
        this.callbacks.onSpeechStart?.()
        break
      case "transcribing":
        this.callbacks.onTranscribing?.()
        break
      case "transcript":
        this.callbacks.onTranscript?.(data.text)
        break
      case "error":
        this.callbacks.onError?.(data.message)
        break
    }
  }
}
