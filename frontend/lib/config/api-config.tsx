'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  getDefaultLangGraphApiUrl,
  isTauriRuntime,
  loadStoredDesktopApiUrl,
  saveStoredDesktopApiUrl,
  setRuntimeLangGraphApiUrl,
} from '@/lib/config/api-runtime'

interface ApiConfigContextType {
  apiUrl: string
  defaultApiUrl: string
  isDesktopRuntime: boolean
  loading: boolean
  setApiUrl: (url: string) => Promise<void>
  resetApiUrl: () => Promise<void>
}

const ApiConfigContext = createContext<ApiConfigContextType | undefined>(undefined)

export function ApiConfigProvider({ children }: { children: React.ReactNode }) {
  const defaultApiUrl = useMemo(() => getDefaultLangGraphApiUrl(), [])
  const [apiUrl, setApiUrlState] = useState(defaultApiUrl)
  const [loading, setLoading] = useState(true)
  const [isDesktopRuntime, setIsDesktopRuntime] = useState(false)

  useEffect(() => {
    let cancelled = false
    const desktopRuntime = isTauriRuntime()
    setIsDesktopRuntime(desktopRuntime)

    async function loadApiUrl() {
      try {
        const storedUrl = await loadStoredDesktopApiUrl()
        const nextUrl = setRuntimeLangGraphApiUrl(storedUrl || defaultApiUrl)
        if (!cancelled) setApiUrlState(nextUrl)
      } catch (err) {
        console.warn('[API Config] Failed to load desktop backend URL; using default:', err)
        const nextUrl = setRuntimeLangGraphApiUrl(defaultApiUrl)
        if (!cancelled) setApiUrlState(nextUrl)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadApiUrl()
    return () => {
      cancelled = true
    }
  }, [defaultApiUrl])

  const setApiUrl = useCallback(async (url: string) => {
    const nextUrl = setRuntimeLangGraphApiUrl(url)
    await saveStoredDesktopApiUrl(nextUrl)
    setApiUrlState(nextUrl)
  }, [])

  const resetApiUrl = useCallback(async () => {
    await setApiUrl(defaultApiUrl)
  }, [defaultApiUrl, setApiUrl])

  const value = useMemo<ApiConfigContextType>(() => ({
    apiUrl,
    defaultApiUrl,
    isDesktopRuntime,
    loading,
    setApiUrl,
    resetApiUrl,
  }), [apiUrl, defaultApiUrl, isDesktopRuntime, loading, resetApiUrl, setApiUrl])

  return <ApiConfigContext.Provider value={value}>{children}</ApiConfigContext.Provider>
}

export function useApiConfig() {
  const context = useContext(ApiConfigContext)
  if (!context) {
    throw new Error('useApiConfig must be used within an ApiConfigProvider')
  }
  return context
}

export { normalizeLangGraphApiUrl } from '@/lib/config/api-runtime'
