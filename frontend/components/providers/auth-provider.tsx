'use client'

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { LANGGRAPH_API_URL } from '@/lib/constants/api'
import { useT, type Translations } from '@/lib/i18n'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface User {
  id: string
  username: string
  phone: string | null
  email: string | null
  avatarColor: string | null
  preferences: string | null
  safetyEnabled: boolean
  createdAt: string
}

export interface Workspace {
  id: string
  name: string
  ownerUserId: string
  currentUserRole: 'owner' | 'admin' | 'member'
  createdAt: string
  updatedAt: string
}

interface AuthContextType {
  user: User | null
  userId: string | null
  loading: boolean
  error: string | null
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  activeWorkspaceId: string | null
  workspaceHeaders: Record<string, string>
  canManageWorkspace: boolean
  refreshWorkspaces: () => Promise<void>
  setActiveWorkspaceId: (workspaceId: string | null) => void
  sendSmsCode: (phone: string, purpose: 'login' | 'register' | 'sensitive' | 'bind_phone' | 'reset_password') => Promise<void>
  login: (phone: string, credential: string, method?: 'password' | 'sms') => Promise<void>
  register: (username: string, phone: string, code: string, password: string) => Promise<void>
  logout: () => void
  bindPhone: (phone: string, code: string) => Promise<User>
  changePassword: (phone: string, code: string, password: string) => Promise<void>
  deleteAccount: () => Promise<void>
  clearError: () => void
  updateProfile: (data: Partial<Pick<User, 'username' | 'email' | 'preferences' | 'safetyEnabled'>>) => Promise<User>
}

// ============================================================================
// Context & Hook
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// ============================================================================
// Provider Implementation
// ============================================================================

const USER_SESSION_KEY = 'chat-langchain-auth-user'
const WORKSPACE_SESSION_KEY = 'chat-langchain-active-workspace'

function authFieldLabel(field: string | undefined, t: Translations) {
  switch (field) {
    case 'username':
      return t.username
    case 'password':
      return t.password
    case 'email':
      return t.email
    case 'phone':
      return t.phone
    case 'code':
      return t.smsCode
    default:
      return t.authErrorField
  }
}

function localizeAuthMessage(message: string, t: Translations, fallback: string) {
  const normalized = message.trim()
  const lower = normalized.toLowerCase()

  if (!normalized) {
    return fallback
  }

  if (normalized === 'Invalid username or password' || normalized === 'Invalid phone or password') {
    return t.authErrorInvalidCredentials
  }

  if (normalized === 'Invalid phone or verification code' || normalized === 'Invalid or expired verification code') {
    return t.authErrorInvalidSmsCode
  }

  if (normalized === 'Username already exists') {
    return t.authErrorUsernameExists
  }

  if (normalized === 'Phone already exists') {
    return t.authErrorPhoneExists
  }

  if (normalized === 'Phone is not registered') {
    return t.authErrorPhoneNotRegistered
  }

  if (normalized === 'Phone already bound') {
    return t.authErrorPhoneAlreadyBound
  }

  if (normalized === 'Phone is not bound') {
    return t.authErrorPhoneNotBound
  }

  if (normalized === 'Please wait before requesting another code') {
    return t.authErrorSmsTooFrequent
  }

  if (normalized === 'Authentication required' || normalized === 'User login required') {
    return t.authErrorAuthenticationRequired
  }

  if (normalized === 'Invalid user') {
    return t.authErrorInvalidUser
  }

  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return t.authErrorNetwork
  }

  return normalized
}

function localizeValidationError(item: any, t: Translations) {
  const rawMessage = String(item?.msg || item?.message || item?.detail || '').trim()
  const errorType = String(item?.type || '').trim()
  const loc = Array.isArray(item?.loc) ? item.loc : []
  const field = typeof loc.at(-1) === 'string' ? loc.at(-1) : undefined
  const label = authFieldLabel(field, t)

  if (errorType === 'missing' || rawMessage.toLowerCase() === 'field required') {
    return t.authErrorFieldRequired.replace('{field}', label)
  }

  if (errorType.includes('string_type')) {
    return t.authErrorFieldInvalid.replace('{field}', label)
  }

  return rawMessage
    ? `${label}: ${localizeAuthMessage(rawMessage, t, t.authErrorInvalidRequest)}`
    : t.authErrorInvalidRequest
}

async function getAuthErrorMessage(resp: Response, t: Translations, fallback: string) {
  try {
    const data = await resp.json()
    const detail = data?.detail ?? data?.message ?? data?.error

    if (typeof detail === 'string' && detail.trim()) {
      return localizeAuthMessage(detail, t, fallback)
    }

    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => localizeValidationError(item, t))
        .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)

      if (messages.length > 0) {
        return messages.join('\n')
      }
    }

    if (detail && typeof detail === 'object') {
      return JSON.stringify(detail)
    }
  } catch {
    // Fall through to the localized fallback when the server returns no JSON body.
  }

  return fallback
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceIdState, setActiveWorkspaceIdState] = useState<string | null>(null)

  // 1. Initialize user session from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Load registered user session if exists
    const savedUser = localStorage.getItem(USER_SESSION_KEY)
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser) as User
        setUser(parsed)
        console.info('[Auth] Restored user session:', parsed.username)
      } catch (err) {
        console.error('[Auth] Failed to parse saved user session:', err)
        localStorage.removeItem(USER_SESSION_KEY)
      }
    }

    setLoading(false)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const setActiveWorkspaceId = useCallback((workspaceId: string | null) => {
    setActiveWorkspaceIdState(workspaceId)
    if (typeof window === 'undefined') return
    if (workspaceId) {
      localStorage.setItem(WORKSPACE_SESSION_KEY, workspaceId)
    } else {
      localStorage.removeItem(WORKSPACE_SESSION_KEY)
    }
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    if (!user) {
      setWorkspaces([])
      setActiveWorkspaceIdState(null)
      return
    }
    const resp = await fetch(`${LANGGRAPH_API_URL}/api/workspaces`, {
      headers: { Authorization: `Bearer ${user.id}` },
    })
    if (!resp.ok) return
    const data = (await resp.json()) as Workspace[]
    setWorkspaces(data)
    const saved = typeof window !== 'undefined'
      ? localStorage.getItem(WORKSPACE_SESSION_KEY)
      : null
    const nextWorkspaceId =
      (saved && data.some((workspace) => workspace.id === saved) ? saved : null)
      || data[0]?.id
      || null
    setActiveWorkspaceId(nextWorkspaceId)
  }, [setActiveWorkspaceId, user])

  useEffect(() => {
    void refreshWorkspaces().catch((err) => {
      console.error('[Auth] Failed to load workspaces:', err)
    })
  }, [refreshWorkspaces])

  const sendSmsCode = useCallback(async (phone: string, purpose: 'login' | 'register' | 'sensitive' | 'bind_phone' | 'reset_password') => {
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (user) {
        headers.Authorization = `Bearer ${user.id}`
      }
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/sms-code`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, purpose }),
      })

      if (!resp.ok) {
        throw new Error(await getAuthErrorMessage(resp, t, t.smsCodeSendFailed))
      }
    } catch (err: any) {
      console.error('[Auth] SMS code error:', err)
      setError(localizeAuthMessage(err.message || '', t, t.smsCodeSendFailed))
      throw err
    }
  }, [t, user])

  // 2. Login function
  const login = useCallback(async (phone: string, credential: string, method: 'password' | 'sms' = 'password') => {
    setError(null)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(method === 'password' ? { phone, password: credential } : { phone, code: credential }),
      })

      if (!resp.ok) {
        throw new Error(await getAuthErrorMessage(resp, t, t.loginFailed))
      }

      const loggedInUser = (await resp.json()) as User
      setUser(loggedInUser)
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(loggedInUser))
      console.info('[Auth] Login successful:', loggedInUser.username)
    } catch (err: any) {
      console.error('[Auth] Login error:', err)
      setError(localizeAuthMessage(err.message || '', t, t.loginError))
      throw err
    }
  }, [t])

  // 3. Register function
  const register = useCallback(async (username: string, phone: string, code: string, password: string) => {
    setError(null)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, phone, code, password }),
      })

      if (!resp.ok) {
        throw new Error(await getAuthErrorMessage(resp, t, t.registrationFailed))
      }

      const registeredUser = (await resp.json()) as User
      setUser(registeredUser)
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(registeredUser))
      console.info('[Auth] Registration successful:', registeredUser.username)
    } catch (err: any) {
      console.error('[Auth] Registration error:', err)
      setError(localizeAuthMessage(err.message || '', t, t.registrationError))
      throw err
    }
  }, [t])

  // 4. Logout function
  const logout = useCallback(() => {
    setUser(null)
    setWorkspaces([])
    setActiveWorkspaceIdState(null)
    localStorage.removeItem(USER_SESSION_KEY)
    localStorage.removeItem(WORKSPACE_SESSION_KEY)
    console.info('[Auth] Logged out successfully')
  }, [])

  const bindPhone = useCallback(async (phone: string, code: string): Promise<User> => {
    if (!user) throw new Error(t.notLoggedIn)
    setError(null)
    const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/users/${user.id}/phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
      body: JSON.stringify({ phone, code }),
    })
    if (!resp.ok) {
      const message = await getAuthErrorMessage(resp, t, t.profileUpdateError)
      setError(message)
      throw new Error(message)
    }
    const updatedUser = (await resp.json()) as User
    setUser(updatedUser)
    localStorage.setItem(USER_SESSION_KEY, JSON.stringify(updatedUser))
    return updatedUser
  }, [user, t])

  const changePassword = useCallback(async (phone: string, code: string, password: string): Promise<void> => {
    if (!user) throw new Error(t.notLoggedIn)
    setError(null)
    const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/users/${user.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
      body: JSON.stringify({ phone, code, password }),
    })
    if (!resp.ok) {
      const message = await getAuthErrorMessage(resp, t, t.profileUpdateError)
      setError(message)
      throw new Error(message)
    }
  }, [user, t])

  const deleteAccount = useCallback(async (): Promise<void> => {
    if (!user) throw new Error(t.notLoggedIn)
    setError(null)
    const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user.id}` },
    })
    if (!resp.ok) {
      const message = await getAuthErrorMessage(resp, t, t.profileUpdateError)
      setError(message)
      throw new Error(message)
    }
    logout()
  }, [logout, user, t])

  // 5. Update profile function
  const updateProfile = useCallback(async (
    data: Partial<Pick<User, 'username' | 'email' | 'preferences' | 'safetyEnabled'>>
  ): Promise<User> => {
    if (!user) throw new Error(t.notLoggedIn)
    setLoading(true)
    setError(null)
    try {
      console.info('[Auth] Updating profile:', user.id, data)
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.id}` },
        body: JSON.stringify(data),
      })

      if (!resp.ok) {
        let detail = `${t.serverError} (${resp.status})`
        try {
          const errData = await resp.json()
          detail = errData.detail || detail
        } catch {
          // Response body is not JSON (e.g., HTML error page)
        }
        throw new Error(detail)
      }

      const updatedUser = (await resp.json()) as User
      setUser(updatedUser)
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(updatedUser))
      console.info('[Auth] Profile updated successfully:', updatedUser.username, updatedUser)
      return updatedUser
    } catch (err: any) {
      console.error('[Auth] Profile update error:', err)
      setError(err.message || t.profileUpdateError)
      throw err
    } finally {
      setLoading(false)
    }
  }, [user, t.notLoggedIn, t.profileUpdateError, t.serverError])

  // Compute final userId. Anonymous access is intentionally disabled.
  const userId = user ? user.id : null
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceIdState) ?? null,
    [activeWorkspaceIdState, workspaces],
  )
  const workspaceHeaders = useMemo(
    (): Record<string, string> => activeWorkspace ? { 'X-Workspace-ID': activeWorkspace.id } : {},
    [activeWorkspace],
  )
  const canManageWorkspace = activeWorkspace?.currentUserRole === 'owner' || activeWorkspace?.currentUserRole === 'admin'

  const contextValue: AuthContextType = {
    user,
    userId,
    loading,
    error,
    workspaces,
    activeWorkspace,
    activeWorkspaceId: activeWorkspace?.id ?? null,
    workspaceHeaders,
    canManageWorkspace,
    refreshWorkspaces,
    setActiveWorkspaceId,
    sendSmsCode,
    login,
    register,
    logout,
    bindPhone,
    changePassword,
    deleteAccount,
    clearError,
    updateProfile,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
