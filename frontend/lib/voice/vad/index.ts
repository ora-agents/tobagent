/**
 * VAD module barrel export.
 */

export { VadManager, type SpeechSegment, type VadCallbacks } from "./vad-manager"
export { int16PcmToWavDataUri, encodeWav } from "./audio-encoder"
export { loadSherpaOnnxModule, Vad, CircularBuffer } from "./sherpa-onnx-vad-wrapper"
