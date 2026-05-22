"use client"

import { useState, useCallback, useEffect } from "react"
import type { AgentProfile, BuiltinToolId } from "@/lib/types/agent-profiles"
import { AGENT_PROFILES_STORAGE_KEY, SELECTED_AGENT_PROFILE_KEY } from "@/lib/types/agent-profiles"

function loadProfiles(): AgentProfile[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(AGENT_PROFILES_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveProfiles(profiles: AgentProfile[]) {
  try {
    localStorage.setItem(AGENT_PROFILES_STORAGE_KEY, JSON.stringify(profiles))
  } catch { /* noop */ }
}

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
  const [profiles, setProfilesState] = useState<AgentProfile[]>([])
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    setProfilesState(loadProfiles())
    setSelectedIdState(loadSelectedId())
    setMounted(true)
  }, [])

  const setProfiles = useCallback((next: AgentProfile[]) => {
    setProfilesState(next)
    saveProfiles(next)
  }, [])

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    saveSelectedId(id)
  }, [])

  const createProfile = useCallback((
    data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">
  ): AgentProfile => {
    const now = new Date().toISOString()
    const profile: AgentProfile = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    setProfiles([...loadProfiles(), profile])
    return profile
  }, [setProfiles])

  const updateProfile = useCallback((id: string, data: Partial<Omit<AgentProfile, "id" | "createdAt">>) => {
    const current = loadProfiles()
    const updated = current.map(p =>
      p.id === id ? { ...p, ...data, updatedAt: new Date().toISOString() } : p
    )
    setProfiles(updated)
  }, [setProfiles])

  const deleteProfile = useCallback((id: string) => {
    const current = loadProfiles()
    setProfiles(current.filter(p => p.id !== id))
    if (loadSelectedId() === id) {
      saveSelectedId(null)
      setSelectedIdState(null)
    }
  }, [setProfiles])

  const selectedProfile = profiles.find(p => p.id === selectedId) ?? null

  return {
    mounted,
    profiles,
    selectedId,
    selectedProfile,
    setSelectedId,
    createProfile,
    updateProfile,
    deleteProfile,
  }
}
