/**
 * AudioWorklet processor for voice capture.
 *
 * Runs in the AudioWorklet thread (off main thread).
 * Captures audio from MediaStream, resamples to 16kHz,
 * and posts both Float32 (for client-side VAD) and Int16 PCM
 * (for ASR payload) to the main thread as Transferable ArrayBuffers.
 *
 * Registered as 'audio-processor'.
 */

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isActive = false
    this.inputSampleRate = sampleRate // AudioWorklet global: actual sample rate
    this.targetSampleRate = 16000
    this.sourcePosition = 0
    this.pendingInput = new Float32Array(0)

    // Listen for start/stop messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === "start") {
        this.isActive = true
      } else if (event.data.type === "stop") {
        this.isActive = false
      }
    }
  }

  process(inputs) {
    if (!this.isActive) return true

    const input = inputs[0]
    if (input && input[0] && input[0].length > 0) {
      // Copy the channel data (it's reused by the audio engine)
      const samples = new Float32Array(input[0])

      // Resample to 16kHz Float32 (for client-side VAD)
      const resampledFloat32 = this.resample(samples)
      if (resampledFloat32.length === 0) {
        return true
      }

      // Convert Float32 to Int16 PCM (for ASR payload)
      const int16 = new Int16Array(resampledFloat32.length)
      for (let i = 0; i < resampledFloat32.length; i++) {
        const s = Math.max(-1, Math.min(1, resampledFloat32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }

      // Create transferable copies of both formats
      const float32Buffer = resampledFloat32.buffer.slice(0)
      const int16Buffer = int16.buffer.slice(0)

      // Send both Float32 (for VAD) and Int16 (for ASR) to main thread
      this.port.postMessage(
        { type: "audio", float32: float32Buffer, int16: int16Buffer },
        [float32Buffer, int16Buffer]
      )
    }

    return true
  }

  resample(samples) {
    if (this.inputSampleRate === this.targetSampleRate) {
      return samples
    }

    const input = new Float32Array(this.pendingInput.length + samples.length)
    input.set(this.pendingInput)
    input.set(samples, this.pendingInput.length)

    const ratio = this.inputSampleRate / this.targetSampleRate
    const outputLength = Math.max(0, Math.floor((input.length - 1 - this.sourcePosition) / ratio))
    const output = new Float32Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const position = this.sourcePosition + i * ratio
      const index = Math.floor(position)
      const fraction = position - index
      const current = input[index] || 0
      const next = input[index + 1] || current
      output[i] = current + (next - current) * fraction
    }

    const consumed = Math.floor(this.sourcePosition + outputLength * ratio)
    const keepFrom = Math.max(0, consumed)
    this.pendingInput = input.slice(keepFrom)
    this.sourcePosition = this.sourcePosition + outputLength * ratio - keepFrom

    return output
  }
}

registerProcessor("audio-processor", AudioProcessor)
