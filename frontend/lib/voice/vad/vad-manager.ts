/**
 * VAD Manager — high-level voice activity detection using sherpa-onnx.
 *
 * Owns the VAD instance, feeds audio from the worklet, tracks speech state,
 * and buffers the speech segment's Int16 PCM for ASR submission.
 *
 * The VAD consumes Float32 16kHz audio in 256-sample windows (16ms).
 * When speech is detected, we accumulate the corresponding Int16 PCM.
 * When speech ends, the complete Int16 segment is emitted for transcription.
 */

import {
  loadSherpaOnnxModule,
  type SherpaOnnxModule,
  Vad,
  CircularBuffer,
} from "./sherpa-onnx-vad-wrapper"
import {
  VAD_WINDOW_SIZE,
  VAD_SAMPLE_RATE,
  VAD_THRESHOLD,
  VAD_MIN_SILENCE_DURATION,
  VAD_MIN_SPEECH_DURATION,
} from "../utils/constants"

// ============================================================================
// Types
// ============================================================================

/** A complete speech segment ready for ASR transcription */
export interface SpeechSegment {
  /** Int16 PCM samples for the complete utterance (16kHz, mono) */
  pcmInt16: Int16Array
  /** Duration in seconds */
  durationSeconds: number
}

/** Callbacks for VAD events */
export interface VadCallbacks {
  /** Speech activity started */
  onSpeechStart: () => void
  /** Speech activity ended — segment is ready for transcription */
  onSpeechEnd: (segment: SpeechSegment) => void
  /** Error occurred during VAD processing */
  onError: (error: string) => void
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum segment duration (seconds) to consider as real speech (not noise) */
const MIN_SEGMENT_DURATION_S = 0.3

/** Maximum segment duration (seconds) — VAD auto-segments beyond this */
const MAX_SPEECH_DURATION_S = 20

/** Circular buffer capacity in samples (30 seconds at 16kHz) */
const CIRCULAR_BUFFER_CAPACITY = 30 * VAD_SAMPLE_RATE

/**
 * Pre-speech buffer duration in milliseconds.
 * VAD has inherent detection latency (needs multiple consecutive speech
 * frames before isDetected() returns true). We keep this much audio before
 * detection so the speech onset is not lost.
 */
const PRE_SPEECH_BUFFER_MS = 300
const PRE_SPEECH_BUFFER_SAMPLES = (PRE_SPEECH_BUFFER_MS * VAD_SAMPLE_RATE) / 1000

// ============================================================================
// VadManager
// ============================================================================

export class VadManager {
  private module: SherpaOnnxModule | null = null
  private vad: Vad | null = null
  private circularBuffer: CircularBuffer | null = null

  private isSpeaking = false
  private speechPcmChunks: Int16Array[] = []
  /** Rolling buffer of recent Int16 audio — used to prepend pre-speech audio on detection */
  private preSpeechBuffer: Int16Array[] = []
  private preSpeechSampleCount = 0
  private initialized = false

  constructor(private callbacks: VadCallbacks) {}

  /**
   * Initialize the VAD engine.
   * Lazy-loads the sherpa-onnx WASM module on first call.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    try {
      const { module } = await loadSherpaOnnxModule()
      this.module = module

      // Create VAD instance with Ten VAD model
      this.vad = new Vad(
        {
          sileroVad: {
            model: "",
            threshold: VAD_THRESHOLD,
            minSilenceDuration: VAD_MIN_SILENCE_DURATION,
            minSpeechDuration: VAD_MIN_SPEECH_DURATION,
            windowSize: 512,
            maxSpeechDuration: MAX_SPEECH_DURATION_S,
          },
          tenVad: {
            model: "./ten-vad.onnx",
            threshold: VAD_THRESHOLD,
            minSilenceDuration: VAD_MIN_SILENCE_DURATION,
            minSpeechDuration: VAD_MIN_SPEECH_DURATION,
            windowSize: VAD_WINDOW_SIZE,
            maxSpeechDuration: MAX_SPEECH_DURATION_S,
          },
          sampleRate: VAD_SAMPLE_RATE,
          numThreads: 1,
          provider: "cpu",
          debug: 0,
          bufferSizeInSeconds: 30,
        },
        module,
      )

      // Create circular buffer for windowed audio feeding
      this.circularBuffer = new CircularBuffer(CIRCULAR_BUFFER_CAPACITY, module)

      this.initialized = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to initialize VAD"
      this.callbacks.onError(msg)
      throw err
    }
  }

  /**
   * Feed 16kHz audio samples from the worklet.
   *
   * @param float32 - Float32 samples at 16kHz (for VAD detection)
   * @param int16 - Int16 samples at 16kHz (for ASR payload buffering)
   */
  processAudio(float32: Float32Array, int16: Int16Array): void {
    if (!this.initialized || !this.vad || !this.circularBuffer) return

    try {
      // Push Float32 samples into circular buffer
      this.circularBuffer.push(float32)

      // Always maintain pre-speech ring buffer (trimmed to PRE_SPEECH_BUFFER_SAMPLES)
      const int16Copy = new Int16Array(int16)
      this.preSpeechBuffer.push(int16Copy)
      this.preSpeechSampleCount += int16Copy.length
      while (this.preSpeechSampleCount > PRE_SPEECH_BUFFER_SAMPLES && this.preSpeechBuffer.length > 0) {
        this.preSpeechSampleCount -= this.preSpeechBuffer[0].length
        this.preSpeechBuffer.shift()
      }

      // Feed VAD in window-sized chunks
      while (this.circularBuffer.size() >= VAD_WINDOW_SIZE) {
        const window = this.circularBuffer.get(
          this.circularBuffer.head(),
          VAD_WINDOW_SIZE,
        )
        this.vad.acceptWaveform(window)
        this.circularBuffer.pop(VAD_WINDOW_SIZE)
      }

      // Check speech detection state
      const detected = this.vad.isDetected()

      if (detected && !this.isSpeaking) {
        // Speech started — seed with pre-speech buffer so onset is not lost.
        // The current int16Copy is already in preSpeechBuffer, so we include
        // it via the spread and skip the explicit push below for this frame.
        this.isSpeaking = true
        this.speechPcmChunks = [...this.preSpeechBuffer]
        this.callbacks.onSpeechStart()
      } else if (this.isSpeaking) {
        // Ongoing speech — accumulate current frame
        this.speechPcmChunks.push(int16Copy)
      }

      if (!detected && this.isSpeaking) {
        // Speech ended
        this.isSpeaking = false

        // Drain any completed segments from VAD
        while (!this.vad.isEmpty()) {
          this.vad.front() // acknowledge the segment
          this.vad.pop()
        }

        // Merge all accumulated Int16 chunks
        const totalLength = this.speechPcmChunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        )

        if (totalLength > 0) {
          const mergedPcm = new Int16Array(totalLength)
          let offset = 0
          for (const chunk of this.speechPcmChunks) {
            mergedPcm.set(chunk, offset)
            offset += chunk.length
          }

          const durationSeconds = mergedPcm.length / VAD_SAMPLE_RATE

          // Filter out very short utterances (likely noise)
          if (durationSeconds >= MIN_SEGMENT_DURATION_S) {
            this.callbacks.onSpeechEnd({
              pcmInt16: mergedPcm,
              durationSeconds,
            })
          }
        }

        this.speechPcmChunks = []
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "VAD processing error"
      console.error("[VadManager]", msg, err)
      this.callbacks.onError(msg)
    }
  }

  /** Whether speech is currently being detected */
  get speaking(): boolean {
    return this.isSpeaking
  }

  /** Reset VAD state (call on voice mode exit) */
  reset(): void {
    if (this.vad) {
      this.vad.reset()
      this.vad.clear()
    }
    if (this.circularBuffer) {
      this.circularBuffer.reset()
    }
    this.isSpeaking = false
    this.speechPcmChunks = []
    this.preSpeechBuffer = []
    this.preSpeechSampleCount = 0
  }

  /** Dispose VAD resources and free WASM memory */
  dispose(): void {
    this.reset()
    if (this.vad) {
      this.vad.free()
      this.vad = null
    }
    if (this.circularBuffer) {
      this.circularBuffer.free()
      this.circularBuffer = null
    }
    this.initialized = false
  }
}
