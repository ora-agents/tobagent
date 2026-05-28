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

// Resample from input sample rate to target 16kHz
function downsampleBuffer(buffer, inputSampleRate, targetSampleRate) {
  if (inputSampleRate === targetSampleRate) return buffer
  const ratio = inputSampleRate / targetSampleRate
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < newLength) {
    const nextOffset = Math.round((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffset && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[offsetResult++] = accum / count
    offsetBuffer = nextOffset
  }
  return result
}

class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isActive = false
    this.inputSampleRate = sampleRate // AudioWorklet global: actual sample rate

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
      const resampledFloat32 = downsampleBuffer(samples, this.inputSampleRate, 16000)

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
}

registerProcessor("audio-processor", AudioProcessor)
