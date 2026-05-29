"use client"

import { Settings } from "lucide-react"
import { type AgentConfig } from "./agent-settings"
import { useT, useI18n } from "@/lib/i18n"
import type { AgentProfile } from "@/lib/types/agent-profiles"

interface HeaderProps {
  showToolCalls?: boolean
  onToggleToolCalls?: () => void
  onNewChat?: () => void
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  onShowShortcuts?: () => void
  forceShowTooltip?: number
  /** Currently selected custom agent profile (null = default docs agent). */
  selectedAgentProfile?: AgentProfile | null
  /** Callback to open agent profiles configuration dialog. */
  onOpenAgentSettings?: () => void
}

export function Header({
  showToolCalls = false,
  onToggleToolCalls,
  onNewChat,
  agentConfig,
  onAgentConfigChange,
  onShowShortcuts,
  forceShowTooltip,
  selectedAgentProfile,
  onOpenAgentSettings,
}: HeaderProps) {
  const t = useT()
  const { locale } = useI18n()

  const agentLabel = selectedAgentProfile?.name ?? (locale === "zh" ? "默认系统角色" : "Default")

  return (
    <header className="bg-background h-16 flex items-center">
      <div className="flex items-center justify-between w-full px-4 sm:px-6">
        {/* Current agent name display — purely static, no prefix */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-base font-sans font-semibold tracking-tight text-foreground select-none"
            style={{ letterSpacing: "-0.01em" }}
          >
            {agentLabel}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Agent configuration button */}
          {onOpenAgentSettings && (
            <button
              onClick={onOpenAgentSettings}
              className="group inline-flex items-center gap-2 px-3 sm:px-4 py-2 bg-muted hover:bg-muted/80 border border-border/60 hover:border-border rounded-full text-sm font-medium text-foreground/80 hover:text-foreground transition-all duration-200"
              title={locale === "zh" ? "角色设置" : "Agent Settings"}
            >
              <Settings className="w-4 h-4 text-muted-foreground group-hover:rotate-45 group-hover:text-foreground transition-all duration-300" />
              <span className="hidden sm:inline">{locale === "zh" ? "角色设置" : "Agent Settings"}</span>
            </button>
          )}

          {/* New Chat button */}
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
