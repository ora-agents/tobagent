"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Locale = "zh" | "en"

export type WorkspaceChangeRequest = {
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

interface ChangeDetailProps {
  change: WorkspaceChangeRequest
  locale: Locale
  /** Render approve/reject controls below the detail. */
  actions?: React.ReactNode
}

/* ------------------------------------------------------------------ */
/*  Field registry                                                     */
/* ------------------------------------------------------------------ */

type FieldType = "text" | "longtext" | "boolean" | "array" | "json"

interface FieldDef {
  key: string
  label: Record<Locale, string>
  type: FieldType
}

const AGENT_PROFILE_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
  { key: "description", label: { zh: "描述", en: "Description" }, type: "longtext" },
  { key: "systemPrompt", label: { zh: "系统提示词", en: "System prompt" }, type: "longtext" },
  { key: "model", label: { zh: "模型", en: "Model" }, type: "text" },
  { key: "enabledTools", label: { zh: "启用工具", en: "Enabled tools" }, type: "array" },
  { key: "knowledgeBaseIds", label: { zh: "知识库", en: "Knowledge bases" }, type: "array" },
  { key: "skillIds", label: { zh: "技能", en: "Skills" }, type: "array" },
  { key: "mcpIds", label: { zh: "MCP 服务", en: "MCP servers" }, type: "array" },
  { key: "agentIds", label: { zh: "子智能体", en: "Sub-agents" }, type: "array" },
  { key: "formIds", label: { zh: "表单", en: "Forms" }, type: "array" },
  { key: "formPermissions", label: { zh: "表单权限", en: "Form permissions" }, type: "json" },
  { key: "wakeWords", label: { zh: "唤醒词", en: "Wake words" }, type: "array" },
  { key: "roleTemplateId", label: { zh: "角色模板", en: "Role template" }, type: "text" },
  { key: "personaStyle", label: { zh: "人设风格", en: "Persona style" }, type: "text" },
  { key: "boundaryMode", label: { zh: "边界模式", en: "Boundary mode" }, type: "text" },
  { key: "ttsVoice", label: { zh: "语音音色", en: "TTS voice" }, type: "text" },
  { key: "isHidden", label: { zh: "隐藏", en: "Hidden" }, type: "boolean" },
  { key: "voiceInterruptionEnabled", label: { zh: "语音打断", en: "Voice interruption" }, type: "boolean" },
  { key: "speakerVerificationEnabled", label: { zh: "声纹验证", en: "Speaker verification" }, type: "boolean" },
]

const WORKSPACE_MEMBER_FIELDS: FieldDef[] = [
  { key: "role", label: { zh: "角色", en: "Role" }, type: "text" },
]

const WORKSPACE_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
]

const SKILL_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
  { key: "description", label: { zh: "描述", en: "Description" }, type: "longtext" },
  { key: "content", label: { zh: "内容", en: "Content" }, type: "longtext" },
]

const KNOWLEDGE_BASE_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
  { key: "description", label: { zh: "描述", en: "Description" }, type: "longtext" },
]

const MCP_SERVER_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
  { key: "description", label: { zh: "描述", en: "Description" }, type: "longtext" },
  { key: "url", label: { zh: "URL", en: "URL" }, type: "text" },
]

const FORM_FIELDS: FieldDef[] = [
  { key: "name", label: { zh: "名称", en: "Name" }, type: "text" },
  { key: "description", label: { zh: "描述", en: "Description" }, type: "longtext" },
  { key: "category", label: { zh: "分类", en: "Category" }, type: "text" },
  { key: "fields", label: { zh: "字段", en: "Fields" }, type: "json" },
  { key: "hooks", label: { zh: "Hooks", en: "Hooks" }, type: "json" },
]

const FORM_RECORD_FIELDS: FieldDef[] = [
  { key: "data", label: { zh: "记录数据", en: "Record data" }, type: "json" },
]

const FIELD_REGISTRY: Record<string, FieldDef[]> = {
  agent_profile: AGENT_PROFILE_FIELDS,
  workspace: WORKSPACE_FIELDS,
  workspace_member: WORKSPACE_MEMBER_FIELDS,
  skill: SKILL_FIELDS,
  knowledge_base: KNOWLEDGE_BASE_FIELDS,
  mcp_server: MCP_SERVER_FIELDS,
  form: FORM_FIELDS,
  form_record: FORM_RECORD_FIELDS,
}

/* ------------------------------------------------------------------ */
/*  Target / action labels                                             */
/* ------------------------------------------------------------------ */

const targetLabels: Record<string, Record<Locale, string>> = {
  agent_profile: { zh: "角色", en: "Agent" },
  skill: { zh: "技能", en: "Skill" },
  knowledge_base: { zh: "知识库", en: "Knowledge base" },
  mcp_server: { zh: "MCP 服务", en: "MCP server" },
  form: { zh: "表单", en: "Form" },
  form_record: { zh: "表单记录", en: "Form record" },
  workspace: { zh: "工作间", en: "Workspace" },
  workspace_member: { zh: "工作区成员", en: "Workspace member" },
}

const actionLabels: Record<string, Record<Locale, string>> = {
  create: { zh: "新建", en: "Create" },
  update: { zh: "修改", en: "Update" },
  delete: { zh: "删除", en: "Delete" },
}

const statusLabels: Record<string, Record<Locale, string>> = {
  pending: { zh: "待审批", en: "Pending" },
  approved: { zh: "已批准", en: "Approved" },
  rejected: { zh: "已拒绝", en: "Rejected" },
  applied: { zh: "已应用", en: "Applied" },
}

const roleLabels: Record<string, Record<Locale, string>> = {
  owner: { zh: "拥有者", en: "Owner" },
  admin: { zh: "管理员", en: "Admin" },
  member: { zh: "成员", en: "Member" },
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function payloadName(change: WorkspaceChangeRequest) {
  const name = change.payload?.name
  return typeof name === "string" && name.trim()
    ? name
    : change.targetId || change.id
}

function getPreviousValues(change: WorkspaceChangeRequest): Record<string, unknown> {
  const prev = change.payload?.previousValues
  if (prev && typeof prev === "object" && !Array.isArray(prev)) {
    return prev as Record<string, unknown>
  }
  // Backward compat: workspace_member changes used previousRole at top level
  if (change.targetType === "workspace_member" && change.payload?.previousRole) {
    return { role: change.payload.previousRole }
  }
  return {}
}

/** Fields to skip when rendering diff (internal/meta fields). */
const SKIP_KEYS = new Set([
  "id", "ownerUserId", "createdAt", "updatedAt", "workspaceId",
  "previousValues", "previousRole", "shareToken", "isSharedApp",
  "speakerVerificationBound", "speakerEnrolledAt", "speakerSampleText",
  "userVoiceprintId",
])

function formatValue(value: unknown, locale: Locale): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? (locale === "zh" ? "是" : "Yes") : (locale === "zh" ? "否" : "No")
  if (typeof value === "string") return value || "—"
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—"
  return JSON.stringify(value)
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function LongText({ text, locale: _locale }: { text: string; locale: Locale }) {
  const [expanded, setExpanded] = useState(false)
  const threshold = 120
  if (text.length <= threshold) {
    return <span className="whitespace-pre-wrap">{text}</span>
  }
  return (
    <span>
      <span className="whitespace-pre-wrap">{expanded ? text : `${text.slice(0, threshold)}…`}</span>
      <Button variant="unstyled"
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="ml-1 text-xs text-primary underline-offset-2 hover:underline"
      >
        {expanded ? "收起" : "展开"}
      </Button>
    </span>
  )
}

function ArrayDiff({
  oldArr,
  newArr,
  locale,
}: {
  oldArr: unknown[]
  newArr: unknown[]
  locale: Locale
}) {
  const oldSet = new Set(oldArr.map(String))
  const newSet = new Set(newArr.map(String))
  const added = newArr.filter((v) => !oldSet.has(String(v)))
  const removed = oldArr.filter((v) => !newSet.has(String(v)))
  const unchanged = newArr.filter((v) => oldSet.has(String(v)))

  if (added.length === 0 && removed.length === 0) {
    return (
      <span className="text-muted-foreground">
        {locale === "zh" ? "无变化" : "No changes"}
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {unchanged.map((v) => (
        <span key={String(v)} className="rounded bg-muted px-1.5 py-0.5 text-xs">
          {String(v)}
        </span>
      ))}
      {added.map((v) => (
        <span key={`+${String(v)}`} className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-700 dark:text-green-400">
          +{String(v)}
        </span>
      ))}
      {removed.map((v) => (
        <span key={`-${String(v)}`} className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs text-red-700 line-through dark:text-red-400">
          −{String(v)}
        </span>
      ))}
    </div>
  )
}

function DiffRow({
  field,
  oldValue,
  newValue,
  locale,
  isCreate,
}: {
  field: FieldDef
  oldValue: unknown
  newValue: unknown
  locale: Locale
  isCreate: boolean
}) {
  const hasChange = !isCreate && JSON.stringify(oldValue) !== JSON.stringify(newValue)
  if (!isCreate && !hasChange) return null

  const label = field.label[locale]

  return (
    <div className="grid gap-1 border-b border-border/50 py-2 last:border-b-0 sm:grid-cols-[120px_1fr]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-xs">
        {isCreate ? (
          <RenderValue field={field} value={newValue} locale={locale} />
        ) : field.type === "array" ? (
          <ArrayDiff
            oldArr={Array.isArray(oldValue) ? oldValue : []}
            newArr={Array.isArray(newValue) ? newValue : []}
            locale={locale}
          />
        ) : (
          <div className="space-y-1">
            <div className="flex items-start gap-1">
              <span className="shrink-0 text-red-500/70">−</span>
              <span className="text-red-700 line-through dark:text-red-400">
                <RenderValue field={field} value={oldValue} locale={locale} />
              </span>
            </div>
            <div className="flex items-start gap-1">
              <span className="shrink-0 text-green-600">+</span>
              <span className="text-green-700 dark:text-green-400">
                <RenderValue field={field} value={newValue} locale={locale} />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RenderValue({
  field,
  value,
  locale,
}: {
  field: FieldDef
  value: unknown
  locale: Locale
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }
  switch (field.type) {
    case "longtext":
      return <LongText text={String(value)} locale={locale} />
    case "boolean":
      return <span>{value ? (locale === "zh" ? "是" : "Yes") : (locale === "zh" ? "否" : "No")}</span>
    case "array": {
      const arr = Array.isArray(value) ? value : []
      if (arr.length === 0) return <span className="text-muted-foreground">—</span>
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => (
            <span key={String(v)} className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {String(v)}
            </span>
          ))}
        </div>
      )
    }
    case "json":
      return (
        <ScrollArea className="max-h-32 rounded bg-muted" scrollbars="both">
          <pre className="p-2 text-xs">
            {JSON.stringify(value, null, 2)}
          </pre>
        </ScrollArea>
      )
    default: {
      // For workspace_member role, show translated label
      if (field.key === "role" && typeof value === "string" && roleLabels[value]) {
        return <span>{roleLabels[value][locale]}</span>
      }
      return <span>{formatValue(value, locale)}</span>
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ChangeDetail({ change, locale, actions }: ChangeDetailProps) {
  const [expanded, setExpanded] = useState(false)
  const zh = locale === "zh"

  const targetLabel = targetLabels[change.targetType]?.[locale] || change.targetType
  const actionLabel = actionLabels[change.action]?.[locale] || change.action
  const statusLabel = statusLabels[change.status]?.[locale] || change.status
  const name = payloadName(change)
  const previousValues = getPreviousValues(change)
  const isCreate = change.action === "create"
  const isDelete = change.action === "delete"

  const fields = FIELD_REGISTRY[change.targetType] ?? []
  const payload = change.payload ?? {}
  const hasPreviousValues = Object.keys(previousValues).length > 0
  const renderAsCreate = (isCreate && !hasPreviousValues) || isDelete

  // Collect changed field keys for the summary badge
  const changedCount = fields.filter((f) => {
    if (renderAsCreate) return true
    const oldVal = previousValues[f.key]
    const newVal = payload[f.key]
    return JSON.stringify(oldVal) !== JSON.stringify(newVal)
  }).length

  // Also count any payload keys not in the registry (for unknown target types)
  const extraKeys = fields.length === 0
    ? Object.keys(payload).filter((k) => !SKIP_KEYS.has(k))
    : []

  return (
    <div className="rounded-lg border border-border">
      {/* Header — always visible, click to expand */}
      <Button variant="unstyled"
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {targetLabel}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{actionLabel}</span>
            <span className="truncate text-sm font-medium">{name}</span>
            {!renderAsCreate && changedCount > 0 && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                {changedCount} {zh ? "项变更" : changedCount === 1 ? "change" : "changes"}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(zh ? "提交人" : "Requester")}: {change.requesterUsername || change.requesterUserId}
            {" · "}
            <span className={cn(
              change.status === "pending" && "text-amber-600 dark:text-amber-400",
              change.status === "approved" && "text-green-600 dark:text-green-400",
              change.status === "rejected" && "text-red-600 dark:text-red-400",
              change.status === "applied" && "text-blue-600 dark:text-blue-400",
            )}>
              {statusLabel}
            </span>
          </div>
        </div>
      </Button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-3 pb-3">
          {fields.length > 0 ? (
            <div className="divide-y divide-transparent">
              {fields.map((field) => {
                const newVal = payload[field.key]
                const oldVal = previousValues[field.key]
                return (
                  <DiffRow
                    key={field.key}
                    field={field}
                    oldValue={oldVal}
                    newValue={newVal}
                    locale={locale}
                    isCreate={renderAsCreate}
                  />
                )
              })}
            </div>
          ) : extraKeys.length > 0 ? (
            /* Fallback for unknown target types */
            <div className="divide-y divide-transparent">
              {extraKeys.map((key) => (
                <div key={key} className="grid gap-1 border-b border-border/50 py-2 last:border-b-0 sm:grid-cols-[120px_1fr]">
                  <div className="text-xs font-medium text-muted-foreground">{key}</div>
                  <div className="min-w-0 text-xs">
                    <RenderValue
                      field={{ key, label: { zh: key, en: key }, type: typeof payload[key] === "object" ? "json" : "text" }}
                      value={payload[key]}
                      locale={locale}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {zh ? "无详细信息" : "No details available"}
            </div>
          )}

          {/* Actions slot */}
          {actions && <div className="mt-3 flex gap-2 pt-2 border-t border-border">{actions}</div>}
        </div>
      )}
    </div>
  )
}
