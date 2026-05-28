"use client"

import { useT } from "@/lib/i18n"

export function AnimatedThinking() {
  const t = useT()
  const label = t.thinking.replace("...", "").replace("...", "")

  return (
    <span className="font-medium inline-flex min-w-[4.5rem] items-center gap-0 relative">
      <span className="thinking-text-base">{label}</span>
      <span className="inline-flex thinking-text-base">
        <span className="animate-bounce-dot" style={{ animationDelay: '0ms' }}>.</span>
        <span className="animate-bounce-dot" style={{ animationDelay: '150ms' }}>.</span>
        <span className="animate-bounce-dot" style={{ animationDelay: '300ms' }}>.</span>
      </span>
      <span className="thinking-gradient-overlay" aria-hidden="true">
        <span>{label}</span>
        <span className="inline-flex">
          <span className="animate-bounce-dot" style={{ animationDelay: '0ms' }}>.</span>
          <span className="animate-bounce-dot" style={{ animationDelay: '150ms' }}>.</span>
          <span className="animate-bounce-dot" style={{ animationDelay: '300ms' }}>.</span>
        </span>
      </span>
    </span>
  )
}
