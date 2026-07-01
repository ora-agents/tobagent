"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useAuth, type Workspace } from "@/components/providers/auth-provider"
import { backendFetch } from "@/lib/api/backend-fetch"
import type { WorkspaceChangeRequest } from "@/components/layout/management-dashboard/change-detail"

export type WorkspaceNotificationKind = "pending_review" | "review_result"

export type WorkspaceNotification = {
  id: string
  kind: WorkspaceNotificationKind
  workspace: Workspace
  change: WorkspaceChangeRequest
}

const VIEWED_STORAGE_PREFIX = "workspace-change-notifications-viewed"
const POLL_INTERVAL_MS = 30000

function notificationId(kind: WorkspaceNotificationKind, change: WorkspaceChangeRequest) {
  if (kind === "review_result") {
    return `${kind}:${change.id}:${change.status}:${change.reviewedAt || "reviewed"}`
  }
  return `${kind}:${change.id}:${change.status}`
}

function isManager(workspace: Workspace) {
  return workspace.currentUserRole === "owner" || workspace.currentUserRole === "admin"
}

function buildNotifications(
  userId: string,
  workspaces: Workspace[],
  changesByWorkspace: Map<string, WorkspaceChangeRequest[]>,
) {
  const notifications: WorkspaceNotification[] = []

  for (const workspace of workspaces) {
    const changes = changesByWorkspace.get(workspace.id) ?? []
    for (const change of changes) {
      if (isManager(workspace) && change.status === "pending" && change.requesterUserId !== userId) {
        notifications.push({
          id: notificationId("pending_review", change),
          kind: "pending_review",
          workspace,
          change,
        })
      }

      if (
        change.requesterUserId === userId
        && change.status !== "pending"
        && (change.status === "applied" || change.status === "approved" || change.status === "rejected")
      ) {
        notifications.push({
          id: notificationId("review_result", change),
          kind: "review_result",
          workspace,
          change,
        })
      }
    }
  }

  return notifications.sort((a, b) => {
    const aTime = a.change.reviewedAt || a.change.createdAt
    const bTime = b.change.reviewedAt || b.change.createdAt
    return bTime.localeCompare(aTime)
  })
}

function readViewedIds(userId: string) {
  if (typeof window === "undefined") return new Set<string>()

  try {
    const raw = localStorage.getItem(`${VIEWED_STORAGE_PREFIX}:${userId}`)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [])
  } catch {
    return new Set<string>()
  }
}

function writeViewedIds(userId: string, viewedIds: Set<string>) {
  if (typeof window === "undefined") return

  try {
    localStorage.setItem(`${VIEWED_STORAGE_PREFIX}:${userId}`, JSON.stringify([...viewedIds].slice(-500)))
  } catch {
    // Ignore storage failures; the badge will still work for the current render.
  }
}

export function useWorkspaceNotifications() {
  const { user, workspaces, authHeaders } = useAuth()
  const [changesByWorkspace, setChangesByWorkspace] = useState<Map<string, WorkspaceChangeRequest[]>>(new Map())
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!user) {
      setViewedIds(new Set())
      return
    }
    setViewedIds(readViewedIds(user.id))
  }, [user])

  const refresh = useCallback(async () => {
    if (!user || workspaces.length === 0) {
      setChangesByWorkspace(new Map())
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)

    try {
      const results = await Promise.all(
        workspaces.map(async (workspace) => {
          const response = await backendFetch(`/api/workspaces/${workspace.id}/change-requests`, {
            authHeaders,
            workspaceHeaders: { "X-Workspace-ID": workspace.id },
            signal: controller.signal,
          })

          if (!response.ok) {
            throw new Error(await response.text())
          }

          return [workspace.id, (await response.json()) as WorkspaceChangeRequest[]] as const
        }),
      )

      setChangesByWorkspace(new Map(results))
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
      }
      setLoading(false)
    }
  }, [authHeaders, user, workspaces])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!user || workspaces.length === 0) return

    const intervalId = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [refresh, user, workspaces.length])

  useEffect(() => () => abortRef.current?.abort(), [])

  const notifications = useMemo(
    () => user ? buildNotifications(user.id, workspaces, changesByWorkspace) : [],
    [changesByWorkspace, user, workspaces],
  )
  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !viewedIds.has(notification.id)),
    [notifications, viewedIds],
  )

  const markAllViewed = useCallback(() => {
    if (!user || notifications.length === 0) return

    setViewedIds((current) => {
      const next = new Set(current)
      for (const notification of notifications) {
        next.add(notification.id)
      }
      writeViewedIds(user.id, next)
      return next
    })
  }, [notifications, user])

  const reviewChange = useCallback(async (
    notification: WorkspaceNotification,
    decision: "approve" | "reject",
  ) => {
    if (!user) return

    const response = await backendFetch(
      `/api/workspaces/${notification.workspace.id}/change-requests/${notification.change.id}/${decision}`,
      {
        method: "POST",
        authHeaders,
        workspaceHeaders: { "X-Workspace-ID": notification.workspace.id },
        json: { note: decision === "approve" ? "ok" : "" },
      },
    )

    if (!response.ok) {
      throw new Error(await response.text())
    }

    await refresh()
  }, [authHeaders, refresh, user])

  return {
    notifications,
    unreadCount: unreadNotifications.length,
    loading,
    error,
    refresh,
    markAllViewed,
    reviewChange,
  }
}
