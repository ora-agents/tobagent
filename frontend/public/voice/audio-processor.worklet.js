/**
 * AudioWorklet processor for voice capture.
 *
 * Runs in the AudioWorklet thread (off main thread).
 * Captures audio from MediaStream, resamples to 16kHz,
 * converts to Int16 PCM, and posts the raw ArrayBuffer
 * to the main thread for Base64 encoding (btoa is not
 * available in AudioWorklet scope).
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

// Float32 [-1,1] -> Int16 PCM ArrayBuffer
function float32ToInt16Buffer(float32, sampleRate) {
  // Resample to 16kHz if needed
  const resampled = downsampleBuffer(float32, sampleRate, 16000)

  // Float32 -> Int16
  const int16 = new Int16Array(resampled.length)
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  return int16.buffer
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
      const buffer = float32ToInt16Buffer(samples, this.inputSampleRate)

      // Send raw ArrayBuffer to main thread via Transferable
      // Main thread will do Base64 encoding (btoa not available here)
      this.port.postMessage({ type: "audio", buffer: buffer }, [buffer])
    }

    return true
  }
}

registerProcessor("audio-processor", AudioProcessor)
