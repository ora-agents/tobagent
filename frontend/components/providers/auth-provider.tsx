'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { LANGGRAPH_API_URL } from '@/lib/constants/api'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface User {
  id: string
  username: string
  email: string | null
  avatarColor: string | null
  createdAt: string
}

interface AuthContextType {
  user: User | null
  userId: string | null // Either user.id or anonymous uuid
  loading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, email?: string) => Promise<void>
  logout: () => void
  clearError: () => void
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
const ANONYMOUS_ID_KEY = 'langgraph-user-id'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [anonymousId, setAnonymousId] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // 1. Initialize user session and anonymous ID from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Load or generate anonymous ID
    let anonId = localStorage.getItem(ANONYMOUS_ID_KEY)
    if (!anonId) {
      anonId = `user-${crypto.randomUUID()}`
      localStorage.setItem(ANONYMOUS_ID_KEY, anonId)
      console.info('[Auth] Generated anonymous user ID:', anonId)
    } else {
      console.info('[Auth] Loaded existing anonymous user ID:', anonId)
    }
    setAnonymousId(anonId)

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

  // 2. Login function
  const login = useCallback(async (username: string, password: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.detail || 'Failed to login')
      }

      const loggedInUser = (await resp.json()) as User
      setUser(loggedInUser)
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(loggedInUser))
      console.info('[Auth] Login successful:', loggedInUser.username)
    } catch (err: any) {
      console.error('[Auth] Login error:', err)
      setError(err.message || 'An error occurred during login')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  // 3. Register function
  const register = useCallback(async (username: string, password: string, email?: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email }),
      })

      if (!resp.ok) {
        const data = await resp.json()
        throw new Error(data.detail || 'Registration failed')
      }

      const registeredUser = (await resp.json()) as User
      setUser(registeredUser)
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(registeredUser))
      console.info('[Auth] Registration successful:', registeredUser.username)
    } catch (err: any) {
      console.error('[Auth] Registration error:', err)
      setError(err.message || 'An error occurred during registration')
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  // 4. Logout function
  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(USER_SESSION_KEY)
    console.info('[Auth] Logged out successfully')
  }, [])

  // Compute final userId
  const userId = user ? user.id : anonymousId

  const contextValue: AuthContextType = {
    user,
    userId,
    loading,
    error,
    login,
    register,
    logout,
    clearError,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
