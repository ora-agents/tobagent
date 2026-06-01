import { useState, useCallback, useEffect } from "react"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { SELECTED_AGENT_PROFILE_KEY } from "@/lib/types/agent-profiles"
import { LANGGRAPH_API_URL } from "../../constants/api"
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
  const { user } = useAuth()
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [mounted, setMounted] = useState(false)

  // 1. Fetch all profiles from PostgreSQL on mount
  useEffect(() => {
    setSelectedIdState(loadSelectedId())
    setMounted(true)

    if (!LANGGRAPH_API_URL || !user) {
      setProfiles([])
      setSelectedIdState(null)
      setProfilesLoaded(true)
      return
    }

    const authHeaders = { Authorization: `Bearer ${user.id}` }

    async function fetchProfiles() {
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/agent-profiles`, {
          headers: authHeaders,
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
    }

    setProfilesLoaded(false)
    fetchProfiles()
  }, [user])

  useEffect(() => {
    if (!profilesLoaded) return

    if (profiles.length === 0) {
      if (selectedId) {
        setSelectedIdState(null)
        saveSelectedId(null)
      }
      return
    }

    if (selectedId && profiles.some(p => p.id === selectedId)) return

    const defaultId = profiles[0].id
    setSelectedIdState(defaultId)
    saveSelectedId(defaultId)
  }, [profilesLoaded, profiles, selectedId])

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    saveSelectedId(id)
  }, [])

  const createProfile = useCallback(async (
    data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">
  ): Promise<AgentProfile | null> => {
    if (!LANGGRAPH_API_URL || !user) return null
    const now = new Date().toISOString()
    const newProfile: AgentProfile = {
      ...data,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    }

    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/agent-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.id}` },
        body: JSON.stringify(newProfile),
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
  }, [user])

  const updateProfile = useCallback(async (id: string, data: Partial<Omit<AgentProfile, "id" | "createdAt">>) => {
    if (!LANGGRAPH_API_URL || !user) return
    const target = profiles.find(p => p.id === id)
    if (!target) return

    const updatedProfile: AgentProfile = {
      ...target,
      ...data,
      updatedAt: new Date().toISOString(),
    }

    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/agent-profiles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.id}` },
        body: JSON.stringify(updatedProfile),
      })
      if (resp.ok) {
        const saved = await resp.json()
        setProfiles(prev => prev.map(p => p.id === id ? saved : p))
      }
    } catch (err) {
      console.error(`Failed to update agent profile ${id} in PostgreSQL`, err)
    }
  }, [profiles, user])

  const deleteProfile = useCallback(async (id: string) => {
    if (!LANGGRAPH_API_URL || !user) return

    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/agent-profiles/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user.id}` },
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
  }, [user])

  const selectedProfile = selectedId
    ? profiles.find(p => p.id === selectedId) ?? null
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
  }
}
