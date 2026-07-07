"use client"

import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useQueryState } from "nuqs"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { ChatInterface } from "@/components/chat/chat-interface"
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog"
import { DashboardFallback } from "@/components/layout/dashboard-fallback"
import { DashboardMobileSidebar } from "@/components/layout/dashboard-mobile-sidebar"
import { DashboardViewPane, DashboardWorkspace } from "@/components/layout/dashboard-workspace"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import { UserSettingsPage } from "@/components/layout/user-settings-page"
import { UserManualPage } from "@/components/layout/user-manual-page"
import { DeveloperManualPage } from "@/components/layout/developer-manual-page"
import { TraceBrowserPage } from "@/components/layout/trace-browser-page"
import { WechatPayQrCode } from "@/components/payments/wechat-pay-qr-code"
import { Button } from "@/components/ui/button"
import { StatusNotice } from "@/components/ui/status-notice"
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
import { useT } from "@/lib/i18n"
import { STORAGE_KEYS } from "@/lib/constants/features"
import { backendFetch } from "@/lib/api/backend-fetch"

const DASHBOARD_VIEWS = ["chat", "skills", "agents", "knowledge", "forms", "mcp", "settings", "user-manual", "developer-manual", "traces"] as const
type DashboardView = (typeof DASHBOARD_VIEWS)[number]

function isDashboardView(value: string | null): value is DashboardView {
  return DASHBOARD_VIEWS.includes(value as DashboardView)
}

function formatCny(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
}

function formatTrialDuration(minutes: number) {
  if (minutes <= 0) return ""
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

function formatTrialRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  if (minutes > 0) return `${minutes} 分钟 ${seconds} 秒`
  return `${seconds} 秒`
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
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading: authLoading, capabilities, authHeaders } = useAuth()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [forceShowTooltip, setForceShowTooltip] = useState(0)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [chatSessionKey, setChatSessionKey] = useState(0)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
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
    listShareLinks: listAgentShareLinks,
    updateShareLink: updateAgentShareLink,
    deleteShareLink: deleteAgentShareLink,
    fetchSharePreview: fetchAgentSharePreview,
    importShareLink: importAgentShareLink,
    fetchShareAccess,
    purchaseShare,
    fetchPaymentOrder,
    refreshProfiles: refreshAgentProfiles,
  } = useAgentProfiles()
  const [sharedAgentProfile, setSharedAgentProfile] = useState<import("@/lib/types/agent-profiles").AgentProfile | null>(null)
  const [pendingPaidShare, setPendingPaidShare] = useState<import("@/lib/types/agent-profiles").AgentSharePreview | null>(null)
  const [trialPaidShare, setTrialPaidShare] = useState<import("@/lib/types/agent-profiles").AgentSharePreview | null>(null)
  const [trialShareAccess, setTrialShareAccess] = useState<import("@/lib/types/agent-profiles").AgentShareAccess | null>(null)
  const [trialNow, setTrialNow] = useState(() => Date.now())
  const [purchaseOrder, setPurchaseOrder] = useState<import("@/lib/types/agent-profiles").AgentSharePurchase | null>(null)
  const [purchaseStatus, setPurchaseStatus] = useState<"idle" | "creating" | "waiting" | "paid" | "error">("idle")

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
  const isConfigView = currentView === "skills" || currentView === "agents" || currentView === "knowledge" || currentView === "forms" || currentView === "mcp"
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
    if (currentView === "traces" && !capabilities.langfuseTracing) {
      setCurrentView("chat")
    }
  }, [capabilities.langfuseTracing, currentView, setCurrentView])

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

  const isDedicatedAgentAppView = useCallback((view: DashboardView) => {
    return view === "chat"
      || view === "skills"
      || view === "agents"
      || view === "knowledge"
      || view === "forms"
      || view === "mcp"
      || view === "settings"
      || view === "user-manual"
      || view === "developer-manual"
      || view === "traces"
  }, [])

  useEffect(() => {
    if (!dedicatedAgentAppId || !agentProfilesLoaded) return

    const appAgent = agentProfiles.find((profile) => profile.id === dedicatedAgentAppId)
    if (!appAgent && sharedAgentProfile?.id === dedicatedAgentAppId) {
      if (!isDedicatedAgentAppView(currentView)) {
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
    if (!isDedicatedAgentAppView(currentView)) {
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
    isDedicatedAgentAppView,
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
            const parsed = JSON.parse(saved)
            return {
              ...parsed,
              modelTemperature: typeof parsed.modelTemperature === "number" ? parsed.modelTemperature : 1,
            }
          } catch (e) {
            console.error('Failed to parse saved agent config:', e)
          }
        }
      }
    }
    // Default config
    return {
      model: getDefaultModel(),
      modelTemperature: 1,
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



  // Fetch user voiceprints
  useEffect(() => {
    if (!user) {
      setUserVoiceprints([])
      return
    }
    backendFetch("/api/user-voiceprints", {
      authHeaders,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((vps) => setUserVoiceprints(vps))
      .catch(() => setUserVoiceprints([]))
  }, [authHeaders, user])

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
  const trialExpiresAtMs = useMemo(() => {
    if (!trialShareAccess?.trialExpiresAt) return null
    const time = new Date(trialShareAccess.trialExpiresAt).getTime()
    return Number.isFinite(time) ? time : null
  }, [trialShareAccess?.trialExpiresAt])
  const trialRemainingMs = trialExpiresAtMs === null ? null : Math.max(0, trialExpiresAtMs - trialNow)
  const isTrialAgentApp = Boolean(
    isDedicatedAgentApp
    && activeAgentProfile?.isSharedApp
    && trialShareAccess?.requiresPurchase
    && !trialShareAccess.purchased
  )
  const isTrialActive = isTrialAgentApp && trialShareAccess?.trialActive && trialRemainingMs !== null && trialRemainingMs > 0

  useEffect(() => {
    if (!isTrialAgentApp) return
    if (currentView !== "chat" && currentView !== "settings") {
      setCurrentView("chat")
    }
  }, [currentView, isTrialAgentApp, setCurrentView])

  useEffect(() => {
    if (!isTrialAgentApp || !trialExpiresAtMs) return
    setTrialNow(Date.now())
    const timer = window.setInterval(() => setTrialNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isTrialAgentApp, trialExpiresAtMs])

  useEffect(() => {
    if (!isTrialAgentApp || isTrialActive || !trialPaidShare) return
    setPendingPaidShare(trialPaidShare)
    setSharedAgentProfile(null)
    setPurchaseOrder(null)
    setPurchaseStatus("idle")
    setCurrentView("chat")
  }, [isTrialActive, isTrialAgentApp, setCurrentView, trialPaidShare])

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
      ...(activeAgentProfile?.name ? { agent_name: activeAgentProfile.name } : {}),
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
    Promise.all([
      fetchAgentSharePreview(token),
      fetchShareAccess(token),
    ])
      .then(async ([preview, access]) => {
        if (!preview || !access) {
          processedAgentShareRef.current = null
          return
        }
        setTrialShareAccess(null)
        setTrialPaidShare(null)
        if (access.requiresPurchase && !access.purchased && access.trialActive) {
          const imported = await importAgentShareLink(token)
          if (!imported) {
            console.error("Failed to copy trial shared agent into user configuration")
          }
          const trialAgent = {
            ...preview.agent,
            ownerUserId: preview.ownerUserId,
            shareToken: preview.token,
            isSharedApp: true,
          }
          setSharedAgentProfile(trialAgent)
          setTrialShareAccess(access)
          setTrialPaidShare(preview)
          setPendingPaidShare(null)
          setPurchaseOrder(null)
          setPurchaseStatus("idle")
          setAgentAppParam(preview.agent.id)
          setCurrentView("chat")
          return
        }
        if (access.requiresPurchase && !access.purchased) {
          setSharedAgentProfile(null)
          setPendingPaidShare(preview)
          setPurchaseOrder(null)
          setPurchaseStatus("idle")
          setCurrentView("chat")
          return
        }
        const imported = await importAgentShareLink(token)
        if (!imported) {
          processedAgentShareRef.current = null
          return
        }
        setSharedAgentProfile(null)
        setTrialShareAccess(null)
        setTrialPaidShare(null)
        setPendingPaidShare(null)
        setSelectedAgentProfileId(imported.agent.id)
        const url = new URL(window.location.href)
        url.pathname = "/agentapp/"
        url.searchParams.set("agentApp", imported.agent.id)
        url.searchParams.delete("agentShare")
        url.searchParams.delete("threadId")
        url.searchParams.delete("q")
        url.searchParams.delete("view")
        url.searchParams.delete("editAgent")
        url.searchParams.delete("create")
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
      })
      .catch((err) => {
        processedAgentShareRef.current = null
        console.error("Failed to import shared agent from URL parameter", err)
      })
  }, [agentShareToken, fetchShareAccess, fetchAgentSharePreview, importAgentShareLink, router, setAgentAppParam, setCurrentView, setSelectedAgentProfileId, user])

  const completePaidShareImport = useCallback(async () => {
    const token = agentShareToken?.trim()
    if (!token) return
    const imported = await importAgentShareLink(token)
    if (!imported) return
    setPendingPaidShare(null)
    setTrialPaidShare(null)
    setTrialShareAccess(null)
    setSharedAgentProfile(null)
    setPurchaseOrder(null)
    setPurchaseStatus("paid")
    setSelectedAgentProfileId(imported.agent.id)

    const url = new URL(window.location.href)
    url.pathname = "/agentapp/"
    url.searchParams.set("agentApp", imported.agent.id)
    url.searchParams.delete("agentShare")
    url.searchParams.delete("threadId")
    url.searchParams.delete("q")
    url.searchParams.delete("view")
    url.searchParams.delete("editAgent")
    url.searchParams.delete("create")
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
  }, [agentShareToken, importAgentShareLink, router, setSelectedAgentProfileId])

  const handlePurchaseSharedAgent = useCallback(async () => {
    const token = agentShareToken?.trim()
    if (!token || purchaseStatus === "creating") return
    if (purchaseOrder && purchaseStatus === "waiting") {
      if (trialPaidShare) {
        setPendingPaidShare(trialPaidShare)
      }
      return
    }
    setPurchaseStatus("creating")
    const order = await purchaseShare(token)
    if (!order) {
      setPurchaseStatus("error")
      return
    }
    setPurchaseOrder(order)
    if (order.status === "paid") {
      await completePaidShareImport()
      return
    }
    if (trialPaidShare) {
      setPendingPaidShare(trialPaidShare)
    }
    setPurchaseStatus("waiting")
  }, [agentShareToken, completePaidShareImport, purchaseOrder, purchaseShare, purchaseStatus, trialPaidShare])

  const handleReturnToTrialSharedAgent = useCallback(() => {
    if (!isTrialActive) return
    setPendingPaidShare(null)
    setCurrentView("chat")
  }, [isTrialActive, setCurrentView])

  useEffect(() => {
    if (!purchaseOrder || purchaseStatus !== "waiting") return
    const timer = window.setInterval(async () => {
      const order = await fetchPaymentOrder(purchaseOrder.orderId)
      if (order?.status === "paid") {
        window.clearInterval(timer)
        await completePaidShareImport()
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [completePaidShareImport, fetchPaymentOrder, purchaseOrder, purchaseStatus])

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
      <DashboardWorkspace
        className={isDedicatedAgentApp ? "text-foreground" : undefined}
        sidebar={!isDedicatedAgentApp ? (
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
        ) : isDedicatedAgentApp && activeAgentProfile ? (
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
            variant="agentApp"
            agentName={activeAgentProfile.name}
            onNewChat={handleNewChat}
            hideAgentAppRestrictedNav={isTrialAgentApp}
          />
        ) : null}
        mobileSidebar={
          <DashboardMobileSidebar
            open={isMobileSidebarOpen}
            onClose={() => setIsMobileSidebarOpen(false)}
            sidebarProps={{
              isCollapsed: false,
              onToggle: () => setIsSidebarCollapsed(!isSidebarCollapsed),
              threads: filteredThreads.filter((thread) => !newThreads.has(thread.thread_id)),
              currentThreadId: activeThreadId || "",
              onSelectThread: handleSelectThread,
              onDeleteThread: handleDeleteThread,
              isLoading: threadsLoading,
              currentView,
              onViewChange: setCurrentView,
              variant: isDedicatedAgentApp ? "agentApp" : "default",
              agentName: isDedicatedAgentApp ? activeAgentProfile?.name : undefined,
              onNewChat: isDedicatedAgentApp ? handleNewChat : undefined,
              hideAgentAppRestrictedNav: isTrialAgentApp,
            }}
          />
        }
      >
        <DashboardViewPane active={currentView === "chat"}>
            <Header
              onNewChat={handleNewChat}
              agentConfig={isDedicatedAgentApp ? undefined : agentConfig}
              onAgentConfigChange={isDedicatedAgentApp ? undefined : setAgentConfig}
              onShowShortcuts={isDedicatedAgentApp ? undefined : () => setShowShortcutsDialog(true)}
              forceShowTooltip={isDedicatedAgentApp ? undefined : forceShowTooltip}
              selectedAgentProfile={activeAgentProfile}
              agentProfiles={isDedicatedAgentApp ? [] : agentProfiles}
              agentProfilesLoaded={agentProfilesLoaded}
              selectedAgentProfileId={currentAgentId === "default" ? null : currentAgentId}
              onAgentProfileChange={isDedicatedAgentApp ? undefined : setSelectedAgentProfileId}
              onCreateAgent={isDedicatedAgentApp ? undefined : handleOpenCreateAgent}
              onOpenAgentSettings={isDedicatedAgentApp ? undefined : handleOpenActiveAgentSettings}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
              hideWorkspaceControls={isDedicatedAgentApp}
            />
            {pendingPaidShare ? (
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
                <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-2">
                    <div className="text-xl font-semibold text-foreground">
                      {pendingPaidShare.agent.name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {pendingPaidShare.agent.description || t.noDescriptionProvided}
                    </div>
                    <div className="rounded-lg bg-secondary px-4 py-3">
                      <div className="text-xs font-semibold text-muted-foreground">
                        付费访问
                      </div>
                      <div className="mt-1 text-2xl font-semibold text-foreground">
                        {formatCny(pendingPaidShare.priceCents)}
                      </div>
                      {pendingPaidShare.trialDurationMinutes > 0 ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {isTrialActive && trialRemainingMs !== null
                            ? `当前仍可试用 ${formatTrialRemaining(trialRemainingMs)}，购买后可永久使用。`
                            : `试用 ${formatTrialDuration(pendingPaidShare.trialDurationMinutes)} 已结束或不可用，购买后可导入并长期使用。`}
                        </div>
                      ) : null}
                    </div>
                    {!purchaseOrder ? (
                      <Button
                        type="button"
                        onClick={handlePurchaseSharedAgent}
                        disabled={purchaseStatus === "creating"}
                        className="w-full"
                      >
                        {purchaseStatus === "creating" ? "创建订单中..." : "微信支付购买"}
                      </Button>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        {purchaseOrder.codeUrl ? (
                          <WechatPayQrCode value={purchaseOrder.codeUrl} />
                        ) : null}
                        <div className="break-all text-center font-mono text-[11px] text-muted-foreground">
                          {purchaseOrder.codeUrl || purchaseOrder.outTradeNo}
                        </div>
                        <StatusNotice tone={purchaseOrder.paymentConfigured ? "info" : "warning"}>
                          {purchaseOrder.paymentConfigured
                            ? "请使用微信扫码支付，支付成功后会自动进入 Agent。"
                            : "微信支付环境变量尚未配置。订单已创建，但无法完成真实支付。"}
                        </StatusNotice>
                      </div>
                    )}
                    {purchaseStatus === "error" && (
                      <StatusNotice tone="error">
                        创建支付订单失败，请稍后重试。
                      </StatusNotice>
                    )}
                    {isTrialActive ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleReturnToTrialSharedAgent}
                        className="w-full"
                      >
                        返回试用
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {isTrialActive && trialRemainingMs !== null ? (
                  <div className="flex shrink-0 flex-col gap-3 border-y border-border bg-secondary/45 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">
                        试用中，剩余 {formatTrialRemaining(trialRemainingMs)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        购买后可永久使用，试用期间不可修改或浏览配置文件。
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handlePurchaseSharedAgent}
                      disabled={purchaseStatus === "creating"}
                      className="w-full sm:w-auto"
                    >
                      {purchaseStatus === "creating" ? "创建订单中..." : "购买"}
                    </Button>
                  </div>
                ) : null}
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
                  onAgentProfilesChanged={refreshAgentProfiles}
                  isNewThread={activeThreadId ? newThreads.has(activeThreadId) : false}
                  initialMessage={initialPrompt}
                  autoSend={!!initialPrompt}
                  onInitialMessageSent={() => setInitialPrompt(null)}
                  conversationSource={isDedicatedAgentApp ? "agent_app" : "main"}
                />
              </div>
            )}
        </DashboardViewPane>

        {currentView === "settings" ? (
          <UserSettingsPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            voiceprints={userVoiceprints}
            onVoiceprintsChange={setUserVoiceprints}
            onClearAllConversations={handleClearAllConversations}
            conversationCount={threads.length}
          />
        ) : currentView === "user-manual" && !isTrialAgentApp ? (
          <UserManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : currentView === "developer-manual" && !isTrialAgentApp ? (
          <DeveloperManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : currentView === "traces" && capabilities.langfuseTracing && !isTrialAgentApp ? (
          <TraceBrowserPage
            onBackToChat={() => setCurrentView("chat")}
          />
        ) : currentView !== "chat" && !isTrialAgentApp && (!isDedicatedAgentApp || isConfigView) ? (
          <DashboardViewPane>
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
              listAgentShareLinks={listAgentShareLinks}
              updateAgentShareLink={updateAgentShareLink}
              deleteAgentShareLink={deleteAgentShareLink}
              userVoiceprints={userVoiceprints}
              onNavigateToUserSettings={() => setCurrentView("settings")}
              deleteAgentProfile={deleteAgentProfile}
              editAgentIdOnOpen={editAgentIdParam}
              onEditAgentChange={setEditAgentIdParam}
              createOnOpen={createParam === "1"}
              onCreateChange={(creating) => setCreateParam(creating ? "1" : null)}
              scopedAgentProfileId={isDedicatedAgentApp ? currentAgentId : null}
            />
          </DashboardViewPane>
        ) : null}
      </DashboardWorkspace>
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
