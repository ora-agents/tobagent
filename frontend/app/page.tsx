"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { useQueryState } from "nuqs"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ChatInterface } from "@/components/chat/chat-interface"
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog"
import { AgentProfilesDialog } from "@/components/layout/agent-profiles-dialog"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import { useThreads, type ClientProfile } from "@/lib/hooks/threads"
import { useUserId, useClientProfile } from "@/lib/hooks/auth"
import { resolveClientProfile } from "@/lib/config/client-config"
import type { AgentConfig } from "@/components/layout/agent-settings"
import { generateQuickTitle, generateThreadTitle } from "@/lib/utils/string"
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

function DashboardContent() {
  const t = useT()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [currentView, setCurrentView] = useState<"chat" | "skills" | "agents" | "knowledge" | "mcp">("chat")
  const [showToolCalls, setShowToolCalls] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
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

  // Track newly created threads that haven't been initialized in backend yet
  const [newThreads, setNewThreads] = useState<Set<string>>(new Set())

  // Use URL query param for thread ID (shareable, bookmarkable)
  const [threadId, setThreadId] = useQueryState("threadId")

  // Support ?q=... for auto-sending a prompt on page load
  const [initialPrompt, setInitialPrompt] = useQueryState("q")

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

  const { clientProfile } = useClientProfile()

  // Create a new thread
  const handleNewChat = () => {
    const newThreadId = crypto.randomUUID()

    // Switch back to chat view
    setCurrentView("chat")

    // Mark this thread as new (doesn't exist in backend yet)
    setNewThreads(prev => new Set(prev).add(newThreadId))

    // Immediately add "Untitled" thread to sidebar
    if (userId) {
      addOptimisticThread({
        thread_id: newThreadId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          user_id: userId,
          title: t.untitled,
          lastMessage: "",
          client: resolveClientProfile(clientProfile),
        },
      })
    }

    setThreadId(newThreadId)
  }

  // Switch to an existing thread
  const handleSelectThread = (selectedThreadId: string) => {
    setThreadId(selectedThreadId)
  }

  // Delete a thread
  const handleDeleteThread = (threadIdToDelete: string) => {
    deleteThread(threadIdToDelete, () => {
      // If deleting current thread, create a new one
      if (threadIdToDelete === threadId) {
        const newThreadId = crypto.randomUUID()
        setThreadId(newThreadId)
      }
    })
  }

  // Handle when thread is not found (404) or access denied (403)
  const handleThreadNotFound = () => {
    console.log('Thread not accessible - creating new thread')

    // Always create a new thread when current thread is not accessible
    const newThreadId = crypto.randomUUID()

    // Mark this thread as new (doesn't exist in backend yet)
    setNewThreads(prev => new Set(prev).add(newThreadId))

    // Add to sidebar optimistically
    if (userId) {
      addOptimisticThread({
        thread_id: newThreadId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          user_id: userId,
          title: t.untitled,
          lastMessage: "",
          client: resolveClientProfile(clientProfile),
        },
      })
    }

    setThreadId(newThreadId)
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

    // Clear the new thread flag once the thread has been initialized (first message sent)
    if (newThreads.has(threadId)) {
      setNewThreads(prev => {
        const updated = new Set(prev)
        updated.delete(threadId)
        return updated
      })
    }

    const resolvedClient = resolveClientProfile(client ?? clientProfile)

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
          },
        })
      }

      // Update last message immediately (keep "Untitled" for now)
      await updateThreadMetadata(threadId, {
        user_id: userId,
        lastMessage,
        client: resolvedClient,
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
      })
    }
  }

  // If no threadId in URL, create one
  // Also create a new thread if ?q= is present (always start fresh for prompt links)
  const hasProcessedPromptRef = useRef(false)
  useEffect(() => {
    // Validate and process ?q= param - create fresh thread for prompt links
    const trimmedPrompt = initialPrompt?.trim()
    if (trimmedPrompt && !hasProcessedPromptRef.current) {
      hasProcessedPromptRef.current = true
      const newThreadId = crypto.randomUUID()
      setNewThreads(prev => new Set(prev).add(newThreadId))
      setThreadId(newThreadId)
      return
    }

    // Create a thread if none exists
    if (!threadId) {
      const newThreadId = crypto.randomUUID()
      setNewThreads(prev => new Set(prev).add(newThreadId))
      setThreadId(newThreadId)
    }
  }, [threadId, setThreadId, initialPrompt])

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
        description: 'Toggle settings',
        category: 'Navigation',
      },
      handler: () => setShowSettingsDialog(!showSettingsDialog),
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
          threads={threads}
          currentThreadId={threadId || ''}
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
              showSettingsDialog={showSettingsDialog}
              onSettingsDialogChange={setShowSettingsDialog}
              selectedAgentProfile={selectedAgentProfile}
              onOpenAgentProfiles={() => setShowAgentProfilesDialog(true)}
            />
            {threadId && (
              <ChatInterface
                key={threadId}
                showToolCalls={showToolCalls}
                threadId={threadId}
                onThreadUpdate={handleThreadUpdate}
                onThreadNotFound={handleThreadNotFound}
                agentConfig={agentConfig}
                onAgentConfigChange={setAgentConfig}
                agentProfile={selectedAgentProfile}
                onOpenAgentProfiles={() => setShowAgentProfilesDialog(true)}
                isNewThread={newThreads.has(threadId)}
                initialMessage={initialPrompt}
                autoSend={!!initialPrompt}
                onInitialMessageSent={() => setInitialPrompt(null)}
              />
            )}
          </>
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
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
