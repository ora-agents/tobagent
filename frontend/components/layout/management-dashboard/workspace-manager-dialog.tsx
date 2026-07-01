"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, LoaderCircle, Plus, Shield, Trash2, Users, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { backendFetch } from "@/lib/api/backend-fetch"
import { useAuth, type Workspace } from "@/components/providers/auth-provider"
import { cn } from "@/lib/utils"
import { ChangeDetail } from "./change-detail"

type Locale = "zh" | "en"
type WorkspaceRole = "owner" | "admin" | "member"
type WorkspaceMember = {
  userId: string
  username: string | null
  role: WorkspaceRole
  status: string
  createdAt: string
  updatedAt: string
}
type WorkspaceChangeRequest = {
  id: string
  workspaceId: string
  requesterUserId: string
  requesterUsername: string | null
  targetType: string
  targetId: string | null
  action: string
  payload: Record<string, unknown>
  status: "pending" | "approved" | "rejected" | "applied"
  reviewerUserId: string | null
  reviewNote: string | null
  createdAt: string
  reviewedAt: string | null
}

interface WorkspaceManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: Locale
}

const roleLabels: Record<Locale, Record<WorkspaceRole, string>> = {
  zh: {
    owner: "拥有者",
    admin: "管理员",
    member: "成员",
  },
  en: {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
  },
}

function headers(_userId: string, workspaceId?: string | null) {
  return {
    ...(workspaceId ? { "X-Workspace-ID": workspaceId } : {}),
  }
}

export function WorkspaceManagerDialog({
  open,
  onOpenChange,
  locale,
}: WorkspaceManagerDialogProps) {
  const zh = locale === "zh"
  const {
    user,
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    authHeaders,
    canManageWorkspace,
    refreshWorkspaces,
    setActiveWorkspaceId,
  } = useAuth()
  const [tab, setTab] = useState<"workspaces" | "members" | "requests">("workspaces")
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [changes, setChanges] = useState<WorkspaceChangeRequest[]>([])
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const [memberUsername, setMemberUsername] = useState("")
  const [memberRole, setMemberRole] = useState<"admin" | "member">("member")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const activeRole = activeWorkspace?.currentUserRole ?? "member"
  const canAssignAdmin = activeRole === "owner"
  const sortedWorkspaces = useMemo(
    () => [...workspaces].sort((a, b) => a.name.localeCompare(b.name)),
    [workspaces],
  )

  const requestPath = activeWorkspaceId
    ? `/api/workspaces/${activeWorkspaceId}/change-requests`
    : ""

  const loadMembers = async () => {
    if (!user || !activeWorkspaceId) return
    const response = await backendFetch(`/api/workspaces/${activeWorkspaceId}/members`, {
      authHeaders,
      workspaceHeaders: headers(user.id, activeWorkspaceId),
    })
    if (!response.ok) throw new Error(await response.text())
    setMembers(await response.json())
  }

  const loadChanges = async () => {
    if (!user || !activeWorkspaceId) return
    const response = await backendFetch(requestPath, {
      authHeaders,
      workspaceHeaders: headers(user.id, activeWorkspaceId),
    })
    if (!response.ok) throw new Error(await response.text())
    setChanges(await response.json())
  }

  useEffect(() => {
    if (!open) return
    setError("")
    if (tab === "members") {
      void loadMembers().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }
    if (tab === "requests") {
      void loadChanges().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }
  }, [activeWorkspaceId, open, tab])

  const createWorkspace = async () => {
    if (!user || !newWorkspaceName.trim()) return
    setBusy("create-workspace")
    setError("")
    try {
      const response = await backendFetch("/api/workspaces", {
        method: "POST",
        authHeaders,
        workspaceHeaders: headers(user.id),
        json: { name: newWorkspaceName.trim() },
      })
      if (!response.ok) throw new Error(await response.text())
      const workspace = (await response.json()) as Workspace
      setNewWorkspaceName("")
      await refreshWorkspaces()
      setActiveWorkspaceId(workspace.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy("")
    }
  }

  const addMember = async () => {
    if (!user || !activeWorkspaceId || !memberUsername.trim()) return
    setBusy("add-member")
    setError("")
    try {
      const response = await backendFetch(`/api/workspaces/${activeWorkspaceId}/members`, {
        method: "POST",
        authHeaders,
        workspaceHeaders: headers(user.id, activeWorkspaceId),
        json: { username: memberUsername.trim(), role: memberRole },
      })
      if (!response.ok) throw new Error(await response.text())
      setMemberUsername("")
      await loadMembers()
      await refreshWorkspaces()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy("")
    }
  }

  const updateMemberRole = async (member: WorkspaceMember, role: "admin" | "member") => {
    if (!user || !activeWorkspaceId) return
    setBusy(`role-${member.userId}`)
    setError("")
    try {
      const response = activeRole === "owner"
        ? await backendFetch(`/api/workspaces/${activeWorkspaceId}/members/${member.userId}`, {
            method: "PATCH",
            authHeaders,
            workspaceHeaders: headers(user.id, activeWorkspaceId),
            json: { role },
          })
        : await backendFetch(`/api/workspaces/${activeWorkspaceId}/change-requests`, {
            method: "POST",
            authHeaders,
            workspaceHeaders: headers(user.id, activeWorkspaceId),
            json: {
              targetType: "workspace_member",
              targetId: member.userId,
              action: "update",
              payload: {
                userId: member.userId,
                username: member.username,
                name: member.username || member.userId,
                role,
                previousRole: member.role,
                previousValues: { role: member.role },
              },
            },
      })
      if (!response.ok) throw new Error(await response.text())
      await loadMembers()
      if (activeRole !== "owner") {
        setTab("requests")
        await loadChanges()
      } else if (tab === "requests") {
        await loadChanges()
      }
      await refreshWorkspaces()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy("")
    }
  }

  const removeMember = async (member: WorkspaceMember) => {
    if (!user || !activeWorkspaceId) return
    setBusy(`remove-${member.userId}`)
    setError("")
    try {
      const response = await backendFetch(`/api/workspaces/${activeWorkspaceId}/members/${member.userId}`, {
        method: "DELETE",
        authHeaders,
        workspaceHeaders: headers(user.id, activeWorkspaceId),
      })
      if (!response.ok) throw new Error(await response.text())
      await loadMembers()
      await refreshWorkspaces()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy("")
    }
  }

  const reviewChange = async (change: WorkspaceChangeRequest, decision: "approve" | "reject") => {
    if (!user || !activeWorkspaceId) return
    setBusy(`${decision}-${change.id}`)
    setError("")
    try {
      const response = await backendFetch(`${requestPath}/${change.id}/${decision}`, {
        method: "POST",
        authHeaders,
        workspaceHeaders: headers(user.id, activeWorkspaceId),
        json: { note: decision === "approve" ? "ok" : "" },
      })
      if (!response.ok) throw new Error(await response.text())
      await loadChanges()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy("")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {zh ? "工作间管理" : "Workspace management"}
          </DialogTitle>
          <DialogDescription>
            {activeWorkspace
              ? `${activeWorkspace.name} · ${roleLabels[locale][activeWorkspace.currentUserRole]}`
              : zh ? "创建或选择一个工作间" : "Create or select a workspace"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
          {[
            ["workspaces", zh ? "工作间" : "Workspaces"],
            ["members", zh ? "成员" : "Members"],
            ["requests", zh ? "审批" : "Requests"],
          ].map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant="ghost"
              onClick={() => setTab(key as typeof tab)}
              className={cn(
                "h-8 flex-1 rounded-md px-3 text-sm transition-colors",
                tab === key ? "bg-background text-foreground shadow-depth-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Button>
          ))}
        </div>

        {error && (
          <div className="shrink-0 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1" contentClassName="pr-1">
          {tab === "workspaces" && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  placeholder={zh ? "新工作间名称" : "New workspace name"}
                />
                <Button onClick={createWorkspace} disabled={busy === "create-workspace" || !newWorkspaceName.trim()}>
                  {busy === "create-workspace" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {zh ? "新建" : "Create"}
                </Button>
              </div>
              <div className="divide-y divide-border rounded-lg border border-border">
                {sortedWorkspaces.map((workspace) => (
                  <div key={workspace.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{workspace.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {roleLabels[locale][workspace.currentUserRole]}
                      </div>
                    </div>
                    <Button
                      variant={workspace.id === activeWorkspaceId ? "default" : "outline"}
                      size="sm"
                      onClick={() => setActiveWorkspaceId(workspace.id)}
                    >
                      {workspace.id === activeWorkspaceId ? (zh ? "当前" : "Active") : (zh ? "切换" : "Switch")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "members" && (
            <div className="space-y-4">
              {canManageWorkspace && (
                <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                  <Input
                    value={memberUsername}
                    onChange={(event) => setMemberUsername(event.target.value)}
                    placeholder={zh ? "用户名" : "Username"}
                  />
                  <Select
                    value={memberRole}
                    onValueChange={(value) => setMemberRole(value as "admin" | "member")}
                    disabled={!canAssignAdmin}
                  >
                    <SelectTrigger className="h-9 w-full bg-muted px-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="member">{roleLabels[locale].member}</SelectItem>
                        <SelectItem value="admin">{roleLabels[locale].admin}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button onClick={addMember} disabled={busy === "add-member" || !memberUsername.trim()}>
                    {busy === "add-member" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                    {zh ? "添加" : "Add"}
                  </Button>
                </div>
              )}
              <div className="divide-y divide-border rounded-lg border border-border">
                {members.map((member) => {
                  const canRequestRoleChange = activeRole === "member" && member.role !== "owner"
                  const locked = member.role === "owner" || (!canManageWorkspace && !canRequestRoleChange)
                  const roleSelectTitle = activeRole === "owner"
                    ? (zh ? "直接修改角色" : "Change role")
                    : (zh ? "提交角色修改审批" : "Submit role change for approval")
                  return (
                    <div key={member.userId} className="grid gap-3 p-3 sm:grid-cols-[1fr_160px_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{member.username || member.userId}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">{member.userId}</div>
                      </div>
                      <Select
                        value={member.role}
                        disabled={locked || (member.role === "admin" && activeRole !== "owner")}
                        onValueChange={(value) => updateMemberRole(member, value as "admin" | "member")}
                      >
                        <SelectTrigger className="h-9 w-full bg-muted px-3 disabled:opacity-60" title={roleSelectTitle}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="owner" disabled>{roleLabels[locale].owner}</SelectItem>
                            <SelectItem value="admin">{roleLabels[locale].admin}</SelectItem>
                            <SelectItem value="member">{roleLabels[locale].member}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={locked || busy === `remove-${member.userId}`}
                        onClick={() => removeMember(member)}
                        title={zh ? "移除成员" : "Remove member"}
                      >
                        {busy === `remove-${member.userId}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  )
                })}
                {members.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {zh ? "暂无成员" : "No members"}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "requests" && (
            <div className="space-y-2">
              {changes.map((change) => {
                const pending = change.status === "pending"
                return (
                  <ChangeDetail
                    key={change.id}
                    change={change}
                    locale={locale}
                    actions={
                      canManageWorkspace && pending ? (
                        <>
                          <Button
                            size="sm"
                            disabled={busy === `approve-${change.id}`}
                            onClick={() => reviewChange(change, "approve")}
                          >
                            {busy === `approve-${change.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {zh ? "批准" : "Approve"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `reject-${change.id}`}
                            onClick={() => reviewChange(change, "reject")}
                          >
                            <X className="h-4 w-4" />
                            {zh ? "拒绝" : "Reject"}
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                )
              })}
              {changes.length === 0 && (
                <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
                  {zh ? "暂无修改申请" : "No change requests"}
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {zh ? "关闭" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
