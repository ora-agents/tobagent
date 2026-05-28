/**
 * ASR client for DashScope qwen3-asr-flash REST API.
 *
 * Sends complete speech segments (detected by client-side VAD) to the
 * backend REST endpoint for transcription. Unlike the previous WebSocket
 * client, this does NOT stream audio continuously — each request carries
 * a full utterance encoded as a WAV data URI.
 *
 * Flow:
 *   VadManager detects speech end → AsrClient.transcribeSegment(pcmInt16)
 *   → POST /api/asr/transcribe { audio: "data:audio/wav;base64,..." }
 *   ← { text: "...", language: "...", duration_seconds: ... }
 */

import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import { ASR_REST_PATH } from "./utils/constants"
import { int16PcmToWavDataUri } from "./vad/audio-encoder"

/** Callback interface for ASR events */
export interface AsrCallbacks {
  /** Transcription result (always final — no interim results) */
  onTranscript?: (text: string, isFinal: boolean) => void
  /** Error occurred */
  onError?: (error: string) => void
  /** Client ready (immediate for HTTP client) */
  onConnected?: () => void
  /** Client disconnected */
  onDisconnected?: () => void
}

/** Build REST URL for ASR transcription endpoint */
function getAsrRestUrl(): string {
  return `${LANGGRAPH_API_URL}${ASR_REST_PATH}`
}

export class AsrClient {
  private callbacks: AsrCallbacks
  private abortController: AbortController | null = null

  constructor(callbacks: AsrCallbacks = {}) {
    this.callbacks = callbacks
  }

  /** Update callbacks (useful when React state changes) */
  setCallbacks(callbacks: AsrCallbacks): void {
    this.callbacks = callbacks
  }

  /** Always true — HTTP client has no persistent connection */
  get isConnected(): boolean {
    return true
  }

  /** No-op for HTTP client — immediately reports connected */
  async connect(): Promise<void> {
    this.callbacks.onConnected?.()
  }

  /** No-op — audio is sent via transcribeSegment(), not streaming */
  sendAudio(_pcmBase64: string): void {
    // Intentionally empty — kept for API compatibility
  }

  /**
   * Transcribe a complete speech segment.
   *
   * Called by VadManager when speech ends. Encodes the Int16 PCM as a
   * WAV data URI and POSTs it to the backend REST endpoint.
   *
   * @param pcmInt16 - Int16 PCM samples (16kHz, mono)
   * @returns The transcription text, or null if empty/aborted
   */
  async transcribeSegment(pcmInt16: Int16Array): Promise<string | null> {
    // Cancel any in-flight request
    this.abortController?.abort()
    this.abortController = new AbortController()

    const audioDataUri = int16PcmToWavDataUri(pcmInt16, 16000)
    const url = getAsrRestUrl()

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioDataUri }),
        signal: this.abortController.signal,
      })

      if (!response.ok) {
        const errBody = await response.text().catch(() => "")
        throw new Error(`ASR error (${response.status}): ${errBody || response.statusText}`)
      }

      const result = await response.json()
      const text = result.text?.trim() || ""

      if (text) {
        this.callbacks.onTranscript?.(text, true)
      }

      return text || null
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return null
      }
      const msg = err instanceof Error ? err.message : "ASR request failed"
      this.callbacks.onError?.(msg)
      return null
    }
  }

  /** Cancel any in-flight transcription and clean up */
  disconnect(): void {
    this.abortController?.abort()
    this.abortController = null
    this.callbacks.onDisconnected?.()
  }
}
