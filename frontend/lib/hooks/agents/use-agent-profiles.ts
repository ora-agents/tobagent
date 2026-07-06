import { useState, useCallback, useEffect, useMemo } from "react"
import type {
  AgentProfile,
  AgentShareAccess,
  AgentSharePurchase,
  AgentConfigTomlImportResponse,
  AgentProfileVersion,
  AgentShareImportResponse,
  AgentShareLink,
  AgentShareOptions,
  AgentSharePreview,
} from "@/lib/types/agent-profiles"
import { SELECTED_AGENT_PROFILE_KEY } from "@/lib/types/agent-profiles"
import { backendFetch } from "@/lib/api/backend-fetch"
import { generateUUID } from "@/lib/utils"
import { useAuth } from "@/components/providers/auth-provider"

function loadSelectedId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(SELECTED_AGENT_PROFILE_KEY)
}

function saveSelectedId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(SELECTED_AGENT_PROFILE_KEY, id)
    } else {
      localStorage.removeItem(SELECTED_AGENT_PROFILE_KEY)
    }
  } catch { /* noop */ }
}

export function useAgentProfiles() {
  const { user, workspaceHeaders, authHeaders, activeWorkspaceId, canManageWorkspace } = useAuth()
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)

  const refreshProfiles = useCallback(async () => {
    if (!user) {
      setProfiles([])
      setSelectedIdState(null)
      setProfilesLoaded(true)
      return
    }

    setProfilesLoaded(false)
    try {
      const resp = await backendFetch("/api/agent-profiles", {
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        const data = await resp.json()
        setProfiles(data)
      }
    } catch (err) {
      console.error("Failed to load agent profiles from PostgreSQL", err)
    } finally {
      setProfilesLoaded(true)
    }
  }, [authHeaders, user, workspaceHeaders])

  // 1. Fetch all profiles from PostgreSQL on mount
  useEffect(() => {
    setSelectedIdState(loadSelectedId())
    setMounted(true)
    void refreshProfiles()
  }, [activeWorkspaceId, refreshProfiles])

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !profile.isHidden),
    [profiles]
  )

  useEffect(() => {
    if (!profilesLoaded) return

    if (visibleProfiles.length === 0) {
      if (selectedId) {
        setSelectedIdState(null)
        saveSelectedId(null)
      }
      return
    }

    if (selectedId && visibleProfiles.some(p => p.id === selectedId)) return

    const defaultId = visibleProfiles[0].id
    setSelectedIdState(defaultId)
    saveSelectedId(defaultId)
  }, [profilesLoaded, visibleProfiles, selectedId])

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    saveSelectedId(id)
  }, [])

  const createProfile = useCallback(async (
    data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">
  ): Promise<AgentProfile | null> => {
    if (!user || !canManageWorkspace) return null
    const now = new Date().toISOString()
    const newProfile: AgentProfile = {
      ...data,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    }

    try {
      const resp = await backendFetch("/api/agent-profiles", {
        method: "POST",
        authHeaders,
        workspaceHeaders,
        json: newProfile,
      })
      if (resp.ok) {
        const saved = await resp.json()
        setProfiles(prev => [...prev, saved])
        return saved
      }
    } catch (err) {
      console.error("Failed to persist new agent profile to PostgreSQL", err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders, canManageWorkspace])

  const updateProfile = useCallback(async (id: string, data: Partial<Omit<AgentProfile, "id" | "createdAt">>) => {
    if (!user || !canManageWorkspace) return null
    const target = profiles.find(p => p.id === id)
    if (!target) return null

    const updatedProfile: AgentProfile = {
      ...target,
      ...data,
      updatedAt: new Date().toISOString(),
    }

    try {
      const resp = await backendFetch(`/api/agent-profiles/${id}`, {
        method: "PUT",
        authHeaders,
        workspaceHeaders,
        json: updatedProfile,
      })
      if (resp.ok) {
        const saved = await resp.json()
        setProfiles(prev => prev.map(p => p.id === id ? saved : p))
        return saved as AgentProfile
      }
    } catch (err) {
      console.error(`Failed to update agent profile ${id} in PostgreSQL`, err)
    }
    return null
  }, [authHeaders, profiles, user, workspaceHeaders, canManageWorkspace])

  const fetchProfileVersions = useCallback(async (id: string): Promise<AgentProfileVersion[]> => {
    if (!user) return []

    try {
      const resp = await backendFetch(`/api/agent-profiles/${id}/versions`, {
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to load agent profile versions for ${id}`, err)
    }
    return []
  }, [authHeaders, user, workspaceHeaders])

  const restoreProfileVersion = useCallback(async (id: string, versionId: string): Promise<AgentProfile | null> => {
    if (!user || !canManageWorkspace) return null

    try {
      const resp = await backendFetch(`/api/agent-profiles/${id}/versions/${versionId}/restore`, {
        method: "POST",
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        const saved = await resp.json()
        setProfiles(prev => prev.map(p => p.id === id ? saved : p))
        return saved
      }
    } catch (err) {
      console.error(`Failed to restore agent profile ${id} version ${versionId}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders, canManageWorkspace])

  const createShareLink = useCallback(async (
    id: string,
    include: AgentShareOptions,
    options?: { customSlug?: string | null; priceCents?: number; currency?: string },
  ): Promise<AgentShareLink | null> => {
    if (!user || !canManageWorkspace) return null

    try {
      const resp = await backendFetch(`/api/agent-profiles/${id}/share`, {
        method: "POST",
        authHeaders,
        workspaceHeaders,
        json: {
          include,
          customSlug: options?.customSlug || null,
          priceCents: options?.priceCents || 0,
          currency: options?.currency || "CNY",
        },
      })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to create share link for agent profile ${id}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders, canManageWorkspace])

  const fetchShareAccess = useCallback(async (
    token: string,
  ): Promise<AgentShareAccess | null> => {
    if (!user) return null
    try {
      const resp = await backendFetch(`/api/agent-shares/${encodeURIComponent(token)}/access`, {
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to load shared agent access ${token}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders])

  const purchaseShare = useCallback(async (
    token: string,
  ): Promise<AgentSharePurchase | null> => {
    if (!user) return null
    try {
      const resp = await backendFetch(`/api/agent-shares/${encodeURIComponent(token)}/purchase`, {
        method: "POST",
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to purchase shared agent ${token}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders])

  const fetchPaymentOrder = useCallback(async (
    orderId: string,
  ): Promise<{ status: string; paidAt?: string | null } | null> => {
    if (!user) return null
    try {
      const resp = await backendFetch(`/api/payment-orders/${encodeURIComponent(orderId)}`, {
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to load payment order ${orderId}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders])

  const importShareLink = useCallback(async (
    token: string,
    name?: string,
  ): Promise<AgentShareImportResponse | null> => {
    if (!user) return null

    try {
      const resp = await backendFetch(`/api/agent-shares/${encodeURIComponent(token)}/import`, {
        method: "POST",
        authHeaders,
        workspaceHeaders,
        json: { name },
      })
      if (resp.ok) {
        const data = await resp.json()
        setProfiles(prev => {
          const exists = prev.some(profile => profile.id === data.agent.id)
          return exists
            ? prev.map(profile => profile.id === data.agent.id ? data.agent : profile)
            : [...prev, data.agent]
        })
        setSelectedIdState(data.agent.id)
        saveSelectedId(data.agent.id)
        return data
      }
    } catch (err) {
      console.error(`Failed to import shared agent ${token}`, err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders])

  const fetchSharePreview = useCallback(async (
    token: string,
  ): Promise<AgentSharePreview | null> => {
    try {
      const resp = await backendFetch(`/api/agent-shares/${encodeURIComponent(token)}`, { anonymous: true })
      if (resp.ok) {
        return await resp.json()
      }
    } catch (err) {
      console.error(`Failed to preview shared agent ${token}`, err)
    }
    return null
  }, [])

  const importTomlConfig = useCallback(async (
    toml: string,
  ): Promise<AgentConfigTomlImportResponse | null> => {
    if (!user || !canManageWorkspace) return null

    try {
      const resp = await backendFetch("/api/agent-profiles/import.toml", {
        method: "POST",
        authHeaders,
        workspaceHeaders,
        json: { toml },
      })
      if (resp.ok) {
        const data = await resp.json()
        setProfiles(prev => [...prev, ...data.agents])
        const firstAgent = data.agents[0]
        if (firstAgent) {
          setSelectedIdState(firstAgent.id)
          saveSelectedId(firstAgent.id)
        }
        return data
      }
    } catch (err) {
      console.error("Failed to import TOML agent configuration", err)
    }
    return null
  }, [authHeaders, user, workspaceHeaders, canManageWorkspace])

  const deleteProfile = useCallback(async (id: string) => {
    if (!user || !canManageWorkspace) return

    try {
      const resp = await backendFetch(`/api/agent-profiles/${id}`, {
        method: "DELETE",
        authHeaders,
        workspaceHeaders,
      })
      if (resp.ok) {
        setProfiles(prev => prev.filter(p => p.id !== id))
        if (loadSelectedId() === id) {
          saveSelectedId(null)
          setSelectedIdState(null)
        }
      }
    } catch (err) {
      console.error(`Failed to delete agent profile ${id} from PostgreSQL`, err)
    }
  }, [authHeaders, user, workspaceHeaders, canManageWorkspace])

  const selectedProfile = selectedId
    ? visibleProfiles.find(p => p.id === selectedId) ?? null
    : null

  return {
    mounted,
    profilesLoaded,
    profiles,
    selectedId,
    selectedProfile,
    setSelectedId,
    createProfile,
    updateProfile,
    deleteProfile,
    refreshProfiles,
    fetchProfileVersions,
    restoreProfileVersion,
    createShareLink,
    fetchShareAccess,
    purchaseShare,
    fetchPaymentOrder,
    fetchSharePreview,
    importShareLink,
    importTomlConfig,
  }
}
