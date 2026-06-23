"use client"

import { LoaderCircle, Plus, Settings, Sparkles } from "lucide-react"
import { type AgentConfig } from "./agent-settings"
import { useT, useI18n } from "@/lib/i18n"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AppHeader } from "@/components/ui/app-shell"
import { IconAction } from "@/components/ui/icon-action"

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
    <AppHeader>
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
            <IconAction
              type="button"
              onClick={onCreateAgent}
              icon={Plus}
              className="shrink-0 border border-border/70 bg-background hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
              title={t.addAgent}
              aria-label={t.addAgent}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* Agent configuration button */}
          {onOpenAgentSettings && (
            <Button
              onClick={onOpenAgentSettings}
              variant="secondary"
              size="sm"
              className="group rounded-lg border border-border/60 px-3 sm:px-4"
              title={locale === "zh" ? "角色设置" : "Agent Settings"}
            >
              <Settings className="w-4 h-4 text-muted-foreground group-hover:rotate-45 group-hover:text-foreground transition-all duration-300" />
              <span className="hidden sm:inline">{locale === "zh" ? "角色设置" : "Agent Settings"}</span>
            </Button>
          )}

          {/* New Chat button */}
          <Button
            onClick={onNewChat}
            variant="outline"
            size="sm"
            className="group rounded-lg border-primary/20 bg-primary/10 px-3 text-foreground/80 hover:border-primary/40 hover:bg-primary/20 hover:text-foreground sm:px-4"
          >
            <Sparkles className="text-primary transition-transform duration-200 group-hover:rotate-12" />
            <span className="hidden sm:inline">{t.newChat}</span>
          </Button>
        </div>
      </div>
    </AppHeader>
  )
}
