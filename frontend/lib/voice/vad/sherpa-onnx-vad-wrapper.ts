/**
 * Sherpa-ONNX WASM module loader for VAD.
 *
 * Lazy-loads the sherpa-onnx Emscripten WASM module via dynamic script
 * injection. The VAD-only module is only fetched
 * when voice mode is first activated, then cached for subsequent use.
 *
 * The CircularBuffer and Vad wrapper classes are implemented directly
 * in TypeScript using the Module's C API, avoiding reliance on global
 * scope from the original sherpa-onnx-vad.js wrapper.
 */

import { SHERPA_ONNX_BASE_PATH } from "../utils/constants"

// Singleton promise — ensures the module is only loaded once
let modulePromise: Promise<{ module: SherpaOnnxModule }> | null = null
let preloadStarted = false

const LOAD_TIMEOUT_MS = 30000

/**
 * Shape of the sherpa-onnx Emscripten Module after initialization.
 * Only includes the APIs we actually use.
 */
export interface SherpaOnnxModule {
  // Emscripten internals
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  setValue: (ptr: number, value: number, type: string) => void
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => void
  lengthBytesUTF8: (str: string) => number
  HEAPF32: Float32Array
  HEAP32: Int32Array

  // CircularBuffer C API
  _SherpaOnnxCreateCircularBuffer: (capacity: number) => number
  _SherpaOnnxDestroyCircularBuffer: (handle: number) => void
  _SherpaOnnxCircularBufferPush: (handle: number, ptr: number, n: number) => void
  _SherpaOnnxCircularBufferGet: (handle: number, start: number, n: number) => number
  _SherpaOnnxCircularBufferFree: (ptr: number) => void
  _SherpaOnnxCircularBufferPop: (handle: number, n: number) => void
  _SherpaOnnxCircularBufferSize: (handle: number) => number
  _SherpaOnnxCircularBufferHead: (handle: number) => number
  _SherpaOnnxCircularBufferReset: (handle: number) => void

  // VAD C API
  _SherpaOnnxCreateVoiceActivityDetector: (configPtr: number, bufferSize: number) => number
  _SherpaOnnxDestroyVoiceActivityDetector: (handle: number) => void
  _SherpaOnnxVoiceActivityDetectorAcceptWaveform: (handle: number, ptr: number, n: number) => void
  _SherpaOnnxVoiceActivityDetectorEmpty: (handle: number) => number
  _SherpaOnnxVoiceActivityDetectorDetected: (handle: number) => number
  _SherpaOnnxVoiceActivityDetectorPop: (handle: number) => void
  _SherpaOnnxVoiceActivityDetectorClear: (handle: number) => void
  _SherpaOnnxVoiceActivityDetectorFront: (handle: number) => number
  _SherpaOnnxVoiceActivityDetectorReset: (handle: number) => void
  _SherpaOnnxVoiceActivityDetectorFlush: (handle: number) => void
  _SherpaOnnxDestroySpeechSegment: (handle: number) => void

  // Copy heap helper
  _CopyHeap: (srcPtr: number, len: number, dstPtr: number) => void
}

export interface VadConfig {
  sileroVad?: {
    model: string
    threshold?: number
    minSilenceDuration?: number
    minSpeechDuration?: number
    windowSize?: number
    maxSpeechDuration?: number
  }
  tenVad?: {
    model: string
    threshold?: number
    minSilenceDuration?: number
    minSpeechDuration?: number
    windowSize?: number
    maxSpeechDuration?: number
  }
  sampleRate?: number
  numThreads?: number
  provider?: string
  debug?: number
  bufferSizeInSeconds?: number
}

// ============================================================================
// CircularBuffer — TypeScript implementation using Module C API
// ============================================================================

/**
 * Circular buffer for audio sample accumulation.
 * Wraps the sherpa-onnx CircularBuffer C API.
 */
export class CircularBuffer {
  private handle: number
  private Module: SherpaOnnxModule

  constructor(capacity: number, module: SherpaOnnxModule) {
    this.handle = module._SherpaOnnxCreateCircularBuffer(capacity)
    this.Module = module
  }

  free(): void {
    if (this.handle) {
      this.Module._SherpaOnnxDestroyCircularBuffer(this.handle)
      this.handle = 0
    }
  }

  push(samples: Float32Array): void {
    const pointer = this.Module._malloc(samples.length * samples.BYTES_PER_ELEMENT)
    this.Module.HEAPF32.set(samples, pointer / samples.BYTES_PER_ELEMENT)
    this.Module._SherpaOnnxCircularBufferPush(this.handle, pointer, samples.length)
    this.Module._free(pointer)
  }

  get(startIndex: number, n: number): Float32Array {
    const p = this.Module._SherpaOnnxCircularBufferGet(this.handle, startIndex, n)
    const samplesPtr = p / 4
    const samples = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      samples[i] = this.Module.HEAPF32[samplesPtr + i]
    }
    this.Module._SherpaOnnxCircularBufferFree(p)
    return samples
  }

  pop(n: number): void {
    this.Module._SherpaOnnxCircularBufferPop(this.handle, n)
  }

  size(): number {
    return this.Module._SherpaOnnxCircularBufferSize(this.handle)
  }

  head(): number {
    return this.Module._SherpaOnnxCircularBufferHead(this.handle)
  }

  reset(): void {
    this.Module._SherpaOnnxCircularBufferReset(this.handle)
  }
}

// ============================================================================
// Vad — TypeScript implementation using Module C API
// ============================================================================

/**
 * Voice Activity Detector.
 * Wraps the sherpa-onnx VoiceActivityDetector C API.
 */
export class Vad {
  private handle: number
  private Module: SherpaOnnxModule
  public config: VadConfig

  constructor(config: VadConfig, module: SherpaOnnxModule) {
    this.config = config
    this.Module = module

    // Build the C config struct
    const configPtr = this.buildConfig(config)
    this.handle = module._SherpaOnnxCreateVoiceActivityDetector(
      configPtr,
      config.bufferSizeInSeconds || 30,
    )
    module._free(configPtr)
  }

  private buildConfig(config: VadConfig): number {
    const Module = this.Module

    const sileroConfig = config.sileroVad || {
      model: "",
      threshold: 0.5,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.25,
      windowSize: 512,
      maxSpeechDuration: 20,
    }

    const tenConfig = config.tenVad || {
      model: "./ten-vad.onnx",
      threshold: 0.5,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.25,
      windowSize: 256,
      maxSpeechDuration: 20,
    }

    // Build Silero VAD config struct: ptr(4) + float(4) + float(4) + float(4) + int(4) + float(4) = 24 bytes
    const sileroModelLen = Module.lengthBytesUTF8(sileroConfig.model || "") + 1
    const sileroModelPtr = Module._malloc(sileroModelLen)
    Module.stringToUTF8(sileroConfig.model || "", sileroModelPtr, sileroModelLen)

    const sileroPtr = Module._malloc(24)
    let offset = 0
    Module.setValue(sileroPtr + offset, sileroModelPtr, "i8*")
    offset += 4
    Module.setValue(sileroPtr + offset, sileroConfig.threshold || 0.5, "float")
    offset += 4
    Module.setValue(sileroPtr + offset, sileroConfig.minSilenceDuration || 0.5, "float")
    offset += 4
    Module.setValue(sileroPtr + offset, sileroConfig.minSpeechDuration || 0.25, "float")
    offset += 4
    Module.setValue(sileroPtr + offset, sileroConfig.windowSize || 512, "i32")
    offset += 4
    Module.setValue(sileroPtr + offset, sileroConfig.maxSpeechDuration || 20, "float")

    // Build Ten VAD config struct (same layout, 24 bytes)
    const tenModelLen = Module.lengthBytesUTF8(tenConfig.model || "") + 1
    const tenModelPtr = Module._malloc(tenModelLen)
    Module.stringToUTF8(tenConfig.model || "", tenModelPtr, tenModelLen)

    const tenPtr = Module._malloc(24)
    offset = 0
    Module.setValue(tenPtr + offset, tenModelPtr, "i8*")
    offset += 4
    Module.setValue(tenPtr + offset, tenConfig.threshold || 0.5, "float")
    offset += 4
    Module.setValue(tenPtr + offset, tenConfig.minSilenceDuration || 0.5, "float")
    offset += 4
    Module.setValue(tenPtr + offset, tenConfig.minSpeechDuration || 0.25, "float")
    offset += 4
    Module.setValue(tenPtr + offset, tenConfig.windowSize || 256, "i32")
    offset += 4
    Module.setValue(tenPtr + offset, tenConfig.maxSpeechDuration || 20, "float")

    // Provider string
    const providerLen = Module.lengthBytesUTF8(config.provider || "cpu") + 1
    const providerPtr = Module._malloc(providerLen)
    Module.stringToUTF8(config.provider || "cpu", providerPtr, providerLen)

    // Build main VAD config struct:
    //   silero(24) + sampleRate(4) + numThreads(4) + provider_ptr(4) + debug(4) + ten(24) = 64 bytes
    const mainLen = 24 + 4 * 4 + 24
    const mainPtr = Module._malloc(mainLen)

    offset = 0
    // Copy silero config block
    Module._CopyHeap(sileroPtr, 24, mainPtr + offset)
    offset += 24
    // Middle fields
    Module.setValue(mainPtr + offset, config.sampleRate || 16000, "i32")
    offset += 4
    Module.setValue(mainPtr + offset, config.numThreads || 1, "i32")
    offset += 4
    Module.setValue(mainPtr + offset, providerPtr, "i8*")
    offset += 4
    Module.setValue(mainPtr + offset, config.debug || 0, "i32")
    offset += 4
    // Copy ten config block
    Module._CopyHeap(tenPtr, 24, mainPtr + offset)

    // Free temporary structs (string pointers are still referenced by mainPtr)
    Module._free(sileroPtr)
    Module._free(tenPtr)

    return mainPtr
  }

  free(): void {
    if (this.handle) {
      this.Module._SherpaOnnxDestroyVoiceActivityDetector(this.handle)
      this.handle = 0
    }
  }

  acceptWaveform(samples: Float32Array): void {
    const pointer = this.Module._malloc(samples.length * samples.BYTES_PER_ELEMENT)
    this.Module.HEAPF32.set(samples, pointer / samples.BYTES_PER_ELEMENT)
    this.Module._SherpaOnnxVoiceActivityDetectorAcceptWaveform(this.handle, pointer, samples.length)
    this.Module._free(pointer)
  }

  isEmpty(): boolean {
    return this.Module._SherpaOnnxVoiceActivityDetectorEmpty(this.handle) === 1
  }

  isDetected(): boolean {
    return this.Module._SherpaOnnxVoiceActivityDetectorDetected(this.handle) === 1
  }

  pop(): void {
    this.Module._SherpaOnnxVoiceActivityDetectorPop(this.handle)
  }

  clear(): void {
    this.Module._SherpaOnnxVoiceActivityDetectorClear(this.handle)
  }

  front(): { samples: Float32Array; start: number } {
    const h = this.Module._SherpaOnnxVoiceActivityDetectorFront(this.handle)
    const start = this.Module.HEAP32[h / 4]
    const samplesPtr = this.Module.HEAP32[h / 4 + 1] / 4
    const numSamples = this.Module.HEAP32[h / 4 + 2]

    const samples = new Float32Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      samples[i] = this.Module.HEAPF32[samplesPtr + i]
    }

    this.Module._SherpaOnnxDestroySpeechSegment(h)
    return { samples, start }
  }

  reset(): void {
    this.Module._SherpaOnnxVoiceActivityDetectorReset(this.handle)
  }

  flush(): void {
    this.Module._SherpaOnnxVoiceActivityDetectorFlush(this.handle)
  }
}

// ============================================================================
// Module loader
// ============================================================================

/**
 * Load the sherpa-onnx WASM module.
 *
 * Returns a promise that resolves with the Emscripten Module.
 * The CircularBuffer and Vad classes are exported directly from this module
 * (no dependency on global scope).
 *
 * On subsequent calls, returns the cached module immediately.
 */
export function loadSherpaOnnxModule(): Promise<{ module: SherpaOnnxModule }> {
  if (modulePromise) return modulePromise

  preloadStarted = true
  const promise = new Promise<{ module: SherpaOnnxModule }>((resolve, reject) => {
    const win = globalThis as unknown as Record<string, unknown>
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback()
    }

    const timeoutId = globalThis.setTimeout(() => {
      finish(() => {
        reject(new Error("Timed out loading voice recognition model"))
      })
    }, LOAD_TIMEOUT_MS)

    // Configure Emscripten Module before the glue script loads
    win.Module = {
      locateFile: (path: string) => `${SHERPA_ONNX_BASE_PATH}/${path}`,
      onRuntimeInitialized: () => {
        const mod = win.Module as SherpaOnnxModule
        finish(() => resolve({ module: mod }))
      },
      onAbort: (reason: unknown) => {
        const detail = typeof reason === "string" ? reason : "unknown error"
        finish(() => reject(new Error(`Voice recognition model aborted: ${detail}`)))
      },
      setStatus: (status: string) => {
        if (status) {
          console.debug("[sherpa-onnx]", status)
        }
      },
    }

    // Load the Emscripten glue code (triggers WASM + .data download)
    const glueScript = document.createElement("script")
    glueScript.src = `${SHERPA_ONNX_BASE_PATH}/sherpa-onnx-wasm-main-vad.js`
    glueScript.onerror = () => {
      finish(() => reject(new Error("Failed to load sherpa-onnx WASM glue code")))
    }
    document.head.appendChild(glueScript)
  })

  modulePromise = promise.catch((err) => {
    modulePromise = null
    preloadStarted = false
    throw err
  })

  return modulePromise
}

/**
 * Warm the VAD runtime during browser idle time.
 *
 * This keeps the first explicit voice-mode entry from paying the full WASM
 * download + runtime initialization cost while avoiding a hard dependency on
 * the preload completing successfully.
 */
export function preloadSherpaOnnxModule(): void {
  if (preloadStarted || typeof window === "undefined") return

  const start = () => {
    loadSherpaOnnxModule().catch((err) => {
      preloadStarted = false
      console.warn("[sherpa-onnx] VAD preload failed:", err)
    })
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 4000 })
  } else {
    globalThis.setTimeout(start, 1500)
  }
}
