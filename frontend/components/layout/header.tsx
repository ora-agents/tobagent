"use client"

import { ChevronDown } from "lucide-react"
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
  showSettingsDialog?: boolean
  onSettingsDialogChange?: (open: boolean) => void
  /** Currently selected custom agent profile (null = default docs agent). */
  selectedAgentProfile?: AgentProfile | null
  /** Called when user clicks the agent name to open the profiles dialog. */
  onOpenAgentProfiles?: () => void
}

export function Header({
  showToolCalls = false,
  onToggleToolCalls,
  onNewChat,
  agentConfig,
  onAgentConfigChange,
  onShowShortcuts,
  forceShowTooltip,
  showSettingsDialog,
  onSettingsDialogChange,
  selectedAgentProfile,
  onOpenAgentProfiles,
}: HeaderProps) {
  const t = useT()
  const { locale } = useI18n()

  const agentPrefix = locale === "zh" ? "智能体：" : "Agent: "
  const agentLabel = `${agentPrefix}${selectedAgentProfile?.name ?? (locale === "zh" ? "默认系统智能体" : "Default")}`

  return (
    <header className="border-b border-border bg-background h-16 flex items-center">
      <div className="flex items-center justify-between w-full px-4 sm:px-6">
        {/* Agent name / wordmark — click to open agent selector */}
        <button
          onClick={onOpenAgentProfiles}
          className="flex items-center gap-1.5 group hover:opacity-80 transition-opacity"
          title="Switch or manage agents"
        >
          <span
            className="text-base font-sans font-semibold tracking-tight text-foreground"
            style={{ letterSpacing: "-0.01em" }}
          >
            {agentLabel}
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground/80 group-hover:text-foreground transition-colors mt-0.5" />
        </button>

        <div className="flex items-center gap-3">
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
