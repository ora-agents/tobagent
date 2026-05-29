"use client"

import { Suspense, useState, useEffect, useRef, useMemo } from "react"
import { useQueryState } from "nuqs"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ChatInterface } from "@/components/chat/chat-interface"
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog"
import { AgentProfilesDialog } from "@/components/layout/agent-profiles-dialog"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import { UserSettingsPage } from "@/components/layout/user-settings-page"
import { AuthDialog } from "@/components/layout/auth-dialog"
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

function DashboardFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-card/70 p-5">
        <div className="mb-4 h-2 w-10 rounded-full bg-primary/70" />
        <LoadingPlaceholder className="mb-3 h-5 w-40" label="Loading dashboard" />
        <LoadingPlaceholder className="mb-2 h-3 w-full" />
        <LoadingPlaceholder className="h-3 w-3/4" />
      </div>
    </div>
  )
}

function DashboardContent() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentView, setCurrentView] = useState<"chat" | "skills" | "agents" | "knowledge" | "mcp" | "settings">("chat")
  const [showToolCalls, setShowToolCalls] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [showAgentProfilesDialog, setShowAgentProfilesDialog] = useState(false)
  const [forceShowTooltip, setForceShowTooltip] = useState(0)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])

  // Agent profiles (custom configurable agents)
  const {
    profiles: agentProfiles,
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

  // Load threads from LangGraph backend
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

  const { clientProfile } = useClientProfile()

  // Create a new thread
  const handleNewChat = () => {
    // Switch back to chat view
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
  useEffect(() => {
    if (!userId || threadsLoading) return;
    if (!activeThreadId || newThreads.has(activeThreadId)) return;

    // Check if the current threadId is in the filteredThreads
    const currentThreadInFiltered = filteredThreads.some(t => t.thread_id === activeThreadId);
    
    // If current thread does not belong to the selected agent:
    if (!currentThreadInFiltered) {
      if (filteredThreads.length > 0) {
        // Switch to the most recent thread of the selected agent
        setThreadId(filteredThreads[0].thread_id);
      } else {
        // If there are no threads for this agent, show a blank chat.
        setThreadId(null);
      }
    }
  }, [selectedAgentProfileId, threadsLoading, filteredThreads, activeThreadId, newThreads, userId, setThreadId]);

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
      <div className="flex h-screen items-center justify-center bg-background">
        <AuthDialog open={true} onOpenChange={() => {}} />
      </div>
    )
  }

  return (
    <>
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
      />
      <AgentProfilesDialog
        open={showAgentProfilesDialog}
        onOpenChange={setShowAgentProfilesDialog}
        profiles={agentProfiles}
        selectedId={selectedAgentProfileId}
        onSelect={setSelectedAgentProfileId}
        onCreate={createAgentProfile}
        onUpdate={updateAgentProfile}
        onDelete={deleteAgentProfile}
      />
      <div className="flex h-screen bg-background">
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
        {currentView === "chat" ? (
          <>
            <Header
              showToolCalls={showToolCalls}
              onToggleToolCalls={() => setShowToolCalls(!showToolCalls)}
              onNewChat={handleNewChat}
              agentConfig={agentConfig}
              onAgentConfigChange={setAgentConfig}
              onShowShortcuts={() => setShowShortcutsDialog(true)}
              forceShowTooltip={forceShowTooltip}
              selectedAgentProfile={selectedAgentProfile}
              onOpenAgentSettings={() => setCurrentView("agents")}
            />
            <ChatInterface
              showToolCalls={showToolCalls}
              threadId={activeThreadId}
              onCreateThread={handleCreateThreadForSend}
              onThreadUpdate={handleThreadUpdate}
              onThreadNotFound={handleThreadNotFound}
              agentConfig={agentConfig}
              onAgentConfigChange={setAgentConfig}
              agentProfile={selectedAgentProfile}
              agentProfiles={agentProfiles}
              onAgentProfileChange={setSelectedAgentProfileId}
              isNewThread={activeThreadId ? newThreads.has(activeThreadId) : false}
              initialMessage={initialPrompt}
              autoSend={!!initialPrompt}
              onInitialMessageSent={() => setInitialPrompt(null)}
            />
          </>
        ) : currentView === "settings" ? (
          <UserSettingsPage
            onBackToChat={() => setCurrentView("chat")}
          />
        ) : (
          <ManagementDashboard
            initialTab={currentView === "skills" ? "skills" : currentView === "agents" ? "agents" : currentView === "mcp" ? "mcp" : "knowledge"}
            onBackToChat={() => setCurrentView("chat")}
            agentProfiles={agentProfiles}
            selectedAgentProfileId={selectedAgentProfileId}
            setSelectedAgentProfileId={setSelectedAgentProfileId}
            createAgentProfile={createAgentProfile}
            updateAgentProfile={updateAgentProfile}
            deleteAgentProfile={deleteAgentProfile}
          />
        )}
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
