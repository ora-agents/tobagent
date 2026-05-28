/**
 * Waveform Visualizer Component
 *
 * Animated waveform that responds to voice state.
 * Shows pulsing circles when listening, waves when speaking.
 */

import type { VoiceState } from "@/lib/voice/types"

interface WaveformVisualizerProps {
  voiceState: VoiceState
  className?: string
}

export function WaveformVisualizer({
  voiceState,
  className = "",
}: WaveformVisualizerProps) {
  const isActive =
    voiceState === "listening" ||
    voiceState === "speaking" ||
    voiceState === "transcribing"

  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`
            w-1 rounded-full transition-all duration-300
            ${
              voiceState === "speaking"
                ? "bg-primary animate-pulse"
                : voiceState === "listening" || voiceState === "transcribing"
                  ? "bg-primary/70"
                  : "bg-muted-foreground/30"
            }
          `}
          style={{
            height: isActive ? `${12 + Math.sin(i * 1.2) * 8 + 8}px` : "4px",
            animationDelay: `${i * 0.1}s`,
            animationDuration: voiceState === "speaking" ? "0.6s" : "1.2s",
          }}
        />
      ))}
    </div>
  )
}
