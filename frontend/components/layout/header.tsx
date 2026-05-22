"use client"

import { useState, useEffect } from "react"
import { Settings, Sun, Moon } from "lucide-react"
import { useTheme } from "next-themes"
import { AgentSettings, type AgentConfig } from "./agent-settings"
import { useT } from "@/lib/i18n"

interface HeaderProps {
  showToolCalls?: boolean
  onToggleToolCalls?: () => void
  onNewChat?: () => void
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  onShowShortcuts?: () => void
  forceShowTooltip?: number
  showSettingsDialog?: boolean
  onSettingsDialogChange?: (open: boolean) => void
}

export function Header({ showToolCalls = false, onToggleToolCalls, onNewChat, agentConfig, onAgentConfigChange, onShowShortcuts, forceShowTooltip, showSettingsDialog, onSettingsDialogChange }: HeaderProps) {
  const t = useT()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <header className="border-b border-border bg-background h-16 flex items-center">
      <div className="flex items-center justify-between w-full px-4 sm:px-6">
        {/* Wordmark */}
        <div className="flex items-center gap-2">
          <span
            className="text-xl font-medium tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-cormorant, Georgia, serif)", letterSpacing: "-0.3px" }}
          >
            Chat
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {mounted && resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {agentConfig && onAgentConfigChange && (
            <AgentSettings
              config={agentConfig}
              onConfigChange={onAgentConfigChange}
              onShowShortcuts={onShowShortcuts}
              forceShowTooltip={forceShowTooltip}
              open={showSettingsDialog}
              onOpenChange={onSettingsDialogChange}
            />
          )}
          <button
            onClick={onNewChat}
            className="group inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/40 rounded-full text-sm font-medium text-foreground/80 hover:text-foreground transition-all duration-200"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary group-hover:rotate-12 transition-transform duration-200"
            >
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
            </svg>
            <span className="hidden sm:inline">{t.newChat}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
