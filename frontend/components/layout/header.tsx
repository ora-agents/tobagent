"use client"

import { LoaderCircle, Menu, Plus, Settings, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  onOpenSidebar?: () => void
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
  onOpenSidebar,
}: HeaderProps) {
  const t = useT()
  const { locale } = useI18n()

  const agentLabel = selectedAgentProfile?.name ?? (locale === "zh" ? "未选择角色" : "No active role")
  const visibleAgentProfiles = agentProfiles.filter((profile) => !profile.isHidden)
  const canSwitchAgents = !!onAgentProfileChange && visibleAgentProfiles.length > 0

  return (
    <header className="flex h-14 shrink-0 items-center bg-background sm:h-16">
      <div className="flex w-full items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onOpenSidebar && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenSidebar}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary md:hidden"
              title={locale === "zh" ? "打开菜单" : "Open menu"}
              aria-label={locale === "zh" ? "打开菜单" : "Open menu"}
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}
          {agentProfilesLoaded ? (
            canSwitchAgents ? (
              <div
                className="flex min-w-0 max-w-[calc(100vw-12rem)] items-center gap-1.5 overflow-x-auto pr-1 md:max-w-[48rem] md:pr-2"
                aria-label={locale === "zh" ? "切换角色" : "Switch agent"}
              >
                {visibleAgentProfiles.map((profile) => {
                  const isActive = selectedAgentProfileId === profile.id

                  return (
                    <Button
                      key={profile.id}
                      type="button"
                      variant="ghost"
                      onClick={() => onAgentProfileChange(profile.id)}
                      aria-pressed={isActive}
                      title={profile.name}
                      className={cn(
                        "h-9 max-w-28 shrink-0 rounded-lg px-2.5 text-sm font-medium transition-colors sm:max-w-36 sm:px-3",
                        "truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-depth-xs"
                          : "bg-muted/70 text-foreground/80 hover:bg-primary/10 hover:text-foreground"
                      )}
                    >
                      {profile.name}
                    </Button>
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCreateAgent}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              title={t.addAgent}
              aria-label={t.addAgent}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Agent configuration button */}
          {onOpenAgentSettings && (
            <Button
              type="button"
              variant="ghost"
              onClick={onOpenAgentSettings}
              className="group inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-sm font-medium text-foreground/80 transition-all duration-200 hover:bg-muted/80 hover:text-foreground sm:w-auto sm:gap-2 sm:px-4"
              title={locale === "zh" ? "角色设置" : "Agent Settings"}
              aria-label={locale === "zh" ? "角色设置" : "Agent Settings"}
            >
              <Settings className="w-4 h-4 text-muted-foreground group-hover:rotate-45 group-hover:text-foreground transition-all duration-300" />
              <span className="hidden sm:inline">{locale === "zh" ? "角色设置" : "Agent Settings"}</span>
            </Button>
          )}

          {/* New Chat button */}
          <Button
            type="button"
            variant="ghost"
            onClick={onNewChat}
            className="group inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-foreground/80 transition-all duration-200 hover:bg-primary/20 hover:text-foreground sm:w-auto sm:gap-2 sm:px-4"
            aria-label={t.newChat}
          >
            <Sparkles className="h-4 w-4 text-primary transition-transform duration-200 group-hover:rotate-12" />
            <span className="hidden sm:inline">{t.newChat}</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
