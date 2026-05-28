/**
 * Voice Mode Overlay Component
 *
 * Semi-transparent overlay displayed during active voice mode.
 * Shows current state, real-time transcript, and exit button.
 */

import { Button } from "@/components/ui/button"
import { WaveformVisualizer } from "./waveform-visualizer"
import type { VoiceState } from "@/lib/voice/types"

interface VoiceModeOverlayProps {
  voiceState: VoiceState
  currentTranscript: string
  isSpeaking: boolean
  onExit: () => void
}

const stateLabels: Record<VoiceState, string> = {
  idle: "",
  loading: "Loading voice model...",
  listening: "Listening...",
  processing: "Thinking...",
  speaking: "Speaking...",
}

export function VoiceModeOverlay({
  voiceState,
  currentTranscript,
  isSpeaking,
  onExit,
}: VoiceModeOverlayProps) {
  if (voiceState === "idle") return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
      {/* Close button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onExit}
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Button>

      {/* Microphone icon with animation */}
      <div className="relative mb-8">
        <div
          className={`
            w-24 h-24 rounded-full flex items-center justify-center
            transition-all duration-500
            ${
              voiceState === "listening"
                ? "bg-primary/10 ring-4 ring-primary/20 animate-pulse"
                : voiceState === "speaking"
                  ? "bg-primary/15 ring-4 ring-primary/30"
                  : voiceState === "processing" || voiceState === "loading"
                    ? "bg-muted/50 ring-4 ring-muted"
                    : "bg-muted/30"
            }
          `}
        >
          {isSpeaking ? (
            <SpeakerIcon className="w-10 h-10 text-primary" />
          ) : voiceState === "loading" || voiceState === "processing" ? (
            <LoadingIcon className="w-10 h-10 text-muted-foreground" />
          ) : (
            <MicrophoneIcon
              className={`w-10 h-10 ${
                voiceState === "listening"
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            />
          )}
        </div>

        {/* Pulsing ring animation when listening */}
        {voiceState === "listening" && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
            <div
              className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping"
              style={{ animationDelay: "0.5s" }}
            />
          </>
        )}
      </div>

      {/* State label */}
      <div className="text-lg font-medium text-foreground mb-4">
        {stateLabels[voiceState]}
      </div>

      {/* Waveform */}
      <WaveformVisualizer voiceState={voiceState} className="mb-6" />

      {/* Real-time transcript */}
      {currentTranscript && (
        <div className="max-w-md px-6 text-center">
          <p className="text-lg text-foreground/80 italic">
            &ldquo;{currentTranscript}&rdquo;
          </p>
        </div>
      )}

      {/* Hint text */}
      <div className="absolute bottom-8 text-sm text-muted-foreground">
        {voiceState === "loading" && "Initializing voice recognition model..."}
        {voiceState === "listening" && "Speak naturally... say something or click to exit"}
        {voiceState === "processing" && "Processing your request..."}
        {voiceState === "speaking" && "Speak to interrupt, or click to exit"}
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
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
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
