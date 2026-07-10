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
import { PlatformFooter } from "@/components/layout/platform-footer"
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer"
import { PlatformPricing } from "@/components/marketing/platform-pricing"
import { ManagementDashboard } from "@/components/layout/management-dashboard"
import type { ConfigBundleImportResult } from "@/components/layout/management-dashboard/config-bundle-dialog"
import { UserSettingsPage } from "@/components/layout/user-settings-page"
import { UserManualPage } from "@/components/layout/user-manual-page"
import { DeveloperManualPage } from "@/components/layout/developer-manual-page"
import { TraceBrowserPage } from "@/components/layout/trace-browser-page"
import {
  AgentShareCheckout,
  formatTrialRemaining,
  type PurchaseStatus,
} from "@/components/payments/agent-share-checkout"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import type { AgentShareSubscriptionPlan } from "@/lib/types/agent-profiles"
import { useT } from "@/lib/i18n"
import { STORAGE_KEYS } from "@/lib/constants/features"
import { backendFetch } from "@/lib/api/backend-fetch"

const DASHBOARD_VIEWS = ["chat", "pricing", "skills", "agents", "knowledge", "forms", "mcp", "settings", "user-manual", "developer-manual", "traces"] as const
type DashboardView = (typeof DASHBOARD_VIEWS)[number]

function isDashboardView(value: string | null): value is DashboardView {
  return DASHBOARD_VIEWS.includes(value as DashboardView)
}

function AuthRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/login")
  }, [router])

  return <DashboardFallback />
}

const AGENT_SHARE_RESOLVE_TIMEOUT_MS = 20_000

function withAgentShareTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out`))
    }, AGENT_SHARE_RESOLVE_TIMEOUT_MS)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
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
    payShareOrder,
    fetchPaymentOrder,
    refreshProfiles: refreshAgentProfiles,
  } = useAgentProfiles()
  const [sharedAgentProfile, setSharedAgentProfile] = useState<import("@/lib/types/agent-profiles").AgentProfile | null>(null)
  const [pendingPaidShare, setPendingPaidShare] = useState<import("@/lib/types/agent-profiles").AgentSharePreview | null>(null)
  const [trialPaidShare, setTrialPaidShare] = useState<import("@/lib/types/agent-profiles").AgentSharePreview | null>(null)
  const [trialShareAccess, setTrialShareAccess] = useState<import("@/lib/types/agent-profiles").AgentShareAccess | null>(null)
  const [trialShareToken, setTrialShareToken] = useState<string | null>(null)
  const [trialNow, setTrialNow] = useState(() => Date.now())
  const [purchaseOrder, setPurchaseOrder] = useState<import("@/lib/types/agent-profiles").AgentSharePurchase | null>(null)
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseStatus>("idle")
  const [selectedSharePlanId, setSelectedSharePlanId] = useState<string | null>(null)
  const [agentShareResolutionFailed, setAgentShareResolutionFailed] = useState(false)
  const [agentShareResolving, setAgentShareResolving] = useState(false)
  const processedAgentShareRef = useRef<string | null>(null)
  const agentShareRequestRef = useRef(0)

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
  const isSharedAgentApp = isAgentAppRoute && (!!dedicatedAgentAppId || !!agentShareToken?.trim())
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
    : isAgentAppRoute && sharedAgentProfile
      ? sharedAgentProfile
    : selectedAgentProfile
  const isResolvingAgentShare = Boolean(
    isAgentAppRoute
    && agentShareToken?.trim()
    && !dedicatedAgentAppId
    && !pendingPaidShare
    && !agentShareResolutionFailed
    && (agentShareResolving || processedAgentShareRef.current !== agentShareToken.trim())
  )
  const trialExpiresAtMs = useMemo(() => {
    if (!trialShareAccess?.trialExpiresAt) return null
    const time = new Date(trialShareAccess.trialExpiresAt).getTime()
    return Number.isFinite(time) ? time : null
  }, [trialShareAccess?.trialExpiresAt])
  const trialRemainingMs = trialExpiresAtMs === null ? null : Math.max(0, trialExpiresAtMs - trialNow)
  const isTrialAgentApp = Boolean(
    isSharedAgentApp
    && activeAgentProfile
    && trialShareAccess?.requiresPurchase
    && !trialShareAccess.purchased
    && trialPaidShare
  )
  const isTrialActive = Boolean(
    isTrialAgentApp
    && trialShareAccess?.trialActive
    && trialRemainingMs !== null
    && trialRemainingMs > 0,
  )
  const purchaseShareToken = agentShareToken?.trim()
    || trialShareToken
    || pendingPaidShare?.customSlug
    || pendingPaidShare?.token
    || null

  useEffect(() => {
    if (!isTrialAgentApp || !trialExpiresAtMs) return
    setTrialNow(Date.now())
    const timer = window.setInterval(() => setTrialNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isTrialAgentApp, trialExpiresAtMs])

  useEffect(() => {
    if (!isTrialAgentApp || isTrialActive || !trialPaidShare) return
    setPendingPaidShare(trialPaidShare)
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
      ...(isSharedAgentApp
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

  useEffect(() => {
    const token = agentShareToken?.trim()
    if (!token || !user) {
      setAgentShareResolving(false)
      if (!token) {
        processedAgentShareRef.current = null
        setAgentShareResolutionFailed(false)
      }
      return
    }
    if (processedAgentShareRef.current === token) return

    const requestId = agentShareRequestRef.current + 1
    agentShareRequestRef.current = requestId
    const isCurrentRequest = () => agentShareRequestRef.current === requestId && processedAgentShareRef.current === token
    processedAgentShareRef.current = token
    setAgentShareResolving(true)
    setAgentShareResolutionFailed(false)
    withAgentShareTimeout(Promise.all([
      fetchAgentSharePreview(token),
      fetchShareAccess(token),
    ]), "Agent share resolution")
      .then(async ([preview, access]) => {
        if (!isCurrentRequest()) return
        if (!preview || !access) {
          processedAgentShareRef.current = null
          setAgentShareResolutionFailed(true)
          return
        }
        setTrialShareAccess(null)
        setTrialPaidShare(null)
        setTrialShareToken(null)
        if (access.requiresPurchase && !access.purchased && access.trialActive) {
          const imported = await withAgentShareTimeout(importAgentShareLink(token), "Agent share import")
          if (!isCurrentRequest()) return
          if (!imported) {
            console.error("Failed to copy trial shared agent into user configuration")
            processedAgentShareRef.current = null
            setAgentShareResolutionFailed(true)
            return
          }
          setSharedAgentProfile(imported.agent)
          setTrialShareAccess(access)
          setTrialPaidShare(preview)
          setTrialShareToken(token)
          setSelectedSharePlanId(preview.subscriptionPlans?.[0]?.id || null)
          setPendingPaidShare(null)
          setPurchaseOrder(null)
          setPurchaseStatus("idle")
          setSelectedAgentProfileId(imported.agent.id)
          const url = new URL(window.location.href)
          url.pathname = "/agentapp/"
          url.searchParams.set("agentApp", imported.agent.id)
          url.searchParams.set("agentShare", token)
          url.searchParams.delete("threadId")
          url.searchParams.delete("q")
          url.searchParams.delete("view")
          url.searchParams.delete("editAgent")
          url.searchParams.delete("create")
          router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false })
          setCurrentView("chat")
          return
        }
        if (access.requiresPurchase && !access.purchased) {
          setSharedAgentProfile(null)
          setPendingPaidShare(preview)
          setTrialShareToken(null)
          setSelectedSharePlanId(preview.subscriptionPlans?.[0]?.id || null)
          setPurchaseOrder(null)
          setPurchaseStatus("idle")
          setCurrentView("chat")
          return
        }
        const imported = await withAgentShareTimeout(importAgentShareLink(token), "Agent share import")
        if (!isCurrentRequest()) return
        if (!imported) {
          processedAgentShareRef.current = null
          setAgentShareResolutionFailed(true)
          return
        }
        setSharedAgentProfile(imported.agent)
        setTrialShareAccess(null)
        setTrialPaidShare(null)
        setTrialShareToken(null)
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
        if (!isCurrentRequest()) return
        processedAgentShareRef.current = null
        setAgentShareResolutionFailed(true)
        console.error("Failed to import shared agent from URL parameter", err)
      })
      .finally(() => {
        if (isCurrentRequest()) {
          setAgentShareResolving(false)
        }
      })
  }, [agentShareToken, fetchShareAccess, fetchAgentSharePreview, importAgentShareLink, router, setAgentAppParam, setCurrentView, setSelectedAgentProfileId, user])

  const completePaidShareImport = useCallback(async () => {
    const token = purchaseShareToken
    if (!token) return
    const imported = await importAgentShareLink(token)
    if (!imported) return
    setPendingPaidShare(null)
    setTrialPaidShare(null)
    setTrialShareAccess(null)
    setTrialShareToken(null)
    setSharedAgentProfile(imported.agent)
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
  }, [importAgentShareLink, purchaseShareToken, router, setSelectedAgentProfileId])

  const handleConfirmSharedAgentOrder = useCallback(async () => {
    const token = purchaseShareToken
    if (!token || purchaseStatus === "creating") return
    setPurchaseStatus("creating")
    const order = await purchaseShare(token, selectedSharePlanId)
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
    setPurchaseStatus("confirmed")
  }, [completePaidShareImport, purchaseShare, purchaseShareToken, purchaseStatus, selectedSharePlanId, trialPaidShare])

  const handlePaySharedAgentOrder = useCallback(async () => {
    if (!purchaseOrder || purchaseStatus === "paying") return
    setPurchaseStatus("paying")
    const paidOrder = await payShareOrder(purchaseOrder.orderId)
    if (!paidOrder) {
      setPurchaseStatus("error")
      return
    }
    setPurchaseOrder(paidOrder)
    if (paidOrder.status === "paid" && paidOrder.paymentProvider === "local_dev_direct") {
      setPurchaseStatus("paid")
      return
    }
    if (paidOrder.status === "paid") {
      await completePaidShareImport()
      return
    }
    setPurchaseStatus(paidOrder.codeUrl ? "waiting" : "error")
  }, [completePaidShareImport, payShareOrder, purchaseOrder, purchaseStatus])

  const handleChangeSharedAgentPlan = useCallback(() => {
    setPurchaseOrder(null)
    setPurchaseStatus("idle")
  }, [])

  const handleReturnToTrialSharedAgent = useCallback(() => {
    if (!isTrialActive) return
    setPendingPaidShare(null)
    setPurchaseOrder(null)
    setPurchaseStatus("idle")
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

  const handleConfigBundleImported = useCallback(async (results: ConfigBundleImportResult[]) => {
    await refreshAgentProfiles()
    const importedAgentId = results.flatMap(result => result.resources.agents || [])[0]
    if (!importedAgentId) return

    setSelectedAgentProfileId(importedAgentId)
    setEditAgentIdParam(null)
    setCreateParam(null)
    setCurrentView("agents")

    if (isAgentAppRoute) {
      setAgentAppParam(importedAgentId)
      setThreadId(null)
      setInitialPrompt(null)
    }
  }, [
    isAgentAppRoute,
    refreshAgentProfiles,
    setAgentAppParam,
    setCreateParam,
    setCurrentView,
    setEditAgentIdParam,
    setInitialPrompt,
    setSelectedAgentProfileId,
    setThreadId,
  ])

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

  const selectedSubscriptionPlan: AgentShareSubscriptionPlan | null = pendingPaidShare?.pricingMode === "subscription"
    ? pendingPaidShare.subscriptionPlans?.find((plan) => plan.id === selectedSharePlanId) || pendingPaidShare.subscriptionPlans?.[0] || null
    : null

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
        className={isSharedAgentApp ? "text-foreground" : undefined}
        footer={currentView === "pricing" && isAgentAppRoute ? undefined : <SiteComplianceFooter className="border-t border-border/60 bg-background py-2" />}
        sidebar={!isSharedAgentApp ? (
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
        ) : activeAgentProfile ? (
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
              variant: isSharedAgentApp ? "agentApp" : "default",
              agentName: isSharedAgentApp ? activeAgentProfile?.name : undefined,
              onNewChat: isSharedAgentApp ? handleNewChat : undefined,
            }}
          />
        }
      >
        <DashboardViewPane active={currentView === "chat"}>
            <Header
              onNewChat={handleNewChat}
              agentConfig={isSharedAgentApp ? undefined : agentConfig}
              onAgentConfigChange={isSharedAgentApp ? undefined : setAgentConfig}
              onShowShortcuts={isSharedAgentApp ? undefined : () => setShowShortcutsDialog(true)}
              forceShowTooltip={isSharedAgentApp ? undefined : forceShowTooltip}
              selectedAgentProfile={activeAgentProfile}
              agentProfiles={isSharedAgentApp ? [] : agentProfiles}
              agentProfilesLoaded={agentProfilesLoaded}
              selectedAgentProfileId={currentAgentId === "default" ? null : currentAgentId}
              onAgentProfileChange={isSharedAgentApp ? undefined : setSelectedAgentProfileId}
              onCreateAgent={isSharedAgentApp ? undefined : handleOpenCreateAgent}
              onOpenAgentSettings={isSharedAgentApp ? undefined : handleOpenActiveAgentSettings}
              onOpenSidebar={() => setIsMobileSidebarOpen(true)}
              hideWorkspaceControls={isSharedAgentApp}
              onShowPricing={isAgentAppRoute ? () => setCurrentView("pricing") : undefined}
            />
            {pendingPaidShare ? (
              <ScrollArea
                className="min-h-0 flex-1 bg-background"
                contentClassName="flex min-h-full items-center justify-center p-4 sm:p-6"
              >
                <AgentShareCheckout
                  share={pendingPaidShare}
                  selectedPlan={selectedSubscriptionPlan}
                  selectedPlanId={selectedSharePlanId}
                  order={purchaseOrder}
                  status={purchaseStatus}
                  isTrialActive={isTrialActive}
                  trialRemainingMs={trialRemainingMs}
                  onSelectPlan={(planId) => {
                    setSelectedSharePlanId(planId)
                    setPurchaseOrder(null)
                    setPurchaseStatus("idle")
                  }}
                  onConfirmOrder={handleConfirmSharedAgentOrder}
                  onChangePlan={handleChangeSharedAgentPlan}
                  onPay={handlePaySharedAgentOrder}
                  onEnterAgent={completePaidShareImport}
                  onReturnToTrial={handleReturnToTrialSharedAgent}
                />
              </ScrollArea>
            ) : agentShareResolutionFailed ? (
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
                <StatusNotice tone="warning">这个 Agent 分享链接无法打开，请检查链接是否仍然有效。</StatusNotice>
              </div>
            ) : isResolvingAgentShare ? (
              <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
                <StatusNotice>正在打开分享的 Agent。</StatusNotice>
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
                        试用期间可完整体验购买后的 Agent 配置和对话能力，购买后可永久使用。
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        if (trialPaidShare) setPendingPaidShare(trialPaidShare)
                        setPurchaseOrder(null)
                        setPurchaseStatus("idle")
                      }}
                      className="w-full sm:w-auto"
                    >
                      选择方案
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
                  conversationSource={isSharedAgentApp ? "agent_app" : "main"}
                />
              </div>
            )}
        </DashboardViewPane>

        {currentView === "pricing" && isAgentAppRoute ? (
          <DashboardViewPane>
            <ScrollArea className="min-h-0 flex-1 bg-background" contentClassName="min-h-full">
              <div className="flex min-h-full flex-col">
                <PlatformPricing onStartTrial={() => {
                  window.location.assign("/agentapp/?agentShare=wsiri-sales-helper")
                }} />
                <PlatformFooter className="mt-auto" />
              </div>
            </ScrollArea>
          </DashboardViewPane>
        ) : null}

        {currentView === "settings" ? (
          <UserSettingsPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
            voiceprints={userVoiceprints}
            onVoiceprintsChange={setUserVoiceprints}
            onClearAllConversations={handleClearAllConversations}
            conversationCount={threads.length}
          />
        ) : currentView === "user-manual" ? (
          <UserManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : currentView === "developer-manual" ? (
          <DeveloperManualPage
            onBackToChat={() => setCurrentView("chat")}
            onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          />
        ) : currentView === "traces" && capabilities.langfuseTracing ? (
          <TraceBrowserPage
            onBackToChat={() => setCurrentView("chat")}
          />
        ) : currentView !== "chat" && (!isSharedAgentApp || isConfigView) ? (
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
              onConfigBundleImported={handleConfigBundleImported}
              userVoiceprints={userVoiceprints}
              onNavigateToUserSettings={() => setCurrentView("settings")}
              deleteAgentProfile={deleteAgentProfile}
              editAgentIdOnOpen={editAgentIdParam}
              onEditAgentChange={setEditAgentIdParam}
              createOnOpen={createParam === "1"}
              onCreateChange={(creating) => setCreateParam(creating ? "1" : null)}
              scopedAgentProfileId={isSharedAgentApp ? currentAgentId : null}
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
