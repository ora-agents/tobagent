/**
 * TTS streaming audio player.
 *
 * Receives Base64-encoded PCM 24kHz audio chunks from the TTS API
 * and plays them seamlessly using the Web Audio API.
 *
 * Uses AudioBufferSourceNode scheduling for gapless playback:
 * each chunk is scheduled to start exactly when the previous one ends.
 */

import { base64ToFloat32 } from "./utils/audio"
import { TTS_SAMPLE_RATE } from "./utils/constants"

export interface TtsPlayerCallbacks {
  /** Called when audio playback starts */
  onPlaybackStart?: () => void
  /** Called when all queued audio has finished playing */
  onPlaybackEnd?: () => void
}

export class TtsPlayer {
  private audioCtx: AudioContext | null = null
  private sources: AudioBufferSourceNode[] = []
  private nextStartTime: number = 0
  private isPlaying: boolean = false
  private callbacks: TtsPlayerCallbacks
  private sampleRate: number = TTS_SAMPLE_RATE
  private playbackGeneration: number = 0

  constructor(callbacks: TtsPlayerCallbacks = {}) {
    this.callbacks = callbacks
  }

  /** Update callbacks */
  setCallbacks(callbacks: TtsPlayerCallbacks): void {
    this.callbacks = callbacks
  }

  /** Whether audio is currently playing */
  get playing(): boolean {
    return this.isPlaying
  }

  /** Initialize or resume the AudioContext. Only resets scheduling if not already playing. */
  async init(): Promise<void> {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate: this.sampleRate })
      // Fresh context - initialize scheduling
      this.nextStartTime = this.audioCtx.currentTime
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume()
      // After resume, reset scheduling only if nothing is queued
      if (!this.isPlaying) {
        this.nextStartTime = this.audioCtx.currentTime
      }
    }
    // If already playing, keep existing nextStartTime so new chunks
    // are scheduled after the current queue (no overlap).
  }

  /**
   * Enqueue an audio chunk for playback.
   * Decodes Base64 PCM and schedules it for seamless playback.
   */
  enqueueAudio(pcmBase64: string): void {
    if (!this.audioCtx) return

    const float32 = base64ToFloat32(pcmBase64)
    if (float32.length === 0) return

    // Create AudioBuffer
    const audioBuffer = this.audioCtx.createBuffer(
      1, // mono
      float32.length,
      this.sampleRate,
    )
    audioBuffer.getChannelData(0).set(float32)

    // Create source node and schedule
    const source = this.audioCtx.createBufferSource()
    const generation = this.playbackGeneration
    source.buffer = audioBuffer
    source.connect(this.audioCtx.destination)

    // Schedule at the right time for gapless playback
    const startTime = Math.max(this.nextStartTime, this.audioCtx.currentTime)
    source.start(startTime)
    this.nextStartTime = startTime + audioBuffer.duration

    // Track active sources
    this.sources.push(source)

    // Notify playback start on first chunk
    if (!this.isPlaying) {
      this.isPlaying = true
      this.callbacks.onPlaybackStart?.()
    }

    // Clean up source when done
    source.onended = () => {
      if (generation !== this.playbackGeneration) return

      const idx = this.sources.indexOf(source)
      if (idx !== -1) this.sources.splice(idx, 1)

      // If no more sources and we were playing, notify end
      if (this.sources.length === 0 && this.isPlaying) {
        this.isPlaying = false
        this.callbacks.onPlaybackEnd?.()
      }
    }
  }

  /** Immediately stop all playback */
  stop(): void {
    this.playbackGeneration += 1
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // Already stopped
      }
    }
    this.sources = []
    this.isPlaying = false
    this.nextStartTime = this.audioCtx?.currentTime ?? 0
  }

  /** Clear any queued (not yet playing) audio */
  clearQueue(): void {
    // Stop all sources - this effectively clears the queue
    this.stop()
  }

  /** Release all resources */
  dispose(): void {
    this.stop()
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
  }
}
