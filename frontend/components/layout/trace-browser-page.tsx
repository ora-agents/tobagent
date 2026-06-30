"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ElementType } from "react"
import {
  AlertCircle,
  Bot,
  Clock3,
  Code2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { ListItem } from "@/components/ui/list-item"
import { ListPanel } from "@/components/ui/list-panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"
import {
  fetchTraceDetail,
  fetchTraces,
  type LangfuseObservation,
  type LangfuseTrace,
  type TraceDetailResponse,
  type TraceSource,
} from "@/lib/api/traces"
import { cn } from "@/lib/utils"

interface TraceBrowserPageProps {
  onBackToChat: () => void
}

const SOURCE_OPTIONS: { value: TraceSource; zh: string; en: string; icon: ElementType }[] = [
  { value: "all", zh: "全部", en: "All", icon: Sparkles },
  { value: "main", zh: "主界面", en: "Main", icon: UserRound },
  { value: "agent_app", zh: "Agent App", en: "Agent App", icon: Bot },
  { value: "api_key", zh: "API Key", en: "API Key", icon: KeyRound },
]

function toLocalInputValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function defaultFromDate() {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return toLocalInputValue(date)
}

function inputDateToIso(value: string) {
  return value ? new Date(value).toISOString() : undefined
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatDuration(seconds?: number | null) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "-"
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
}

function formatCost(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-"
  if (value === 0) return "$0"
  return `$${value < 0.01 ? value.toFixed(5) : value.toFixed(4)}`
}

function stringify(value: unknown, maxLength?: number) {
  if (value === null || value === undefined || value === "") return "-"
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  if (!maxLength || text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}...`
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return compactText(content)
  if (Array.isArray(content)) {
    return compactText(
      content
        .map((part) => {
          if (typeof part === "string") return part
          if (!part || typeof part !== "object") return ""
          const record = part as Record<string, unknown>
          return typeof record.text === "string"
            ? record.text
            : typeof record.content === "string"
              ? record.content
              : ""
        })
        .filter(Boolean)
        .join(" "),
    )
  }
  return ""
}

function roleFromMessage(message: Record<string, unknown>) {
  if (typeof message.role === "string") return message.role
  if (typeof message.type === "string") return message.type
  if (typeof message._getType === "string") return message._getType
  return ""
}

function extractMessages(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractMessages(item))
  }
  const record = value as Record<string, unknown>
  const messages = Array.isArray(record.messages) ? record.messages : Array.isArray(record.message) ? record.message : null
  if (messages) {
    return messages.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
  }
  return []
}

function traceInputSummary(value: unknown, maxLength = 160) {
  const messages = extractMessages(value)
  const userMessage = [...messages].reverse().find((message) => {
    const role = roleFromMessage(message).toLowerCase()
    return role === "user" || role === "human"
  })
  const anyMessage = [...messages].reverse().find((message) => messageContentToText(message.content))
  const messageText = userMessage
    ? messageContentToText(userMessage.content)
    : anyMessage
      ? messageContentToText(anyMessage.content)
      : ""

  let text = messageText
  if (!text && typeof value === "string") text = compactText(value)
  if (!text && value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const candidates = [record.input, record.query, record.prompt, record.text, record.content]
    const candidate = candidates.find((item) => typeof item === "string" && compactText(item).length > 0)
    if (typeof candidate === "string") text = compactText(candidate)
  }
  if (!text) text = compactText(stringify(value))
  if (text === "-") return text
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function combinedMetadata(trace: LangfuseTrace) {
  const traceMetadata = trace.metadata || {}
  const localThreadMetadata =
    traceMetadata.local_thread_metadata && typeof traceMetadata.local_thread_metadata === "object"
      ? traceMetadata.local_thread_metadata as Record<string, unknown>
      : {}
  return { ...localThreadMetadata, ...traceMetadata }
}

function sourceForTrace(trace: LangfuseTrace): TraceSource {
  const metadata = combinedMetadata(trace)
  const sourceType = String(metadata.source_type || "").toLowerCase()
  const conversationSource = String(metadata.conversation_source || "").toLowerCase()
  if (sourceType.includes("api") || metadata.created_via_api_key === true) return "api_key"
  if (
    metadata.shared_agent_owner_user_id &&
    metadata.shared_agent_viewer_user_id &&
    metadata.shared_agent_owner_user_id !== metadata.shared_agent_viewer_user_id
  ) {
    return "agent_app"
  }
  if (
    sourceType.includes("agent app") ||
    sourceType === "agent_app" ||
    conversationSource === "agent_app"
  ) {
    return "agent_app"
  }
  return "main"
}

function traceDisplayName(trace: LangfuseTrace) {
  const metadata = combinedMetadata(trace)
  const agentName = typeof metadata.agent_name === "string" ? metadata.agent_name.trim() : ""
  const threadTitle = typeof metadata.title === "string" ? metadata.title.trim() : ""
  const inputTitle = traceInputSummary(trace.input, 48)
  const traceName = typeof trace.name === "string" ? trace.name.trim() : ""
  if (agentName) return agentName
  if (threadTitle) return threadTitle
  if (inputTitle && inputTitle !== "-") return inputTitle
  if (traceName && !["generic_agent", "generic-agent"].includes(traceName)) return traceName
  return trace.id
}

function sourceLabel(source: TraceSource, locale: "zh" | "en") {
  const option = SOURCE_OPTIONS.find((item) => item.value === source)
  return locale === "zh" ? option?.zh || source : option?.en || source
}

function TraceBadge({ source }: { source: TraceSource }) {
  const { locale } = useI18n()
  const className =
    source === "api_key"
      ? "bg-amber-500/15 text-foreground"
      : source === "agent_app"
        ? "bg-primary-soft text-primary"
        : "bg-muted text-foreground"
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold", className)}>
      {sourceLabel(source, locale)}
    </span>
  )
}

function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <ScrollArea className={cn("max-h-72 rounded-lg bg-muted", className)} scrollbars="both">
      <pre className="p-3 font-mono text-xs leading-relaxed text-foreground">
        {stringify(value)}
      </pre>
    </ScrollArea>
  )
}

function ObservationRow({ observation }: { observation: LangfuseObservation }) {
  const hasPayload = observation.input !== undefined || observation.output !== undefined
  return (
    <div className="rounded-lg bg-muted/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
          {observation.type || "span"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {observation.name || observation.id}
        </span>
        <span className="text-xs text-muted-foreground">{formatDate(observation.start_time)}</span>
      </div>
      {(observation.model || observation.provided_model_name || observation.level || observation.status_message) && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {(observation.model || observation.provided_model_name) && <span>{observation.model || observation.provided_model_name}</span>}
          {observation.level && <span>{observation.level}</span>}
          {observation.status_message && <span className="text-destructive">{observation.status_message}</span>}
        </div>
      )}
      {hasPayload && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Input</div>
            <JsonBlock value={observation.input} className="max-h-44 bg-background" />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-muted-foreground">Output</div>
            <JsonBlock value={observation.output} className="max-h-44 bg-background" />
          </div>
        </div>
      )}
    </div>
  )
}

export function TraceBrowserPage({ onBackToChat }: TraceBrowserPageProps) {
  const { user } = useAuth()
  const { locale } = useI18n()
  const [source, setSource] = useState<TraceSource>("all")
  const [query, setQuery] = useState("")
  const [fromDate, setFromDate] = useState(defaultFromDate)
  const [toDate, setToDate] = useState("")
  const [traces, setTraces] = useState<LangfuseTrace[]>([])
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TraceDetailResponse | null>(null)
  const [langfuseConfigured, setLangfuseConfigured] = useState(true)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.id === selectedTraceId) || detail?.trace || null,
    [detail?.trace, selectedTraceId, traces],
  )

  const loadTraces = useCallback(async () => {
    if (!user?.id) return
    setLoadingList(true)
    setError(null)
    try {
      const response = await fetchTraces(user.id, {
        source,
        query,
        fromTimestamp: inputDateToIso(fromDate),
        toTimestamp: inputDateToIso(toDate),
        limit: 50,
      })
      setLangfuseConfigured(response.langfuseConfigured)
      setTraces(response.traces)
      setSelectedTraceId((current) => {
        if (current && response.traces.some((trace) => trace.id === current)) return current
        return response.traces[0]?.id || null
      })
    } catch (err: any) {
      setError(err?.message || "Failed to load traces")
      setTraces([])
    } finally {
      setLoadingList(false)
    }
  }, [fromDate, query, source, toDate, user?.id])

  useEffect(() => {
    loadTraces()
  }, [loadTraces])

  useEffect(() => {
    if (!user?.id || !selectedTraceId || !langfuseConfigured) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoadingDetail(true)
    fetchTraceDetail(user.id, selectedTraceId)
      .then((response) => {
        if (!cancelled) setDetail(response)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || "Failed to load trace")
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [langfuseConfigured, selectedTraceId, user?.id])

  const labels = locale === "zh"
    ? {
        title: "Agent 轨迹",
        subtitle: "浏览主界面、Agent App 和 API Key 请求产生的 Langfuse 记录。Agent App 包含分享访客对话。",
        back: "返回对话",
        search: "搜索 trace、输入、输出或 metadata",
        from: "开始时间",
        to: "结束时间",
        refresh: "刷新",
        notConfigured: "Langfuse 尚未配置",
        notConfiguredDesc: "请在后端配置 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY 和可选的 LANGFUSE_HOST。",
        empty: "没有匹配的轨迹",
        emptyDesc: "调整来源、时间或关键词后再试。",
        list: "轨迹列表",
        details: "轨迹详情",
        observations: "Observation 时间线",
        input: "输入",
        output: "输出",
        metadata: "Metadata",
        openLangfuse: "打开 Langfuse",
      }
    : {
        title: "Agent Traces",
        subtitle: "Browse Langfuse records from the main UI, Agent App, and API keys. Agent App includes shared visitor conversations.",
        back: "Back to chat",
        search: "Search trace, input, output, or metadata",
        from: "From",
        to: "To",
        refresh: "Refresh",
        notConfigured: "Langfuse is not configured",
        notConfiguredDesc: "Configure LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and optional LANGFUSE_HOST on the backend.",
        empty: "No matching traces",
        emptyDesc: "Try a different source, time range, or keyword.",
        list: "Trace list",
        details: "Trace detail",
        observations: "Observation timeline",
        input: "Input",
        output: "Output",
        metadata: "Metadata",
        openLangfuse: "Open Langfuse",
      }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-xs font-semibold text-muted-foreground">{locale === "zh" ? "来源" : "Source"}</div>
            <div className="flex flex-wrap gap-1.5 rounded-lg bg-muted p-1">
              {SOURCE_OPTIONS.map((option) => {
                const Icon = option.icon
                const active = source === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => setSource(option.value)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                        : "text-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {locale === "zh" ? option.zh : option.en}
                  </Button>
                )
              })}
            </div>
          </div>
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{locale === "zh" ? "关键词" : "Keyword"}</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} className="pl-9" />
            </div>
          </label>
          <label className="w-full lg:w-48">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{labels.from}</span>
            <Input type="datetime-local" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="w-full lg:w-48">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">{labels.to}</span>
            <Input type="datetime-local" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <Button variant="outline" onClick={loadTraces} disabled={loadingList} className="w-full gap-2 lg:w-auto">
            {loadingList ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {labels.refresh}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!langfuseConfigured ? (
        <div className="flex-1 p-4 sm:p-6">
          <EmptyState
            icon={<Code2 className="h-8 w-8" />}
            title={labels.notConfigured}
            description={labels.notConfiguredDesc}
          />
        </div>
      ) : traces.length === 0 && !loadingList ? (
        <div className="flex-1 p-4 sm:p-6">
          <EmptyState icon={<Search className="h-8 w-8" />} title={labels.empty} description={labels.emptyDesc} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <ListPanel
            title={labels.list}
            action={<span className="text-xs font-medium text-muted-foreground">{traces.length}</span>}
            className="border-border/40 bg-background/30 lg:w-[390px]"
            contentClassName="gap-2"
          >
            {loadingList && traces.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                Loading
              </div>
            ) : (
              traces.map((trace) => {
                const active = trace.id === selectedTraceId
                const traceSource = sourceForTrace(trace)
                return (
                  <ListItem
                    key={trace.id}
                    selected={active}
                    title={traceDisplayName(trace)}
                    description={traceInputSummary(trace.input)}
                    titleClassName={active ? "text-primary" : undefined}
                    descriptionClassName={cn(
                      "line-clamp-2 whitespace-normal leading-relaxed",
                      active ? "text-foreground" : undefined,
                    )}
                    onSelect={() => setSelectedTraceId(trace.id)}
                    actions={<TraceBadge source={traceSource} />}
                    actionsClassName="top-3 translate-y-0 md:pointer-events-auto md:opacity-100"
                    className={cn(
                      "pr-3 sm:pr-20",
                      active
                        ? "border-transparent bg-primary-soft text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <div className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", active ? "text-primary" : "text-muted-foreground")}>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatDate(trace.timestamp)}
                      </span>
                      <span>{formatDuration(trace.latency)}</span>
                      <span>{formatCost(trace.total_cost)}</span>
                    </div>
                  </ListItem>
                )
              })
            )}
          </ListPanel>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-11 items-center justify-between border-b border-border/60 px-4 text-sm font-semibold text-foreground sm:px-6">
              <span>{labels.details}</span>
              {selectedTrace?.html_path && (
                <a
                  href={selectedTrace.html_path}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  {labels.openLangfuse}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              {!selectedTrace ? (
                <div className="p-4 sm:p-6">
                  <EmptyState icon={<Code2 className="h-8 w-8" />} title={labels.empty} />
                </div>
              ) : (
                <div className="space-y-4 p-4 sm:p-6">
                  <div className="rounded-lg bg-muted/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-foreground">{traceDisplayName(selectedTrace)}</h2>
                        <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{selectedTrace.id}</div>
                      </div>
                      <TraceBadge source={sourceForTrace(selectedTrace)} />
                    </div>
                    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground">Session</div>
                        <div className="mt-1 truncate font-mono text-xs text-foreground">{selectedTrace.session_id || "-"}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground">Time</div>
                        <div className="mt-1 text-foreground">{formatDate(selectedTrace.timestamp)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground">Latency</div>
                        <div className="mt-1 text-foreground">{formatDuration(selectedTrace.latency)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground">Cost</div>
                        <div className="mt-1 text-foreground">{formatCost(selectedTrace.total_cost)}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">{labels.input}</h3>
                      <JsonBlock value={selectedTrace.input} />
                    </section>
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">{labels.output}</h3>
                      <JsonBlock value={selectedTrace.output} />
                    </section>
                  </div>

                  <section>
                    <h3 className="mb-2 text-sm font-semibold text-foreground">{labels.metadata}</h3>
                    <JsonBlock value={selectedTrace.metadata || {}} className="max-h-56" />
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground">{labels.observations}</h3>
                      {loadingDetail && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="space-y-2">
                      {(detail?.observations || []).length > 0 ? (
                        detail!.observations.map((observation) => (
                          <ObservationRow key={observation.id} observation={observation} />
                        ))
                      ) : (
                        <EmptyState className="min-h-24" title={loadingDetail ? "Loading" : "No observations"} />
                      )}
                    </div>
                  </section>
                </div>
              )}
            </ScrollArea>
          </section>
        </div>
      )}
    </div>
  )
}
