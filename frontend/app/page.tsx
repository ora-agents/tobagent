"use client"

import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
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
import { useT } from "@/lib/i18n"
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder"
import { STORAGE_KEYS } from "@/lib/constants/features"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

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

function DashboardContent() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [forceShowTooltip, setForceShowTooltip] = useState(0)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [createAgentOnOpenSignal, setCreateAgentOnOpenSignal] = useState(0)
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
    importShareLink: importAgentShareLink,
    importTomlConfig: importAgentTomlConfig,
  } = useAgentProfiles()

  // Track threads that have started sending but are not fully visible in the backend list yet.
  const [newThreads, setNewThreads] = useState<Set<string>>(new Set())

  // Use URL query param for thread ID (shareable, bookmarkable)
  const [threadId, setThreadId] = useQueryState("threadId")

  // Support ?q=... for auto-sending a prompt on page load
  const [initialPrompt, setInitialPrompt] = useQueryState("q")
  const [agentShareToken, setAgentShareToken] = useQueryState("agentShare")
  const [viewParam, setViewParam] = useQueryState("view")
  const [editAgentIdParam, setEditAgentIdParam] = useQueryState("editAgent")
  const currentView: DashboardView = isDashboardView(viewParam) ? viewParam : "chat"
  const setCurrentView = useCallback((view: DashboardView) => {
    if (view !== "agents") {
      setEditAgentIdParam(null)
    }
    setViewParam(view === "chat" ? null : view)
  }, [setEditAgentIdParam, setViewParam])
  const hasInitialPrompt = !!initialPrompt?.trim()
  const activeThreadId = hasInitialPrompt ? null : threadId

  useEffect(() => {
    if (viewParam && !isDashboardView(viewParam)) {
      setViewParam(null)
    }
  }, [setViewParam, viewParam])

  useEffect(() => {
    if (hasInitialPrompt && currentView !== "chat") {
      setCurrentView("chat")
    }
  }, [currentView, hasInitialPrompt, setCurrentView])

  useEffect(() => {
    if (editAgentIdParam && !hasInitialPrompt && currentView !== "agents") {
      setCurrentView("agents")
    }
  }, [currentView, editAgentIdParam, hasInitialPrompt, setCurrentView])

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

  // Filter threads based on active agent
  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      const threadAgentId = thread.metadata?.agent_id || "default";
      const currentAgentId = selectedAgentProfileId || "default";
      return threadAgentId === currentAgentId;
    });
  }, [threads, selectedAgentProfileId]);
  const currentAgentId = selectedAgentProfileId || "default"

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
    const agentId = selectedAgentProfileId || "default"

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
            user_id: userId,
            title: t.untitled,
            lastMessage,
            client: resolvedClient,
            agent_id: agentId,
          },
        })
      }

      // Update last message immediately (keep "Untitled" for now)
      await updateThreadMetadata(threadId, {
        user_id: userId,
        lastMessage,
        client: resolvedClient,
        agent_id: agentId,
      })

      // Generate AI title in background - goes straight from "Untitled" to AI title
      generateThreadTitle({
        userMessage: title,
        assistantResponse: lastMessage,
      }).then((aiTitle) => {
        if (aiTitle.length > 0) {
          console.log('Setting AI title:', aiTitle)
          updateThreadMetadata(threadId, {
            user_id: userId,
            title: aiTitle,
            lastMessage,
            client: resolvedClient,
            agent_id: agentId,
          })
        }
      }).catch((error) => {
        console.error('Failed to generate AI title:', error)
        // Fallback to quick title if AI fails
        const quickTitle = generateQuickTitle(title)
        updateThreadMetadata(threadId, {
          user_id: userId,
          title: quickTitle,
          lastMessage,
          client: resolvedClient,
          agent_id: agentId,
        })
      })
    } else if (shouldGenerateAITitle && messageCount) {
      // Every 5 messages: Regenerate AI title based on conversation
      console.log(`Regenerating AI title at message ${messageCount}`)

      // Update last message immediately
      await updateThreadMetadata(threadId, {
        user_id: userId,
        lastMessage,
        client: resolvedClient,
        agent_id: agentId,
      })

      // Generate new AI title in background
      generateThreadTitle({
        userMessage: title,
        assistantResponse: lastMessage,
      }).then((aiTitle) => {
        if (aiTitle.length > 0) {
          console.log('Updated title at message', messageCount, '→', aiTitle)
          updateThreadMetadata(threadId, {
            user_id: userId,
            title: aiTitle,
            lastMessage,
            client: resolvedClient,
            agent_id: agentId,
          })
        }
      }).catch((error) => {
        console.error('Failed to regenerate AI title:', error)
      })
    } else {
      // Regular update: Just update last message, keep existing title
      await updateThreadMetadata(threadId, {
        user_id: userId,
        lastMessage,
        client: resolvedClient,
        agent_id: agentId,
      })
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
    importAgentShareLink(token)
      .then((result) => {
        if (!result) {
          processedAgentShareRef.current = null
          return
        }
        setCurrentView("chat")
        setThreadId(null)
        setEditAgentIdParam(null)
        setAgentShareToken(null)
      })
      .catch((err) => {
        processedAgentShareRef.current = null
        console.error("Failed to import shared agent from URL parameter", err)
      })
  }, [agentShareToken, importAgentShareLink, setAgentShareToken, setEditAgentIdParam, setThreadId, user])

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
    setEditAgentIdParam(selectedAgentProfileId)
    setCurrentView("agents")
  }

  const handleOpenCreateAgent = () => {
    setEditAgentIdParam(null)
    setCreateAgentOnOpenSignal(prev => prev + 1)
    setCurrentView("agents")
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
        {isMobileSidebarOpen && (
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
            <Header
              onNewChat={handleNewChat}
              agentConfig={agentConfig}
              onAgentConfigChange={setAgentConfig}
              onShowShortcuts={() => setShowShortcutsDialog(true)}
              forceShowTooltip={forceShowTooltip}
              selectedAgentProfile={selectedAgentProfile}
              agentProfiles={agentProfiles}
              agentProfilesLoaded={agentProfilesLoaded}
              selectedAgentProfileId={selectedAgentProfileId}
              onAgentProfileChange={setSelectedAgentProfileId}
              onCreateAgent={handleOpenCreateAgent}
              onOpenAgentSettings={handleOpenActiveAgentSettings}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            />
            <ChatInterface
              key={chatSessionKey}
              threadId={activeThreadId}
              onCreateThread={handleCreateThreadForSend}
              onThreadUpdate={handleThreadUpdate}
              onThreadNotFound={handleThreadNotFound}
              agentConfig={agentConfig}
              onAgentConfigChange={setAgentConfig}
              agentProfile={selectedAgentProfile}
              agentProfilesLoaded={agentProfilesLoaded}
              onCreateAgent={handleOpenCreateAgent}
              isNewThread={activeThreadId ? newThreads.has(activeThreadId) : false}
              initialMessage={initialPrompt}
              autoSend={!!initialPrompt}
              onInitialMessageSent={() => setInitialPrompt(null)}
            />
        </div>

        {currentView === "settings" ? (
          <UserSettingsPage
            onBackToChat={() => setCurrentView("chat")}
            elderOptimized={elderOptimized}
            onElderOptimizedChange={setElderOptimized}
            voiceprints={userVoiceprints}
            onVoiceprintsChange={setUserVoiceprints}
            onClearAllConversations={handleClearAllConversations}
            conversationCount={threads.length}
          />
        ) : currentView === "developer-manual" ? (
          <DeveloperManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : currentView !== "chat" ? (
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
              importAgentTomlConfig={importAgentTomlConfig}
              userVoiceprints={userVoiceprints}
              onNavigateToUserSettings={() => setCurrentView("settings")}
              deleteAgentProfile={deleteAgentProfile}
              editAgentIdOnOpen={editAgentIdParam}
              onEditAgentChange={setEditAgentIdParam}
              createAgentOnOpenSignal={createAgentOnOpenSignal}
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
