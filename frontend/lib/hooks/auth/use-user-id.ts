/**
 * User ID Management Hook
 *
 * Public Chat LangChain uses an anonymous browser UUID persisted in localStorage,
 * or the active logged-in user ID from the AuthProvider.
 */

'use client'

import { useAuth } from '@/components/providers/auth-provider'

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Get user ID for thread management.
 *
 * Returns either the logged-in user's ID or a browser UUID used to filter threads on the LangGraph backend.
 *
 * @returns The user's unique ID, or null while loading
 *
 * @example
 * const userId = useUserId()
 * if (!userId) return <div>Loading...</div>
 * return <ChatInterface userId={userId} />
 */
export function useUserId(): string | null {
  const { userId } = useAuth()
  return userId
}
