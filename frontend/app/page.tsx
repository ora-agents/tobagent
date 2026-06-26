"use client"

import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Copy, History, LogOut, Moon, Sparkles, Sun, Trash2 } from "lucide-react"
import { useTheme } from "next-themes"
import { useQueryState } from "nuqs"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ChatInterface } from "@/components/chat/chat-interface"
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import { UserSettingsPage } from "@/components/layout/user-settings-page"
import { DeveloperManualPage } from "@/components/layout/developer-manual-page"
import { useAuth } from "@/components/providers/auth-provider"
import { useThreads, type ClientProfile } from "@/lib/hooks/threads"
import { useUserId, useClientProfile } from "@/lib/hooks/auth"
import { resolveClientProfile } from "@/lib/config/client-config"
import type { AgentConfig } from "@/components/layout/agent-settings"
import { generateQuickTitle, generateThreadTitle } from "@/lib/utils/string"
import { generateUUID } from "@/lib/utils"
import {
  fetchAvailableModels,
  getDefaultModel,
  getDefaultAgent,
  CONFIG_STORAGE,
  type ModelOption,
} from "@/lib/config/deployment-config"
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts"
import { useAgentProfiles } from "@/lib/hooks/agents/use-agent-profiles"
import { isSystemAgentProfile } from "@/lib/types/agent-profiles"
import { useI18n, useT } from "@/lib/i18n"
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { STORAGE_KEYS } from "@/lib/constants/features"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import type { User } from "@/components/providers/auth-provider"
import type { Thread } from "@/lib/hooks/threads"
import { getThreadSource } from "@/lib/utils/thread-source"

const DASHBOARD_VIEWS = ["chat", "skills", "agents", "knowledge", "forms", "mcp", "settings", "developer-manual"] as const
type DashboardView = (typeof DASHBOARD_VIEWS)[number]

function isDashboardView(value: string | null): value is DashboardView {
  return DASHBOARD_VIEWS.includes(value as DashboardView)
}

function DashboardFallback() {
  return (
    <div className="flex h-screen bg-background" aria-busy="true" aria-label="Loading dashboard" role="status">
      <aside className="hidden w-56 flex-col border-r border-border/60 bg-sidebar md:flex">
        <div className="flex h-16 items-center border-b border-border/60 px-3">
          <LoadingPlaceholder variant="button" className="h-9 w-9" />
        </div>
        <div className="space-y-3 px-3 py-4">
          <LoadingPlaceholder variant="input" className="h-10 w-full" />
          <div className="space-y-2 pt-2">
            <LoadingPlaceholder className="h-2.5 w-16" />
            <LoadingPlaceholder variant="thread" className="w-full" />
            <LoadingPlaceholder variant="thread" className="w-[92%]" />
            <LoadingPlaceholder variant="thread" className="w-[84%]" />
          </div>
        </div>
        <div className="mt-auto space-y-2 border-t border-border/40 px-3 py-3">
          <LoadingPlaceholder variant="button" className="h-9 w-full" />
          <LoadingPlaceholder variant="button" className="h-9 w-4/5" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border/60 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <LoadingPlaceholder variant="button" className="h-9 w-9 md:hidden" />
            <LoadingPlaceholder className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <LoadingPlaceholder variant="button" className="h-9 w-9" />
            <LoadingPlaceholder variant="button" className="h-9 w-24" />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-3xl -mt-20">
            <LoadingPlaceholder className="mx-auto mb-8 h-9 w-64 sm:h-12 sm:w-96" />
            <div className="rounded-xl border border-border/70 bg-background/95 p-3 shadow-depth-sm">
              <LoadingPlaceholder className="mb-3 h-4 w-3/4" />
              <div className="flex items-end gap-2">
                <LoadingPlaceholder variant="button" className="h-9 w-9 rounded-full" />
                <LoadingPlaceholder variant="input" className="h-11 flex-1 border-0" />
                <LoadingPlaceholder variant="button" className="h-9 w-20 rounded-full" />
              </div>
            </div>
            <div className="mt-3 flex gap-3 px-2">
              <LoadingPlaceholder variant="button" className="h-8 w-36" />
              <LoadingPlaceholder variant="button" className="h-8 w-32" />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function AuthRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/login")
  }, [router])

  return <DashboardFallback />
}

function DedicatedAgentHeader({
  agentName,
  user,
  onNewChat,
  threads,
  currentThreadId,
  onSelectThread,
  onDeleteThread,
  isLoadingThreads = false,
  onCopyAgent,
  copyAgentDisabled = false,
  onLogout,
}: {
  agentName: string
  user: User
  onNewChat: () => void
  threads: Thread[]
  currentThreadId: string | null
  onSelectThread: (threadId: string) => void
  onDeleteThread: (threadId: string) => void
  isLoadingThreads?: boolean
  onCopyAgent?: () => void
  copyAgentDisabled?: boolean
  onLogout: () => void
}) {
  const t = useT()
  const { locale } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === "dark"

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border/50 bg-background/95 sm:h-16">
      <div className="flex w-full items-center justify-between gap-3 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="flex h-10 shrink-0 items-center rounded-lg px-1.5 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
            title="返回主页"
            aria-label="返回主页"
          >
            <Image
              src="/logo.png"
              alt="WSIRI"
              width={957}
              height={613}
              className="h-8 w-auto max-w-[104px] object-contain sm:h-9 sm:max-w-[120px]"
              priority
              draggable={false}
            />
          </Link>
          <div className="h-6 w-px shrink-0 bg-border/70 dark:bg-white/20" aria-hidden="true" />
          <span className="block truncate text-base font-semibold text-foreground">
            {agentName}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onCopyAgent && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCopyAgent}
              disabled={copyAgentDisabled}
              className="h-9 gap-1.5 rounded-lg px-3 text-muted-foreground hover:bg-primary-soft hover:text-primary disabled:opacity-60 dark:hover:bg-white/10 dark:hover:text-foreground"
              title="复制到我的账号"
              aria-label="复制到我的账号"
            >
              <Copy className="h-4 w-4" />
              <span className="hidden sm:inline">复制</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-9 gap-1.5 rounded-lg px-3 text-muted-foreground hover:bg-primary-soft hover:text-primary dark:hover:bg-white/10 dark:hover:text-foreground"
                title={t.threads}
                aria-label={t.threads}
              >
                <History className="h-4 w-4" />
                <span className="hidden sm:inline">{t.threads}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))] p-2">
              <div className="px-2 pb-2 pt-1 text-xs font-semibold uppercase text-muted-foreground">
                {t.threads}
              </div>
              <div className="max-h-[min(26rem,70vh)] space-y-1 overflow-y-auto pr-1">
                {isLoadingThreads ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t.loadingConversations}</div>
                ) : threads.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t.noConversationsYet}</div>
                ) : (
                  threads.map((thread) => {
                    const source = getThreadSource(thread)
                    const sourceLabel = locale === "zh" ? source.labelZh : source.labelEn
                    const title = thread.metadata?.title || t.untitled
                    const isActive = thread.thread_id === currentThreadId
                    return (
                      <div
                        key={thread.thread_id}
                        className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                          isActive
                            ? "bg-primary-soft text-primary dark:bg-primary dark:text-primary-foreground"
                            : "text-foreground hover:bg-muted"
                        }`}
                        onClick={() => onSelectThread(thread.thread_id)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{title}</div>
                          {source.kind !== "main" && (
                            <div className="mt-1">
                              <span className="inline-flex max-w-full items-center rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary dark:bg-white/10 dark:text-foreground">
                                <span className="truncate">{sourceLabel}</span>
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onDeleteThread(thread.thread_id)
                          }}
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          aria-label="删除对话"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            onClick={onNewChat}
            className="h-9 gap-1.5 rounded-lg bg-primary-soft px-3 text-primary hover:bg-primary hover:text-primary-foreground dark:bg-white/10 dark:text-foreground dark:hover:bg-primary dark:hover:text-primary-foreground"
            title={t.newChat}
            aria-label={t.newChat}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">{t.newChat}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-primary-soft hover:text-primary dark:hover:bg-white/10 dark:hover:text-foreground"
            title={isDark ? t.lightMode : t.darkMode}
            aria-label={isDark ? t.lightMode : t.darkMode}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full p-0 text-white hover:opacity-90"
                style={{ backgroundColor: user.avatarColor || "#164199" }}
                title={user.username}
                aria-label={user.username}
              >
                <span className="text-sm font-semibold">
                  {user.username.charAt(0).toUpperCase()}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium">{user.username}</p>
                {user.email && (
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                )}
              </div>
              <DropdownMenuItem onClick={onLogout} className="gap-2 text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                <span>退出登录</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function DashboardContent() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: authLoading, logout } = useAuth()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [forceShowTooltip, setForceShowTooltip] = useState(0)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [chatSessionKey, setChatSessionKey] = useState(0)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [elderOptimized, setElderOptimized] = useState(false)
  const [userVoiceprints, setUserVoiceprints] = useState<import("@/components/layout/user-settings-page").UserVoiceprint[]>([])

  // Agent profiles (custom configurable agents)
  const {
    profiles: agentProfiles,
    profilesLoaded: agentProfilesLoaded,
    selectedId: selectedAgentProfileId,
    selectedProfile: selectedAgentProfile,
    setSelectedId: setSelectedAgentProfileId,
    createProfile: createAgentProfile,
    updateProfile: updateAgentProfile,
    deleteProfile: deleteAgentProfile,
    fetchProfileVersions: fetchAgentProfileVersions,
    restoreProfileVersion: restoreAgentProfileVersion,
    createShareLink: createAgentShareLink,
    fetchSharePreview: fetchAgentSharePreview,
    importShareLink: importAgentShareLink,
  } = useAgentProfiles()
  const [sharedAgentProfile, setSharedAgentProfile] = useState<import("@/lib/types/agent-profiles").AgentProfile | null>(null)
  const [isCopyingSharedAgent, setIsCopyingSharedAgent] = useState(false)

  // Track threads that have started sending but are not fully visible in the backend list yet.
  const [newThreads, setNewThreads] = useState<Set<string>>(new Set())

  // Use URL query param for thread ID (shareable, bookmarkable)
  const [threadId, setThreadId] = useQueryState("threadId")

  // Support ?q=... for auto-sending a prompt on page load
  const [initialPrompt, setInitialPrompt] = useQueryState("q")
  const [agentShareToken] = useQueryState("agentShare")
  const [agentAppParam, setAgentAppParam] = useQueryState("agentApp")
  const [viewParam, setViewParam] = useQueryState("view")
  const [editAgentIdParam, setEditAgentIdParam] = useQueryState("editAgent")
  const [createParam, setCreateParam] = useQueryState("create")
  const isAgentAppRoute = pathname === "/agentapp" || pathname.startsWith("/agentapp/")
  const dedicatedAgentAppId = isAgentAppRoute ? agentAppParam?.trim() || null : null
  const isDedicatedAgentApp = isAgentAppRoute && !!dedicatedAgentAppId
  const currentView: DashboardView = isDashboardView(viewParam) ? viewParam : "chat"
  const setCurrentView = useCallback((view: DashboardView) => {
    if (view !== "agents") {
      setEditAgentIdParam(null)
    }
    setCreateParam(null)
    setViewParam(view === "chat" ? null : view)
  }, [setCreateParam, setEditAgentIdParam, setViewParam])
  const hasInitialPrompt = !!initialPrompt?.trim()
  const activeThreadId = hasInitialPrompt ? null : threadId

  useEffect(() => {
    if (viewParam && !isDashboardView(viewParam)) {
      setViewParam(null)
    }
  }, [setViewParam, viewParam])

  useEffect(() => {
    if (isAgentAppRoute || (!agentAppParam?.trim() && !agentShareToken?.trim())) return

    const url = new URL(window.location.href)
    url.pathname = "/agentapp/"
    url.searchParams.delete("view")
    url.searchParams.delete("editAgent")
    url.searchParams.delete("create")
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
  }, [agentAppParam, agentShareToken, isAgentAppRoute, router])

  useEffect(() => {
    if (hasInitialPrompt && currentView !== "chat") {
      setCurrentView("chat")
    }
  }, [currentView, hasInitialPrompt, setCurrentView])

  useEffect(() => {
    if (!dedicatedAgentAppId || !agentProfilesLoaded) return

    const appAgent = agentProfiles.find((profile) => profile.id === dedicatedAgentAppId)
    if (!appAgent && sharedAgentProfile?.id === dedicatedAgentAppId) {
      if (currentView !== "chat") {
        setCurrentView("chat")
      }
      if (editAgentIdParam) {
        setEditAgentIdParam(null)
      }
      if (createParam) {
        setCreateParam(null)
      }
      return
    }
    if (!appAgent) {
      if (agentProfiles.length > 0) {
        setAgentAppParam(null)
      }
      return
    }

    if (selectedAgentProfileId !== dedicatedAgentAppId) {
      setSelectedAgentProfileId(dedicatedAgentAppId)
    }
    if (currentView !== "chat") {
      setCurrentView("chat")
    }
    if (editAgentIdParam) {
      setEditAgentIdParam(null)
    }
    if (createParam) {
      setCreateParam(null)
    }
  }, [
    agentProfiles,
    agentProfilesLoaded,
    createParam,
    currentView,
    dedicatedAgentAppId,
    editAgentIdParam,
    selectedAgentProfileId,
    setAgentAppParam,
    setCreateParam,
    setCurrentView,
    setEditAgentIdParam,
    setSelectedAgentProfileId,
    sharedAgentProfile,
  ])

  useEffect(() => {
    if (isDedicatedAgentApp) return

    if (editAgentIdParam && !hasInitialPrompt && currentView !== "agents") {
      setCurrentView("agents")
    }
  }, [currentView, editAgentIdParam, hasInitialPrompt, isDedicatedAgentApp, setCurrentView])

  useEffect(() => {
    if (!isMobileSidebarOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileSidebarOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isMobileSidebarOpen])

  // Get browser-specific user ID
  const userId = useUserId()

  // Load agent config from localStorage on mount
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(() => {
    if (typeof window !== 'undefined') {
      // Check config version - reset if outdated
      const savedVersion = localStorage.getItem(CONFIG_STORAGE.versionKey)
      if (savedVersion !== CONFIG_STORAGE.version) {
        // Version mismatch - clear old config and set new version
        localStorage.removeItem(CONFIG_STORAGE.key)
        localStorage.setItem(CONFIG_STORAGE.versionKey, CONFIG_STORAGE.version)
        console.log(`Config version updated to ${CONFIG_STORAGE.version}, resetting to defaults`)
      } else {
        const saved = localStorage.getItem(CONFIG_STORAGE.key)
        if (saved) {
          try {
            return JSON.parse(saved)
          } catch (e) {
            console.error('Failed to parse saved agent config:', e)
          }
        }
      }
    }
    // Default config
    return {
      model: getDefaultModel(),
      recursionLimit: 100,
      agentType: getDefaultAgent(),
    }
  })

  // Save agent config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(CONFIG_STORAGE.key, JSON.stringify(agentConfig))
  }, [agentConfig])

  // Fetch available models from OpenAI-compatible API
  useEffect(() => {
    fetchAvailableModels().then(setAvailableModels)
  }, [])

  useEffect(() => {
    setElderOptimized(localStorage.getItem(STORAGE_KEYS.ELDER_OPTIMIZED_DISPLAY) === "true")
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ELDER_OPTIMIZED_DISPLAY, String(elderOptimized))
  }, [elderOptimized])

  // Fetch user voiceprints
  useEffect(() => {
    if (!user) {
      setUserVoiceprints([])
      return
    }
    fetch(`${LANGGRAPH_API_URL}/api/user-voiceprints`, {
      headers: { Authorization: `Bearer ${user.id}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((vps) => setUserVoiceprints(vps))
      .catch(() => setUserVoiceprints([]))
  }, [user])

  // Load account-scoped conversation threads.
  const {
    threads,
    isLoading: threadsLoading,
    updateThreadMetadata,
    deleteThread,
    deleteAllUserThreads,
    addOptimisticThread,
  } = useThreads(userId || undefined)

  const currentAgentId = dedicatedAgentAppId || selectedAgentProfileId || "default"
  const activeAgentProfile = dedicatedAgentAppId
    ? agentProfiles.find((profile) => profile.id === dedicatedAgentAppId) ?? sharedAgentProfile ?? selectedAgentProfile
    : selectedAgentProfile
  const isSharedAgentApp = Boolean(
    dedicatedAgentAppId &&
    sharedAgentProfile?.id === dedicatedAgentAppId &&
    !agentProfiles.some((profile) => profile.id === dedicatedAgentAppId)
  )

  // Filter threads based on active agent
  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      const threadAgentId = thread.metadata?.agent_id || "default";
      return threadAgentId === currentAgentId;
    });
  }, [currentAgentId, threads]);

  const { clientProfile } = useClientProfile()

  // Create a new thread
  const handleNewChat = () => {
    // Switch back to chat view
    setChatSessionKey(prev => prev + 1)
    setCurrentView("chat")
    setInitialPrompt(null)
    setThreadId(null)
  }

  const handleCreateThreadForSend = () => {
    const newThreadId = generateUUID()
    setNewThreads(prev => new Set(prev).add(newThreadId))
    setThreadId(newThreadId)
    return newThreadId
  }

  // Switch to an existing thread
  const handleSelectThread = (selectedThreadId: string) => {
    setInitialPrompt(null)
    setThreadId(selectedThreadId)
  }

  // Delete a thread
  const handleDeleteThread = (threadIdToDelete: string) => {
    deleteThread(threadIdToDelete, () => {
      // If deleting current thread, create a new one
      if (threadIdToDelete === activeThreadId) {
        setThreadId(null)
      }
    })
  }

  const handleClearAllConversations = async () => {
    const deletedCount = await deleteAllUserThreads()
    setNewThreads(new Set())
    setChatSessionKey(prev => prev + 1)
    setInitialPrompt(null)
    setThreadId(null)
    return deletedCount
  }

  // Handle when thread is not found (404) or access denied (403)
  const handleThreadNotFound = () => {
    console.log('Thread not accessible - showing blank chat')
    setThreadId(null)
  }

  // Update thread metadata when messages are sent
  const handleThreadUpdate = async (
    threadId: string,
    title: string,
    lastMessage: string,
    client?: ClientProfile,
    messageCount?: number, // Track how many messages are in the thread
  ) => {
    if (!userId) return

    // Clear the pending flag once the thread has been initialized (first message sent).
    setNewThreads(prev => {
      if (!prev.has(threadId)) return prev
      const updated = new Set(prev)
      updated.delete(threadId)
      return updated
    })

    const resolvedClient = resolveClientProfile(client ?? clientProfile)
    const agentId = currentAgentId
    const sharedOwnerUserId = activeAgentProfile?.ownerUserId || null
    const sharedMetadata = sharedOwnerUserId && sharedOwnerUserId !== userId
      ? {
          shared_agent_owner_user_id: sharedOwnerUserId,
          shared_agent_viewer_user_id: userId,
          shared_agent_token: activeAgentProfile?.shareToken || agentShareToken?.trim() || null,
        }
      : {}
    const baseThreadMetadata = {
      user_id: userId,
      lastMessage,
      client: resolvedClient,
      agent_id: agentId,
      ...(isDedicatedAgentApp
        ? {
            source_type: "Agent App",
            conversation_source: "agent_app",
          }
        : {}),
      ...sharedMetadata,
    }

    // Check if this thread already exists
    const existingThread = threads.find(t => t.thread_id === threadId)
    const isUntitledThread = existingThread?.metadata?.title === "Untitled" || existingThread?.metadata?.title === t.untitled
    const shouldGenerateAITitle = !existingThread || // First message (thread doesn't exist)
                                  isUntitledThread || // First real message (was "Untitled")
                                  (messageCount && messageCount > 1 && messageCount % 5 === 0) // Every 5 messages after

    if (!existingThread || isUntitledThread) {
      // First message: Keep "Untitled" while AI title generates, then replace directly

      if (!existingThread) {
        // Thread doesn't exist at all - add it with "Untitled"
        addOptimisticThread({
          thread_id: threadId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {
            ...baseThreadMetadata,
            title: t.untitled,
          },
        })
      }

      // Update last message immediately (keep "Untitled" for now)
      await updateThreadMetadata(threadId, baseThreadMetadata)

      // Generate AI title in background - goes straight from "Untitled" to AI title
      generateThreadTitle({
        userMessage: title,
        assistantResponse: lastMessage,
      }).then((aiTitle) => {
        if (aiTitle.length > 0) {
          console.log('Setting AI title:', aiTitle)
          updateThreadMetadata(threadId, {
            ...baseThreadMetadata,
            title: aiTitle,
          })
        }
      }).catch((error) => {
        console.error('Failed to generate AI title:', error)
        // Fallback to quick title if AI fails
        const quickTitle = generateQuickTitle(title)
        updateThreadMetadata(threadId, {
          ...baseThreadMetadata,
          title: quickTitle,
        })
      })
    } else if (shouldGenerateAITitle && messageCount) {
      // Every 5 messages: Regenerate AI title based on conversation
      console.log(`Regenerating AI title at message ${messageCount}`)

      // Update last message immediately
      await updateThreadMetadata(threadId, baseThreadMetadata)

      // Generate new AI title in background
      generateThreadTitle({
        userMessage: title,
        assistantResponse: lastMessage,
      }).then((aiTitle) => {
        if (aiTitle.length > 0) {
          console.log('Updated title at message', messageCount, '→', aiTitle)
          updateThreadMetadata(threadId, {
            ...baseThreadMetadata,
            title: aiTitle,
          })
        }
      }).catch((error) => {
        console.error('Failed to regenerate AI title:', error)
      })
    } else {
      // Regular update: Just update last message, keep existing title
      await updateThreadMetadata(threadId, baseThreadMetadata)
    }
  }

  // Prompt links always start from a blank chat. The real thread ID is assigned
  // only when the prompt is actually sent.
  const processedPromptRef = useRef<string | null>(null)
  useEffect(() => {
    const trimmedPrompt = initialPrompt?.trim()
    if (!trimmedPrompt) {
      processedPromptRef.current = null
      return
    }

    if (processedPromptRef.current === trimmedPrompt) {
      return
    }

    processedPromptRef.current = trimmedPrompt
    if (threadId) {
      setThreadId(null)
    }
  }, [threadId, setThreadId, initialPrompt])

  const processedAgentShareRef = useRef<string | null>(null)
  useEffect(() => {
    const token = agentShareToken?.trim()
    if (!token || !user || processedAgentShareRef.current === token) return

    processedAgentShareRef.current = token
    fetchAgentSharePreview(token)
      .then((preview) => {
        if (!preview) {
          processedAgentShareRef.current = null
          return
        }
        setSharedAgentProfile({
          ...preview.agent,
          ownerUserId: preview.ownerUserId,
          shareToken: preview.token,
          isSharedApp: true,
        })
        const url = new URL(window.location.href)
        url.pathname = "/agentapp/"
        url.searchParams.set("agentApp", preview.agent.id)
        url.searchParams.set("agentShare", preview.token)
        url.searchParams.delete("threadId")
        url.searchParams.delete("q")
        url.searchParams.delete("view")
        url.searchParams.delete("editAgent")
        url.searchParams.delete("create")
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
      })
      .catch((err) => {
        processedAgentShareRef.current = null
        console.error("Failed to load shared agent from URL parameter", err)
      })
  }, [agentShareToken, fetchAgentSharePreview, router, user])

  const handleCopySharedAgent = useCallback(async () => {
    const token = sharedAgentProfile?.shareToken || agentShareToken?.trim()
    if (!token || isCopyingSharedAgent) return

    setIsCopyingSharedAgent(true)
    try {
      const result = await importAgentShareLink(token)
      if (!result) return
      setSharedAgentProfile(null)
      const url = new URL(window.location.href)
      url.pathname = "/agentapp/"
      url.searchParams.set("agentApp", result.agent.id)
      url.searchParams.delete("agentShare")
      url.searchParams.delete("threadId")
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
    } finally {
      setIsCopyingSharedAgent(false)
    }
  }, [agentShareToken, importAgentShareLink, isCopyingSharedAgent, router, sharedAgentProfile])

  // Handle switching active thread or creating a new one when active agent changes
  const previousSyncedAgentIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!userId || threadsLoading || !agentProfilesLoaded) return;
    if (!activeThreadId || newThreads.has(activeThreadId)) return;

    const previousAgentId = previousSyncedAgentIdRef.current
    const agentChangedAfterInitialSync = previousAgentId !== null && previousAgentId !== currentAgentId
    previousSyncedAgentIdRef.current = currentAgentId

    const activeThread = threads.find(t => t.thread_id === activeThreadId)
    const activeThreadAgentId = activeThread?.metadata?.agent_id || "default"

    if (!activeThread) {
      if (agentChangedAfterInitialSync) {
        const nextThreadId = filteredThreads[0]?.thread_id ?? null
        setThreadId(nextThreadId)
      }

      // On initial load, the thread may be outside the sidebar fetch window or
      // filtered out as empty. Keep the URL stable and let ChatInterface load it.
      return
    }

    // Direct links and page refreshes should preserve the requested thread. If the
    // URL points at a thread from another agent, select that agent instead of
    // rewriting the URL and losing the bookmarkable threadId.
    if (!agentChangedAfterInitialSync && activeThreadAgentId !== currentAgentId) {
      setSelectedAgentProfileId(activeThreadAgentId === "default" ? null : activeThreadAgentId)
      return
    }

    if (agentChangedAfterInitialSync && activeThreadAgentId !== currentAgentId) {
      const nextThreadId = filteredThreads[0]?.thread_id ?? null
      setThreadId(nextThreadId)
    }
  }, [
    agentProfilesLoaded,
    currentAgentId,
    filteredThreads,
    activeThreadId,
    newThreads,
    selectedAgentProfileId,
    setSelectedAgentProfileId,
    setThreadId,
    threads,
    threadsLoading,
    userId,
  ]);

  // Cycle to next model
  const handleCycleModel = () => {
    if (availableModels.length === 0) return
    const currentIndex = availableModels.indexOf(agentConfig.model as ModelOption)
    const nextIndex = (currentIndex + 1) % availableModels.length
    const nextModel = availableModels[nextIndex]
    setAgentConfig({ ...agentConfig, model: nextModel })

    // Trigger the existing tooltip to show
    setForceShowTooltip(prev => prev + 1)
  }

  const handleOpenActiveAgentSettings = () => {
    if (!activeAgentProfile || isSystemAgentProfile(activeAgentProfile)) return

    setEditAgentIdParam(activeAgentProfile.id)
    setCurrentView("agents")
  }

  const handleOpenCreateAgent = () => {
    setEditAgentIdParam(null)
    setCurrentView("agents")
    setCreateParam("1")
  }

  // Keyboard shortcuts
  useKeyboardShortcuts([
    {
      shortcut: {
        key: '/',
        metaKey: true,
        description: 'Toggle keyboard shortcuts',
        category: 'Navigation',
      },
      handler: () => setShowShortcutsDialog(!showShortcutsDialog),
    },
    {
      shortcut: {
        key: 'b',
        metaKey: true,
        description: 'Toggle sidebar',
        category: 'Navigation',
      },
      handler: () => setIsSidebarCollapsed(!isSidebarCollapsed),
    },
    {
      shortcut: {
        key: 'i',
        metaKey: true,
        description: 'Create new chat',
        category: 'Navigation',
      },
      handler: handleNewChat,
    },
    {
      shortcut: {
        key: 's',
        metaKey: true,
        description: 'Open user settings',
        category: 'Navigation',
      },
      handler: () => setCurrentView(currentView === "settings" ? "chat" : "settings"),
    },
    {
      shortcut: {
        key: 'j',
        metaKey: true,
        description: 'Switch model',
        category: 'Model & Agent',
      },
      handler: handleCycleModel,
    },
  ])

  if (authLoading) {
    return <DashboardFallback />
  }

  if (!user) {
    return <AuthRedirect />
  }

  return (
    <>
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
      />
      <div className={`flex h-dvh bg-background ${elderOptimized ? "elder-optimized-ui" : ""}`}>
        {!isDedicatedAgentApp && (
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            threads={filteredThreads.filter((t) => !newThreads.has(t.thread_id))}
            currentThreadId={activeThreadId || ''}
            onSelectThread={handleSelectThread}
            onDeleteThread={handleDeleteThread}
            isLoading={threadsLoading}
            currentView={currentView}
            onViewChange={setCurrentView}
          />
        )}
        {!isDedicatedAgentApp && isMobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="菜单">
            <button
              type="button"
              className="absolute inset-0 bg-foreground/35"
              onClick={() => setIsMobileSidebarOpen(false)}
              aria-label="关闭菜单"
            />
            <div className="relative h-full">
              <Sidebar
                isCollapsed={false}
                onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                threads={filteredThreads.filter((t) => !newThreads.has(t.thread_id))}
                currentThreadId={activeThreadId || ''}
                onSelectThread={handleSelectThread}
                onDeleteThread={handleDeleteThread}
                isLoading={threadsLoading}
                currentView={currentView}
                onViewChange={setCurrentView}
                isMobileDrawer
                onMobileClose={() => setIsMobileSidebarOpen(false)}
              />
            </div>
          </div>
        )}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className={currentView === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col"}
          aria-hidden={currentView !== "chat"}
        >
            {isDedicatedAgentApp && activeAgentProfile ? (
              <DedicatedAgentHeader
                agentName={activeAgentProfile.name}
                user={user}
                onNewChat={handleNewChat}
                threads={filteredThreads.filter((thread) => !newThreads.has(thread.thread_id))}
                currentThreadId={activeThreadId}
                onSelectThread={handleSelectThread}
                onDeleteThread={handleDeleteThread}
                isLoadingThreads={threadsLoading}
                onCopyAgent={isSharedAgentApp ? handleCopySharedAgent : undefined}
                copyAgentDisabled={isCopyingSharedAgent}
                onLogout={logout}
              />
            ) : (
              <Header
                onNewChat={handleNewChat}
                agentConfig={agentConfig}
                onAgentConfigChange={setAgentConfig}
                onShowShortcuts={() => setShowShortcutsDialog(true)}
                forceShowTooltip={forceShowTooltip}
                selectedAgentProfile={activeAgentProfile}
                agentProfiles={agentProfiles}
                agentProfilesLoaded={agentProfilesLoaded}
                selectedAgentProfileId={currentAgentId === "default" ? null : currentAgentId}
                onAgentProfileChange={setSelectedAgentProfileId}
                onCreateAgent={handleOpenCreateAgent}
                onOpenAgentSettings={handleOpenActiveAgentSettings}
                onOpenSidebar={() => setIsMobileSidebarOpen(true)}
              />
            )}
            <ChatInterface
              key={chatSessionKey}
              threadId={activeThreadId}
              onCreateThread={handleCreateThreadForSend}
              onThreadUpdate={handleThreadUpdate}
              onThreadNotFound={handleThreadNotFound}
              agentConfig={agentConfig}
              onAgentConfigChange={setAgentConfig}
              agentProfile={activeAgentProfile}
              agentProfilesLoaded={agentProfilesLoaded}
              onCreateAgent={handleOpenCreateAgent}
              isNewThread={activeThreadId ? newThreads.has(activeThreadId) : false}
              initialMessage={initialPrompt}
              autoSend={!!initialPrompt}
              onInitialMessageSent={() => setInitialPrompt(null)}
              conversationSource={isDedicatedAgentApp ? "agent_app" : "main"}
            />
        </div>

        {!isDedicatedAgentApp && currentView === "settings" ? (
          <UserSettingsPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            elderOptimized={elderOptimized}
            onElderOptimizedChange={setElderOptimized}
            voiceprints={userVoiceprints}
            onVoiceprintsChange={setUserVoiceprints}
            onClearAllConversations={handleClearAllConversations}
            conversationCount={threads.length}
          />
        ) : !isDedicatedAgentApp && currentView === "developer-manual" ? (
          <DeveloperManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : !isDedicatedAgentApp && currentView !== "chat" ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ManagementDashboard
              initialTab={currentView === "skills" ? "skills" : currentView === "agents" ? "agents" : currentView === "mcp" ? "mcp" : currentView === "forms" ? "forms" : "knowledge"}
              onBackToChat={() => setCurrentView("chat")}
              agentProfiles={agentProfiles}
              selectedAgentProfileId={selectedAgentProfileId}
              setSelectedAgentProfileId={setSelectedAgentProfileId}
              createAgentProfile={createAgentProfile}
              updateAgentProfile={updateAgentProfile}
              fetchAgentProfileVersions={fetchAgentProfileVersions}
              restoreAgentProfileVersion={restoreAgentProfileVersion}
              createAgentShareLink={createAgentShareLink}
              userVoiceprints={userVoiceprints}
              onNavigateToUserSettings={() => setCurrentView("settings")}
              deleteAgentProfile={deleteAgentProfile}
              editAgentIdOnOpen={editAgentIdParam}
              onEditAgentChange={setEditAgentIdParam}
              createOnOpen={createParam === "1"}
              onCreateChange={(creating) => setCreateParam(creating ? "1" : null)}
            />
          </div>
        ) : null}
      </div>
    </div>
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardContent />
    </Suspense>
  )
}
