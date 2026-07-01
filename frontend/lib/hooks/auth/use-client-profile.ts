import { useState, useEffect, useCallback, useRef } from "react"
import type { ClientProfile } from "../threads"
import {
  createClientProfile,
  resolveClientProfile,
} from "@/lib/config/client-config"
import { backendFetch } from "@/lib/api/backend-fetch"
import { generateUUID } from "@/lib/utils"

// ============================================================================
// Types
// ============================================================================

interface UseClientProfileReturn {
  clientProfile: ClientProfile
  hasLoaded: boolean
  updateClientProfile: (updates: Partial<ClientProfile>) => void
  resetClientProfile: () => void
}

// Helper to get or generate client UUID locally (safe as it's only a token, like cookie)
function getOrGenerateClientId(): string {
  if (typeof window === "undefined") return "ssr-dummy-client"
  let id = window.localStorage.getItem("client-identity-raw-uuid")
  if (!id) {
    id = generateUUID()
    window.localStorage.setItem("client-identity-raw-uuid", id)
  }
  return id
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useClientProfile(): UseClientProfileReturn {
  const initialRef = useRef<ClientProfile | null>(null)
  
  const [clientProfile, setClientProfile] = useState<ClientProfile>(() => {
    const clientId = getOrGenerateClientId()
    const created = createClientProfile()
    created.id = clientId // Ensure persistent browser client ID
    initialRef.current = created
    return created
  })
  
  const [hasLoaded, setHasLoaded] = useState(false)

  // 1. Fetch profile from PostgreSQL via FastAPI on mount
  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    const clientId = getOrGenerateClientId()

    async function loadIdentity() {
      try {
        const resp = await backendFetch(`/api/client-profiles/${clientId}`, { anonymous: true })
        if (resp.ok) {
          const data = await resp.json()
          if (data) {
            setClientProfile(resolveClientProfile(data))
            setHasLoaded(true)
            return
          }
        }
      } catch (err) {
        console.error("Failed to load client identity from backend, falling back", err)
      }

      // No profile found in backend, upload the initial template
      if (initialRef.current) {
        try {
          await backendFetch("/api/client-profiles", {
            method: "POST",
            anonymous: true,
            json: initialRef.current,
          })
        } catch (err) {
          console.error("Failed to persist initial identity to backend", err)
        }
      }
      setHasLoaded(true)
    }

    loadIdentity()
  }, [])

  // 2. Persist profile changes asynchronously to database
  const persistToBackend = useCallback(async (profile: ClientProfile) => {
    try {
      await backendFetch("/api/client-profiles", {
        method: "POST",
        anonymous: true,
        json: profile,
      })
    } catch (err) {
      console.error("Failed to sync identity to PostgreSQL", err)
    }
  }, [])

  const updateClientProfile = useCallback(
    (updates: Partial<ClientProfile>) => {
      setClientProfile((prev) => {
        const merged = resolveClientProfile({ ...prev, ...updates })
        persistToBackend(merged)
        return merged
      })
    },
    [persistToBackend]
  )

  const resetClientProfile = useCallback(() => {
    const clientId = getOrGenerateClientId()
    const fresh = createClientProfile()
    fresh.id = clientId // Retain same browser token
    setClientProfile(fresh)
    persistToBackend(fresh)
  }, [persistToBackend])

  return {
    clientProfile,
    hasLoaded,
    updateClientProfile,
    resetClientProfile,
  }
}
