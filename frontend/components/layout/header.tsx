"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Copy, GripVertical, LoaderCircle, Menu, Plus, Settings, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { NavActionButton } from "@/components/ui/nav-action-button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type AgentConfig } from "./agent-settings"
import { useT, useI18n } from "@/lib/i18n"
import { isSystemAgentProfile, type AgentProfile } from "@/lib/types/agent-profiles"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/components/providers/auth-provider"
import { WorkspaceNotifications } from "@/components/layout/workspace-notifications"

const AGENT_SWITCHER_ORDER_KEY = "agent-switcher-order"
const COLLAPSED_AGENT_LIMIT = 3

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
  onCopySharedAgent?: () => void
  copySharedAgentStatus?: "idle" | "copying" | "copied" | "error"
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
  onCopySharedAgent,
  copySharedAgentStatus = "idle",
  onOpenSidebar,
}: HeaderProps) {
  const t = useT()
  const { locale } = useI18n()
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, canManageWorkspace } = useAuth()

  const agentLabel = selectedAgentProfile?.name ?? (locale === "zh" ? "未选择角色" : "No active role")
  const visibleAgentProfiles = agentProfiles.filter((profile) => !profile.isHidden)
  const canSwitchAgents = !!onAgentProfileChange && visibleAgentProfiles.length > 0
  const canOpenAgentSettings = !!onOpenAgentSettings && !!selectedAgentProfile && !isSystemAgentProfile(selectedAgentProfile)
  const [isAgentListExpanded, setIsAgentListExpanded] = useState(false)
  const [orderedAgentIds, setOrderedAgentIds] = useState<string[]>([])
  const [draggedAgentId, setDraggedAgentId] = useState<string | null>(null)
  const [dragOverAgentId, setDragOverAgentId] = useState<string | null>(null)
  const suppressNextClickRef = useRef(false)

  useEffect(() => {
    try {
      const savedOrder = localStorage.getItem(AGENT_SWITCHER_ORDER_KEY)
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder)
        if (Array.isArray(parsed)) {
          setOrderedAgentIds(parsed.filter((id): id is string => typeof id === "string"))
        }
      }
    } catch {
      setOrderedAgentIds([])
    }
  }, [])

  const orderedAgentProfiles = useMemo(() => {
    const profileById = new Map(visibleAgentProfiles.map((profile) => [profile.id, profile]))
    const orderedProfiles = orderedAgentIds
      .map((id) => profileById.get(id))
      .filter((profile): profile is AgentProfile => Boolean(profile))
    const orderedIds = new Set(orderedProfiles.map((profile) => profile.id))
    const newProfiles = visibleAgentProfiles.filter((profile) => !orderedIds.has(profile.id))

    return [...orderedProfiles, ...newProfiles]
  }, [orderedAgentIds, visibleAgentProfiles])

  const collapsedAgentProfiles = useMemo(() => {
    const platformProfiles = orderedAgentProfiles.filter((profile) => profile.graphId === "agent_builder")
    const regularProfiles = orderedAgentProfiles.filter((profile) => profile.graphId !== "agent_builder")
    const visibleRegularProfiles = regularProfiles.slice(0, COLLAPSED_AGENT_LIMIT)
    const selectedRegularProfile = regularProfiles.find((profile) => profile.id === selectedAgentProfileId)

    if (
      selectedRegularProfile
      && !visibleRegularProfiles.some((profile) => profile.id === selectedRegularProfile.id)
    ) {
      visibleRegularProfiles[visibleRegularProfiles.length - 1] = selectedRegularProfile
    }

    return [...visibleRegularProfiles, ...platformProfiles]
  }, [orderedAgentProfiles, selectedAgentProfileId])

  const hasMoreAgents = orderedAgentProfiles.length > collapsedAgentProfiles.length
  const displayedAgentProfiles = isAgentListExpanded
    ? orderedAgentProfiles
    : collapsedAgentProfiles

  const persistAgentOrder = (nextIds: string[]) => {
    setOrderedAgentIds(nextIds)
    try {
      localStorage.setItem(AGENT_SWITCHER_ORDER_KEY, JSON.stringify(nextIds))
    } catch {
      // Ignore storage failures; sorting still works for the current session.
    }
  }

  const handleAgentDrop = (targetId: string) => {
    if (!draggedAgentId || draggedAgentId === targetId) return

    const currentIds = orderedAgentProfiles.map((profile) => profile.id)
    const fromIndex = currentIds.indexOf(draggedAgentId)
    const toIndex = currentIds.indexOf(targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const nextIds = [...currentIds]
    const [movedId] = nextIds.splice(fromIndex, 1)
    nextIds.splice(toIndex, 0, movedId)
    suppressNextClickRef.current = true
    persistAgentOrder(nextIds)
  }

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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary md:hidden"
              title={locale === "zh" ? "打开菜单" : "Open menu"}
              aria-label={locale === "zh" ? "打开菜单" : "Open menu"}
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}
          {agentProfilesLoaded ? (
            canSwitchAgents ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <ScrollArea
                  className="h-11 w-fit min-w-0 max-w-full"
                  viewportClassName="px-1"
                  scrollbars="horizontal"
                  aria-label={locale === "zh" ? "切换角色" : "Switch agent"}
                >
                  <div className="flex h-11 items-center gap-1.5">
                    {displayedAgentProfiles.map((profile) => {
                      const isActive = selectedAgentProfileId === profile.id
                      const isDragging = draggedAgentId === profile.id
                      const isDragTarget = dragOverAgentId === profile.id && draggedAgentId !== profile.id

                      return (
                        <Button
                          key={profile.id}
                          type="button"
                          variant="ghost"
                          draggable
                          onDragStart={(event) => {
                            setDraggedAgentId(profile.id)
                            event.dataTransfer.effectAllowed = "move"
                            event.dataTransfer.setData("text/plain", profile.id)
                          }}
                          onDragOver={(event) => {
                            event.preventDefault()
                            event.dataTransfer.dropEffect = "move"
                            setDragOverAgentId(profile.id)
                          }}
                          onDragLeave={() => setDragOverAgentId(null)}
                          onDrop={(event) => {
                            event.preventDefault()
                            handleAgentDrop(profile.id)
                            setDraggedAgentId(null)
                            setDragOverAgentId(null)
                          }}
                          onDragEnd={() => {
                            setDraggedAgentId(null)
                            setDragOverAgentId(null)
                            window.setTimeout(() => {
                              suppressNextClickRef.current = false
                            }, 0)
                          }}
                          onClick={() => {
                            if (suppressNextClickRef.current) return
                            onAgentProfileChange(profile.id)
                          }}
                          aria-pressed={isActive}
                          title={profile.name}
                          className={cn(
                            "h-9 max-w-28 cursor-grab shrink-0 rounded-lg px-2 text-sm font-medium transition-colors active:cursor-grabbing sm:max-w-36 sm:px-2.5",
                            "truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
                            isActive
                              ? "bg-primary text-primary-foreground shadow-depth-xs"
                              : "bg-muted text-foreground hover:bg-primary-soft hover:text-primary",
                            isDragging && "opacity-50",
                            isDragTarget && "ring-2 ring-primary/30"
                          )}
                        >
                          <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-45" />
                          <span className="truncate">{profile.name}</span>
                        </Button>
                      )
                    })}
                  </div>
                </ScrollArea>
                {hasMoreAgents && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsAgentListExpanded((current) => !current)}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
                    title={
                      isAgentListExpanded
                        ? locale === "zh" ? "收起角色" : "Collapse agents"
                        : locale === "zh" ? "展开角色" : "Expand agents"
                    }
                    aria-label={
                      isAgentListExpanded
                        ? locale === "zh" ? "收起角色" : "Collapse agents"
                        : locale === "zh" ? "展开角色" : "Expand agents"
                    }
                    aria-expanded={isAgentListExpanded}
                  >
                    {isAgentListExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                )}
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

          {canManageWorkspace && onCreateAgent && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onCreateAgent}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
              title={t.addAgent}
              aria-label={t.addAgent}
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <WorkspaceNotifications />

          {workspaces.length > 1 && (
            <Select
              value={activeWorkspaceId ?? ""}
              onValueChange={(value) => setActiveWorkspaceId(value || null)}
            >
              <SelectTrigger
                className="h-9 max-w-36 border border-border bg-background px-2 text-foreground focus-visible:ring-primary/30 sm:max-w-44"
                aria-label={locale === "zh" ? "选择工作间" : "Select workspace"}
                title={locale === "zh" ? "选择工作间" : "Select workspace"}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}

          {/* Shared agent copy button */}
          {onCopySharedAgent && (
            <NavActionButton
              type="button"
              variant="ghost"
              onClick={onCopySharedAgent}
              disabled={copySharedAgentStatus === "copying"}
              className="group bg-primary-soft text-primary hover:bg-primary hover:text-primary-foreground"
              title={locale === "zh" ? "复制 Agent 到我的账号" : "Copy agent to my account"}
              aria-label={locale === "zh" ? "复制 Agent 到我的账号" : "Copy agent to my account"}
            >
              {copySharedAgentStatus === "copying" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : copySharedAgentStatus === "copied" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {copySharedAgentStatus === "copying"
                  ? (locale === "zh" ? "复制中" : "Copying")
                  : copySharedAgentStatus === "copied"
                    ? (locale === "zh" ? "已复制" : "Copied")
                    : copySharedAgentStatus === "error"
                      ? (locale === "zh" ? "重试复制" : "Retry copy")
                      : (locale === "zh" ? "复制 Agent" : "Copy Agent")}
              </span>
            </NavActionButton>
          )}

          {/* Agent configuration button */}
          {canOpenAgentSettings && (
            <NavActionButton
              type="button"
              variant="ghost"
              onClick={onOpenAgentSettings}
              className="group bg-muted text-foreground hover:bg-sidebar-accent hover:text-foreground"
              title={locale === "zh" ? "角色设置" : "Agent Settings"}
              aria-label={locale === "zh" ? "角色设置" : "Agent Settings"}
            >
              <Settings className="w-4 h-4 text-muted-foreground group-hover:rotate-45 group-hover:text-foreground transition-all duration-300" />
              <span className="hidden sm:inline">{locale === "zh" ? "角色设置" : "Agent Settings"}</span>
            </NavActionButton>
          )}

          {/* New Chat button */}
          <NavActionButton
            type="button"
            variant="ghost"
            onClick={onNewChat}
            className="group bg-primary-soft text-primary hover:bg-primary hover:text-primary-foreground"
            aria-label={t.newChat}
          >
            <Sparkles className="h-4 w-4 text-primary transition-transform duration-200 group-hover:rotate-12 group-hover:text-primary-foreground" />
            <span className="hidden sm:inline">{t.newChat}</span>
          </NavActionButton>
        </div>
      </div>
    </header>
  )
}
