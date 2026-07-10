"use client"

import { useEffect, useState } from "react"
import { Bell, Check, LoaderCircle, RefreshCw, X } from "lucide-react"

import { ChangeDetail } from "@/components/layout/management-dashboard/change-detail"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import {
  useWorkspaceNotifications,
  type WorkspaceNotification,
} from "@/lib/hooks/workspaces/use-workspace-notifications"

function notificationTitle(notification: WorkspaceNotification, zh: boolean) {
  if (notification.kind === "pending_review") {
    return zh ? "待审批修改" : "Change needs review"
  }

  if (notification.change.status === "rejected") {
    return zh ? "审批未通过" : "Change rejected"
  }

  return zh ? "审批已通过" : "Change approved"
}

function notificationDescription(notification: WorkspaceNotification, zh: boolean) {
  const workspaceName = notification.workspace.name
  const requester = notification.change.requesterUsername || notification.change.requesterUserId

  if (notification.kind === "pending_review") {
    return zh
      ? `${workspaceName} 收到 ${requester} 提交的修改申请。`
      : `${workspaceName} received a change request from ${requester}.`
  }

  return zh
    ? `${workspaceName} 中你提交的修改申请已有审批结果。`
    : `Your change request in ${workspaceName} has been reviewed.`
}

export function WorkspaceNotifications() {
  const { locale } = useI18n()
  const zh = locale === "zh"
  const { user } = useAuth()
  const {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    markAllViewed,
    reviewChange,
  } = useWorkspaceNotifications()
  const [open, setOpen] = useState(false)
  const [busyAction, setBusyAction] = useState("")

  useEffect(() => {
    if (open) {
      markAllViewed()
    }
  }, [markAllViewed, open])

  if (!user) return null

  const handleReview = async (notification: WorkspaceNotification, decision: "approve" | "reject") => {
    setBusyAction(`${decision}-${notification.change.id}`)
    try {
      await reviewChange(notification, decision)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction("")
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        className={cn(
          "relative inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary",
          unreadCount > 0 ? "min-w-14 px-2.5" : "w-9 px-0",
        )}
        title={zh ? "通知" : "Notifications"}
        aria-label={zh ? `通知，${unreadCount} 条待查看` : `Notifications, ${unreadCount} unread`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <>
            <span className="ml-1.5 text-sm font-semibold leading-none text-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" />
          </>
        )}
      </Button>

      <Drawer open={open} onOpenChange={setOpen} direction="right">
        <DrawerContent className="h-dvh w-full max-w-none border-border sm:max-w-2xl">
          <DrawerHeader className="shrink-0 border-b border-border px-5 py-4">
            <DrawerTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5 text-primary" />
              {zh ? "工作间通知" : "Workspace notifications"}
            </DrawerTitle>
            <DrawerDescription>
              {zh
                ? `${unreadCount} 条待查看，${notifications.length} 条相关通知`
                : `${unreadCount} unread, ${notifications.length} total`}
            </DrawerDescription>
          </DrawerHeader>

          {error && (
            <div className="mx-5 mt-3 shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <ScrollArea className="min-h-0 flex-1 px-5 py-4" contentClassName="pr-1">
            <div className="space-y-3">
              {notifications.map((notification) => {
                const canReview = notification.kind === "pending_review" && notification.change.status === "pending"
                return (
                  <div key={notification.id} className="rounded-lg border border-border bg-background">
                    <div className="border-b border-border/60 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {notificationTitle(notification, zh)}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {notificationDescription(notification, zh)}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded px-2 py-1 text-xs font-medium",
                            notification.kind === "pending_review" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                            notification.change.status === "rejected" && "bg-destructive/10 text-destructive",
                            notification.kind === "review_result"
                              && notification.change.status !== "rejected"
                              && "bg-green-500/15 text-green-700 dark:text-green-400",
                          )}
                        >
                          {notification.workspace.name}
                        </span>
                      </div>
                    </div>
                    <ChangeDetail
                      change={notification.change}
                      locale={locale}
                      actions={
                        canReview ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busyAction === `approve-${notification.change.id}`}
                              onClick={() => handleReview(notification, "approve")}
                            >
                              {busyAction === `approve-${notification.change.id}` ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              {zh ? "批准" : "Approve"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyAction === `reject-${notification.change.id}`}
                              onClick={() => handleReview(notification, "reject")}
                            >
                              {busyAction === `reject-${notification.change.id}` ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                              {zh ? "拒绝" : "Reject"}
                            </Button>
                          </>
                        ) : undefined
                      }
                    />
                  </div>
                )
              })}

              {notifications.length === 0 && (
                <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
                  {loading ? (zh ? "正在加载通知..." : "Loading notifications...") : (zh ? "暂无通知" : "No notifications")}
                </div>
              )}
            </div>
          </ScrollArea>

          <DrawerFooter className="shrink-0 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {zh ? "刷新" : "Refresh"}
            </Button>
            <Button onClick={() => setOpen(false)}>
              {zh ? "关闭" : "Close"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
