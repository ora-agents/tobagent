"use client"

import { Suspense, useState, useEffect, useRef, useMemo } from "react"
import Image from "next/image"
import { useQueryState } from "nuqs"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ChatInterface } from "@/components/chat/chat-interface"
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import { UserSettingsPage } from "@/components/layout/user-settings-page"
import { AuthPanel } from "@/components/layout/auth-panel"
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

function DashboardContent() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentView, setCurrentView] = useState<"chat" | "skills" | "agents" | "knowledge" | "mcp" | "settings">("chat")
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [forceShowTooltip, setForceShowTooltip] = useState(0)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [editAgentIdOnOpen, setEditAgentIdOnOpen] = useState<string | null>(null)
  const [chatSessionKey, setChatSessionKey] = useState(0)
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
  } = useAgentProfiles()

  // Track threads that have started sending but are not fully visible in the backend list yet.
  const [newThreads, setNewThreads] = useState<Set<string>>(new Set())

  // Use URL query param for thread ID (shareable, bookmarkable)
  const [threadId, setThreadId] = useQueryState("threadId")

  // Support ?q=... for auto-sending a prompt on page load
  const [initialPrompt, setInitialPrompt] = useQueryState("q")
  const hasInitialPrompt = !!initialPrompt?.trim()
  const activeThreadId = hasInitialPrompt ? null : threadId

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
    setEditAgentIdOnOpen(selectedAgentProfileId)
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
    return (
      <div className="h-screen overflow-hidden bg-background text-foreground">
        <div className="relative mx-auto grid h-full w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_0.9fr]">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-28 top-16 h-72 w-72 rounded-full bg-[#164199]/10 blur-[96px]" />
            <div className="absolute right-10 top-1/3 h-64 w-64 rounded-full bg-primary/10 blur-[96px]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(22,65,153,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(204,120,92,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_70%_60%_at_35%_40%,#000_45%,transparent_100%)]" />
          </div>

          <main className="relative hidden min-h-0 flex-col justify-between px-6 py-7 sm:px-10 lg:flex lg:px-14 lg:py-10">
            <div className="flex items-center gap-3">
              <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" />
              <div>
                <div className="text-sm font-medium tracking-tight">{t.loginBrandName}</div>
                <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
              </div>
            </div>

            <section className="max-w-2xl py-8">
              <div className="mb-5 inline-flex rounded-full border border-border bg-[#efe9de] px-3 py-1.5 text-xs font-medium tracking-[0.12em] text-muted-foreground dark:bg-card">
                {t.loginBadge}
              </div>
              <h1 className="font-display text-[4.8rem] font-medium leading-[0.95] tracking-[-0.045em] text-foreground">
                {t.loginHeadline}
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                {t.loginDescription}
              </p>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              {[
                [t.loginMetricScene, t.loginMetricSceneDesc],
                [t.loginMetricKnowledge, t.loginMetricKnowledgeDesc],
                [t.loginMetricTools, t.loginMetricToolsDesc],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-[#efe9de] p-4 dark:bg-card">
                  <div className="font-mono text-xs text-primary">{label}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{value}</div>
                </div>
              ))}
            </section>
          </main>

          <aside className="relative flex min-h-0 items-center justify-center px-5 py-5 sm:px-8 lg:px-12 lg:py-10">
            <div className="absolute inset-y-10 left-0 hidden w-px bg-border lg:block" />
            <div className="w-full max-w-[31rem] space-y-4">
              <div className="flex items-center gap-3 lg:hidden">
                <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" />
                <div>
                  <div className="text-sm font-medium">{t.loginBrandName}</div>
                  <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
                </div>
              </div>

              <div className="hidden rounded-2xl bg-[#181715] p-5 text-[#faf9f5] shadow-depth-lg sm:block">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#164199]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#5db8a6]" />
                  </div>
                  <span className="font-mono text-xs text-[#a09d96]">{t.loginConsoleTitle}</span>
                </div>
                <div className="rounded-xl bg-[#1f1e1b] p-4 font-mono text-xs leading-6 text-[#a09d96]">
                  <div>{t.loginConsoleIdentity}</div>
                  <div>{t.loginConsoleKnowledge}</div>
                  <div>{t.loginConsoleAction}</div>
                  <div className="mt-3 rounded-lg bg-[#252320] px-3 py-2 text-[#faf9f5]">
                    {t.loginConsoleStatus}
                  </div>
                </div>
              </div>

              <AuthPanel open={true} onOpenChange={() => {}} inline />
            </div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <>
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
      />
      <div className={`flex h-screen bg-background ${elderOptimized ? "elder-optimized-ui" : ""}`}>
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
      <div className="flex-1 flex flex-col overflow-hidden">
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
              onCreateAgent={() => setCurrentView("agents")}
              onOpenAgentSettings={handleOpenActiveAgentSettings}
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
              onCreateAgent={() => setCurrentView("agents")}
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
          />
        ) : currentView !== "chat" ? (
          <ManagementDashboard
            initialTab={currentView === "skills" ? "skills" : currentView === "agents" ? "agents" : currentView === "mcp" ? "mcp" : "knowledge"}
            onBackToChat={() => setCurrentView("chat")}
            agentProfiles={agentProfiles}
            selectedAgentProfileId={selectedAgentProfileId}
            setSelectedAgentProfileId={setSelectedAgentProfileId}
            createAgentProfile={createAgentProfile}
            updateAgentProfile={updateAgentProfile}
            userVoiceprints={userVoiceprints}
            onNavigateToUserSettings={() => setCurrentView("settings")}
            deleteAgentProfile={deleteAgentProfile}
            editAgentIdOnOpen={editAgentIdOnOpen}
            onEditAgentIdHandled={() => setEditAgentIdOnOpen(null)}
          />
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
