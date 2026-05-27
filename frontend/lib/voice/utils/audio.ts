/**
 * Audio conversion utilities for voice features.
 *
 * Handles conversions between Float32 audio samples (Web Audio API),
 * Int16 PCM (ASR input), and Base64 strings (WebSocket transport).
 */

/**
 * Convert Float32Array [-1, 1] to Int16Array [-32768, 32767].
 * Used for ASR audio encoding before Base64 serialization.
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

/**
 * Convert Int16Array to Base64 string for WebSocket transport.
 */
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert Base64 string to Float32Array for audio playback.
 * TTS API returns PCM 24kHz 16-bit encoded as Base64.
 */
export function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000
  }
  return float32
}

/**
 * Convert Int16 ArrayBuffer (from AudioWorklet) to Base64 string.
 * Used on the main thread since btoa is unavailable in Worklet scope.
 */
export function pcmBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Resample audio from one sample rate to another.
 * Uses simple averaging for downsampling (adequate for speech).
 */
export function resample(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) return buffer
  const ratio = inputRate / outputRate
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

/**
 * Convenience: Float32 audio at any rate -> Base64 PCM 16kHz.
 * Combines resample + float32ToInt16 + int16ToBase64.
 */
export function float32ToAsrBase64(
  float32: Float32Array,
  inputSampleRate: number,
): string {
  const resampled =
    inputSampleRate === 16000
      ? float32
      : resample(float32, inputSampleRate, 16000)
  return int16ToBase64(float32ToInt16(resampled))
}
