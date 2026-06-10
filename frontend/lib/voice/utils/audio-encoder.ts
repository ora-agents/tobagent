/**
 * Audio encoding utilities for ASR.
 *
 * Encodes Int16 PCM samples as WAV format with RIFF headers,
 * then converts to a base64 data URI suitable for the DashScope
 * qwen3-asr-flash REST API.
 */

/**
 * Encode Int16 PCM samples as a WAV file with RIFF header.
 * Returns a base64 data URI: ``data:audio/wav;base64,<base64>``
 *
 * @param pcm - Int16 PCM samples (mono, 16-bit signed)
 * @param sampleRate - Sample rate in Hz (default: 16000)
 */
export function int16PcmToWavDataUri(
  pcm: Int16Array,
  sampleRate: number = 16000,
): string {
  const wavBuffer = encodeWav(pcm, sampleRate)
  const base64 = arrayBufferToBase64(wavBuffer)
  return `data:audio/wav;base64,${base64}`
}

/**
 * Encode Int16 PCM samples as a WAV ArrayBuffer.
 */
export function encodeWav(
  pcm: Int16Array,
  sampleRate: number = 16000,
): ArrayBuffer {
  const numSamples = pcm.length
  const dataSize = numSamples * 2 // 16-bit = 2 bytes per sample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true) // chunk size
  writeString(view, 8, "WAVE")

  // fmt sub-chunk
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true) // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true) // audio format (PCM = 1)
  view.setUint16(22, 1, true) // num channels (mono)
  view.setUint32(24, sampleRate, true) // sample rate
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data sub-chunk
  writeString(view, 36, "data")
  view.setUint32(40, dataSize, true)

  // Write PCM samples
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(offset, pcm[i], true)
    offset += 2
  }

  return buffer
}

/**
 * Convert an ArrayBuffer to a base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Write an ASCII string into a DataView at the given offset.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
