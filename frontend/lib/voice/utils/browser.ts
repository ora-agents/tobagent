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
