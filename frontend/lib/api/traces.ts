import { backendFetch, backendUrl } from "@/lib/api/backend-fetch"

export type TraceSource = "all" | "main" | "agent_app" | "shared_agent_app" | "api_key"

export interface TraceListResponse {
  traces: LangfuseTrace[]
  meta: Record<string, unknown>
  source: TraceSource
  langfuseConfigured: boolean
  ownedSharedThreadCount: number
}

export interface TraceDetailResponse {
  trace: LangfuseTrace
  observations: LangfuseObservation[]
  observationsMeta: Record<string, unknown>
  langfuseConfigured: boolean
}

export interface LangfuseTrace {
  id: string
  timestamp?: string
  name?: string | null
  input?: unknown
  output?: unknown
  session_id?: string | null
  user_id?: string | null
  metadata?: Record<string, unknown> | null
  tags?: string[]
  html_path?: string | null
  latency?: number | null
  total_cost?: number | null
  environment?: string | null
  observations?: unknown[]
  scores?: unknown[]
}

export interface LangfuseObservation {
  id: string
  trace_id?: string | null
  parent_observation_id?: string | null
  name?: string | null
  type?: string | null
  start_time?: string | null
  end_time?: string | null
  input?: unknown
  output?: unknown
  metadata?: Record<string, unknown> | null
  level?: string | null
  status_message?: string | null
  model?: string | null
  provided_model_name?: string | null
  usage?: Record<string, unknown> | null
  usage_details?: Record<string, unknown> | null
  cost?: Record<string, unknown> | null
  cost_details?: Record<string, unknown> | null
  total_cost?: number | null
}

async function readJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let message = `Request failed (${resp.status})`
    try {
      const data = await resp.json()
      if (typeof data?.detail === "string") {
        message = data.detail
      }
    } catch {
      // Use the status-based fallback.
    }
    throw new Error(message)
  }
  return resp.json() as Promise<T>
}

export async function fetchTraces(
  _userId: string,
  params: {
    source?: TraceSource
    limit?: number
    page?: number
    query?: string
    fromTimestamp?: string
    toTimestamp?: string
  } = {},
): Promise<TraceListResponse> {
  const url = new URL(backendUrl("/api/traces"))
  url.searchParams.set("source", params.source || "all")
  url.searchParams.set("limit", String(params.limit || 50))
  url.searchParams.set("page", String(params.page || 1))
  if (params.query?.trim()) url.searchParams.set("query", params.query.trim())
  if (params.fromTimestamp) url.searchParams.set("fromTimestamp", params.fromTimestamp)
  if (params.toTimestamp) url.searchParams.set("toTimestamp", params.toTimestamp)

  const resp = await backendFetch(url.toString())
  return readJson<TraceListResponse>(resp)
}

export async function fetchTraceDetail(_userId: string, traceId: string): Promise<TraceDetailResponse> {
  const resp = await backendFetch(`/api/traces/${encodeURIComponent(traceId)}`)
  return readJson<TraceDetailResponse>(resp)
}
