/**
 * Voice Mini Panel Component
 *
 * Compact floating panel displayed during active voice mode.
 * Shows current state, waveform, and close button.
 * Positioned bottom-right above the chat input area.
 */

import { Button } from "@/components/ui/button"
import { WaveformVisualizer } from "./waveform-visualizer"
import type { VoiceState } from "@/lib/voice/types"

interface VoiceMiniPanelProps {
  voiceState: VoiceState
  isSpeaking: boolean
  onExit: () => void
}

const stateLabels: Record<VoiceState, string> = {
  idle: "",
  kws: "Say wake word...",
  loading: "Loading...",
  listening: "Listening...",
  processing: "Thinking...",
  speaking: "Speaking...",
}

const stateHints: Record<VoiceState, string> = {
  idle: "",
  kws: "Listening for wake word...",
  loading: "Initializing voice model...",
  listening: "Speak naturally...",
  processing: "Processing...",
  speaking: "Speak to interrupt",
}

export function VoiceMiniPanel({
  voiceState,
  isSpeaking,
  onExit,
}: VoiceMiniPanelProps) {
  // Don't show the panel when idle or during passive KWS listening
  if (voiceState === "idle" || voiceState === "kws") return null

  return (
    <div className="fixed bottom-28 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="w-60 rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden">
        {/* Header row: icon + state label + close button */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
          {/* State icon */}
          <div
            className={`
              w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
              transition-all duration-300
              ${
                voiceState === "listening"
                  ? "bg-primary/10 ring-2 ring-primary/20"
                  : voiceState === "speaking"
                    ? "bg-primary/15 ring-2 ring-primary/30"
                    : "bg-muted/50 ring-2 ring-muted"
              }
            `}
          >
            {voiceState === "processing" || voiceState === "loading" ? (
              <LoadingIcon className="w-3.5 h-3.5 text-muted-foreground" />
            ) : isSpeaking ? (
              <SpeakerIcon className="w-3.5 h-3.5 text-primary" />
            ) : (
              <MicrophoneIcon
                className={`w-3.5 h-3.5 ${
                  voiceState === "listening"
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
              />
            )}

            {/* Pulse ring when listening */}
            {voiceState === "listening" && (
              <span className="absolute w-7 h-7 rounded-full border border-primary/30 animate-ping" />
            )}
          </div>

          {/* State label */}
          <span className="text-sm font-medium text-foreground flex-1">
            {stateLabels[voiceState]}
          </span>

          {/* Close button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onExit}
            className="h-6 w-6 p-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3.5 h-3.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>

        {/* Waveform */}
        <div className="px-3 py-1.5">
          <WaveformVisualizer voiceState={voiceState} className="justify-start" />
        </div>

        {/* Hint text */}
        <div className="px-3 pb-2">
          <p className="text-[11px] text-muted-foreground">
            {stateHints[voiceState]}
          </p>
        </div>
      </div>
    </div>
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
