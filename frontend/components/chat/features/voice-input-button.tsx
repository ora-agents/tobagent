/**
 * Voice Input Button Component
 *
 * Multi-state microphone button for voice agent mode.
 * Shows different icons/colors based on voice state:
 * - idle: gray microphone
 * - listening: primary microphone with pulse animation
 * - processing: primary microphone with loading animation
 * - speaking: primary speaker icon
 */

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import type { VoiceState } from "@/lib/voice/types"

interface VoiceInputButtonProps {
  /** Current voice state */
  voiceState: VoiceState
  /** Whether voice features are supported */
  isSupported?: boolean
  disabled?: boolean
  onClick: () => void
  size?: "sm" | "md"
}

export function VoiceInputButton({
  voiceState,
  isSupported = true,
  disabled,
  onClick,
  size = "sm",
}: VoiceInputButtonProps) {
  const t = useT()
  const dimensions = size === "sm" ? "h-9 w-9" : "h-10 w-10"
  const iconSize = size === "sm" ? "w-4 h-4" : "w-4.5 h-4.5"

  const isActive = voiceState !== "idle"

  // Tooltip text based on state
  const title = (() => {
    switch (voiceState) {
      case "idle":
        return t.voiceInput || "Voice input"
      case "kws":
        return "Listening for wake word... click to start voice mode"
      case "loading":
        return "Loading voice model..."
      case "listening":
        return t.stopListening || "Listening... click to stop"
      case "transcribing":
        return "Transcribing... click to stop"
      case "processing":
        return "Processing... click to stop"
      case "speaking":
        return "Speaking... click to stop"
    }
  })()

  return (
    <Button
      onClick={onClick}
      variant="ghost"
      size="sm"
      disabled={disabled || !isSupported}
      className={`
        group ${dimensions} p-0 mb-0.5 rounded-lg flex-shrink-0
        transition-colors duration-200 border-0
        ${
          isActive
            ? "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary"
            : "bg-card text-muted-foreground hover:bg-primary-soft hover:text-primary"
        }
      `}
      type="button"
      title={title}
    >
      {/* Pulse animation ring when listening */}
      {voiceState === "listening" && (
        <span className="absolute inset-0 rounded-lg bg-primary/15 animate-ping" />
      )}

      {voiceState === "speaking" ? (
        <SpeakerIcon className={iconSize} />
      ) : voiceState === "processing" || voiceState === "loading" || voiceState === "transcribing" ? (
        <LoadingIcon className={iconSize} />
      ) : (
        <MicrophoneIcon className={iconSize} />
      )}
    </Button>
  )
}

function MicrophoneIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

function LoadingIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`animate-spin ${className}`}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
