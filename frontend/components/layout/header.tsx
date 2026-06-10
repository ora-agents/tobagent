"use client"

import { LoaderCircle, Plus, Settings } from "lucide-react"
import { type AgentConfig } from "./agent-settings"
import { useT, useI18n } from "@/lib/i18n"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { cn } from "@/lib/utils"

interface HeaderProps {
  onNewChat?: () => void
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  onShowShortcuts?: () => void
  forceShowTooltip?: number
  /** Currently selected custom agent profile (null = default docs agent). */
  selectedAgentProfile?: AgentProfile | null
  agentProfiles?: AgentProfile[]
  agentProfilesLoaded?: boolean
  selectedAgentProfileId?: string | null
  onAgentProfileChange?: (id: string | null) => void
  onCreateAgent?: () => void
  /** Callback to open agent profiles configuration dialog. */
  onOpenAgentSettings?: () => void
}

export function Header({
  onNewChat,
  agentConfig,
  onAgentConfigChange,
  onShowShortcuts,
  forceShowTooltip,
  selectedAgentProfile,
  agentProfiles = [],
  agentProfilesLoaded = true,
  selectedAgentProfileId,
  onAgentProfileChange,
  onCreateAgent,
  onOpenAgentSettings,
}: HeaderProps) {
  const t = useT()
  const { locale } = useI18n()

  const agentLabel = selectedAgentProfile?.name ?? (locale === "zh" ? "未选择角色" : "No active role")
  const canSwitchAgents = !!onAgentProfileChange && agentProfiles.length > 0

  return (
    <header className="bg-background h-16 flex items-center">
      <div className="flex items-center justify-between w-full px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {agentProfilesLoaded ? (
            canSwitchAgents ? (
              <div
                className="flex min-w-0 max-w-[calc(100vw-11rem)] items-center gap-1.5 overflow-x-auto pr-2 md:max-w-[48rem]"
                aria-label={locale === "zh" ? "切换角色" : "Switch agent"}
              >
                {agentProfiles.map((profile) => {
                  const isActive = selectedAgentProfileId === profile.id

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => onAgentProfileChange(profile.id)}
                      aria-pressed={isActive}
                      title={profile.name}
                      className={cn(
                        "h-9 max-w-36 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors",
                        "truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                        isActive
                          ? "border-primary bg-primary text-primary-foreground shadow-depth-xs"
                          : "border-border/70 bg-card/70 text-foreground/80 hover:border-primary/45 hover:bg-primary/10 hover:text-foreground"
                      )}
                    >
                      {profile.name}
                    </button>
                  )
                })}
              </div>
            ) : (
              <span
                className="truncate text-base font-sans font-semibold text-foreground select-none"
                style={{ letterSpacing: "-0.01em" }}
              >
                {agentLabel}
              </span>
            )
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{t.loadingAgents}</span>
            </div>
          )}

          {onCreateAgent && (
            <button
              type="button"
              onClick={onCreateAgent}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
              title={t.addAgent}
              aria-label={t.addAgent}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
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
