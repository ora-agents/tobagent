type AudioContextConstructor = typeof AudioContext

interface AudioWindow extends Window {
  AudioContext?: AudioContextConstructor
  webkitAudioContext?: AudioContextConstructor
}

export function getAudioContextConstructor(): AudioContextConstructor | null {
  const audioWindow = window as AudioWindow
  return audioWindow.AudioContext || audioWindow.webkitAudioContext || null
}

export function getVoiceSupportError(): string | null {
  if (typeof window === "undefined") {
    return "Voice input is not supported in this browser"
  }

  const AudioContextCtor = getAudioContextConstructor()
  if (!AudioContextCtor) {
    return "Voice input is not supported in this browser"
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return "Microphone access requires HTTPS or localhost on mobile browsers"
  }

  if (!window.WebAssembly) {
    return "Voice recognition is not supported in this browser"
  }

  if (!("audioWorklet" in AudioContextCtor.prototype)) {
    return "Voice input requires AudioWorklet support"
  }

  return null
}

export function isVoiceSupported(): boolean {
  return getVoiceSupportError() === null
}

export function isAndroidWebView(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const userAgent = window.navigator.userAgent
  const android = /Android/i.test(userAgent)
  if (!android) {
    return false
  }

  const webViewUserAgent = /\bwv\b/i.test(userAgent) || /Version\/[\d.]+.*Chrome/i.test(userAgent)
  const nativeBridge = Boolean(
    (window as any).__TOB_NATIVE_VOICE__ ||
      (window as any).TobNativeVoice ||
      (window as any).__TOB_ROBOT_ENV__
  )

  return webViewUserAgent || nativeBridge
}

export function isRobotEnvironment(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return Boolean((window as any).__TOB_ROBOT_ENV__?.enabled)
}
