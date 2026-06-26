/**
 * Thread Management Hook
 *
 * Custom React hook for managing conversation threads with LangGraph backend.
 * - Fetches threads filtered by user ID
 * - Supports CRUD operations (create, read, update, delete)
 * - Implements optimistic updates for better UX
 * - Loads all persisted threads returned by the backend
 */

'use client'

import { useState, useEffect } from "react"
import { logger } from "../../utils/logger"
import { createLangGraphClient } from "../../api/langgraph-client"

// ============================================================================
// Constants
// ============================================================================

import { STORAGE_KEYS, THREAD_FETCH_LIMIT } from "../../constants/features"

// ============================================================================
// Types
// ============================================================================

/**
 * Client profile information for user identification and display.
 */
export interface ClientProfile {
  id: string
  label?: string
  avatarColor?: string
}

/**
 * Thread metadata stored with each conversation.
 * Contains user info, title, and custom fields.
 */
export interface ThreadMetadata {
  user_id: string
  title?: string
  lastMessage?: string
  client?: ClientProfile
  shared_agent_owner_user_id?: string | null
  shared_agent_viewer_user_id?: string | null
  shared_agent_token?: string | null
  [key: string]: any // Allow additional metadata fields
}

/**
 * Thread object representing a conversation.
 * Extends LangGraph's base Thread type with our metadata.
 */
export interface Thread {
  thread_id: string
  created_at: string
  updated_at: string
  metadata: ThreadMetadata
  values?: Record<string, any>
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to manage conversation threads.
 *
 * Features:
 * - Auto-loads threads when userId is available
 * - Optimistic updates for instant UI feedback
 * - Server-side storage via LangGraph
 *
 * @param userId - The current user's ID (browser-specific)
 * @returns Thread management functions and state
 */
export function useThreads(userId: string | undefined) {
  const [isLoading, setIsLoading] = useState(false)
  const [threads, setThreads] = useState<Thread[]>([])

  // Auto-load threads when user ID becomes available
  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return
    getUserThreads(userId)
  }, [userId])

  // ==========================================================================
  // Thread Fetching
  // ==========================================================================

  /**
   * Fetch all threads for a specific user from LangGraph backend.
   * 
   * @param id - User ID to fetch threads for
   * @param silent - If true, skip setting loading state (for background refetches)
   */
  const getUserThreads = async (id: string, silent = false): Promise<void> => {
    if (!silent) {
      setIsLoading(true)
    }
    try {
      const client = createLangGraphClient(id)

      logger.info('Fetching threads for user:', id)
      const userThreads = (await client.threads.search({
        metadata: {
          user_id: id,
        },
        limit: THREAD_FETCH_LIMIT,
      })) as any[] as Thread[]
      const ownedSharedThreads = (await client.threads.search({
        metadata: {
          shared_agent_owner_user_id: id,
        },
        limit: THREAD_FETCH_LIMIT,
      }).catch((error) => {
        logger.debug("Shared agent owner thread search unavailable:", error)
        return []
      })) as any[] as Thread[]

      const threadsById = new Map<string, Thread>()
      for (const thread of [...userThreads, ...ownedSharedThreads]) {
        threadsById.set(thread.thread_id, thread)
      }
      const mergedThreads = [...threadsById.values()].sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at).getTime()
        const bTime = new Date(b.updated_at || b.created_at).getTime()
        return bTime - aTime
      })

      logger.info('Fetched threads:', mergedThreads.length)

      setThreads(mergedThreads)
    } catch (error) {
      logger.error('Error fetching threads:', error)
      setThreads([])
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }

  /**
   * Get a specific thread by ID.
   *
   * @param id - Thread ID to fetch
   * @returns Thread object or null if not found
   */
  const getThreadById = async (id: string): Promise<Thread | null> => {
    try {
      const client = createLangGraphClient(userId)
      const thread = (await client.threads.get(id)) as any as Thread
      return thread
    } catch (error: any) {
      // Silently handle 404 errors (thread doesn't exist or was deleted)
      if (error?.status === 404 || error?.message?.includes('404')) {
        logger.debug(`Thread ${id} not found (404)`)
        return null
      }
      logger.error('Error fetching thread:', error)
      return null
    }
  }

  // ==========================================================================
  // Thread Updates
  // ==========================================================================

  /**
   * Update thread metadata (title, last message, etc.).
   * Uses optimistic updates for instant UI feedback.
   *
   * @param threadId - ID of thread to update
   * @param metadata - Partial metadata to merge with existing
   */
  const updateThreadMetadata = async (
    threadId: string,
    metadata: Partial<ThreadMetadata>
  ): Promise<void> => {
    try {
      // Optimistically update the UI immediately
      setThreads((prev) => {
        const existingThread = prev.find(t => t.thread_id === threadId)

        if (existingThread) {
          // Update existing thread
          return prev.map(t =>
            t.thread_id === threadId
              ? {
                  ...t,
                  updated_at: new Date().toISOString(),
                  metadata: {
                    ...t.metadata,
                    ...metadata,
                  }
                }
              : t
          )
        } else {
          // Thread doesn't exist yet, return unchanged
          return prev
        }
      })

      const client = createLangGraphClient(userId)

      // Get current thread to merge metadata
      const currentThread = await client.threads.get(threadId) as any as Thread
      const currentMetadata = (currentThread.metadata || {}) as ThreadMetadata

      // Update thread with merged metadata in background
      await client.threads.update(threadId, {
        metadata: {
          ...currentMetadata,
          ...metadata,
        },
      })

      // Don't refetch - the optimistic update already handled the UI
    } catch (error: any) {
      // Silently handle 404 errors (thread doesn't exist or was deleted)
      if (error?.status === 404 || error?.message?.includes('404')) {
        logger.debug(`Thread ${threadId} not found for metadata update (404)`)
        return
      }
      logger.error('Error updating thread metadata:', error)
      // On error, refetch to get correct state
      if (metadata.user_id) {
        await getUserThreads(metadata.user_id)
      }
    }
  }

  /**
   * Optimistically add a thread to the UI before backend confirmation.
   * Useful for instant feedback when creating new threads.
   *
   * @param thread - Thread to add to the list
   */
  const addOptimisticThread = (thread: Thread): void => {
    setThreads((prev) => {
      // Check if thread already exists
      const exists = prev.some(t => t.thread_id === thread.thread_id)
      if (exists) return prev

      // Add at the beginning
      return [thread, ...prev]
    })
  }

  // ==========================================================================
  // Thread Deletion
  // ==========================================================================

  /**
   * Delete a thread from the backend.
   * Uses optimistic updates and provides callback for current thread cleanup.
   *
   * @param id - Thread ID to delete
   * @param onDeleteCurrent - Optional callback if deleting current thread
   */
  const deleteThread = async (
    id: string,
    onDeleteCurrent?: () => void
  ): Promise<void> => {
    if (!userId) {
      throw new Error("User ID not found")
    }

    // Optimistically update UI
    setThreads((prevThreads) => {
      const newThreads = prevThreads.filter(
        (thread) => thread.thread_id !== id,
      )
      return newThreads
    })

    try {
      const client = createLangGraphClient(userId)
      await client.threads.delete(id)
      logger.info('Thread deleted:', id)

      // If callback provided (e.g., to clear current thread), invoke it
      if (onDeleteCurrent) {
        onDeleteCurrent()
      }

      // Refetch silently to ensure consistency (no loader flash since we already optimistically updated)
      await getUserThreads(userId, true)
    } catch (error: any) {
      // Silently handle 404 errors (thread already deleted)
      if (error?.status === 404 || error?.message?.includes('404')) {
        logger.debug(`Thread ${id} already deleted (404)`)
        return
      }
      logger.error('Error deleting thread:', error)
      // Revert optimistic update on error (show loader since something went wrong)
      await getUserThreads(userId)
    }
  }

  /**
   * Delete all threads owned by the current user.
   *
   * Searches by user metadata and deletes in batches so this is not limited to
   * the currently rendered sidebar list.
   */
  const deleteAllUserThreads = async (): Promise<number> => {
    if (!userId) {
      throw new Error("User ID not found")
    }

    setIsLoading(true)
    const client = createLangGraphClient(userId)
    const deletedThreadIds: string[] = []

    try {
      while (true) {
        const batch = (await client.threads.search({
          metadata: {
            user_id: userId,
          },
          limit: THREAD_FETCH_LIMIT,
          offset: 0,
        })) as any[] as Thread[]

        if (batch.length === 0) {
          break
        }

        const settledDeletes = await Promise.allSettled(
          batch.map(async (thread) => {
            await client.threads.delete(thread.thread_id)
            deletedThreadIds.push(thread.thread_id)
          }),
        )

        const failedDelete = settledDeletes.find((result) => result.status === "rejected")
        if (failedDelete?.status === "rejected") {
          throw failedDelete.reason
        }

        if (batch.length < THREAD_FETCH_LIMIT) {
          break
        }
      }

      setThreads([])

      if (typeof window !== "undefined") {
        for (const threadId of deletedThreadIds) {
          localStorage.removeItem(`${STORAGE_KEYS.DRAFT_PREFIX}${threadId}`)
        }
        localStorage.removeItem(`${STORAGE_KEYS.DRAFT_PREFIX}new`)
      }

      return deletedThreadIds.length
    } catch (error) {
      logger.error("Error deleting all threads:", error)
      await getUserThreads(userId, true)
      throw error
    } finally {
      setIsLoading(false)
    }
  }

  // ==========================================================================
  // Return API
  // ==========================================================================

  return {
    isLoading,
    threads,
    getThreadById,
    setThreads,
    getUserThreads,
    updateThreadMetadata,
    deleteThread,
    deleteAllUserThreads,
    addOptimisticThread,
  }
}
