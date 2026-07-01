/**
 * Public Chat Configuration
 *
 * Model listing is proxied through the FastAPI backend (/api/models) so that
 * the API key stays server-side. Only NEXT_PUBLIC_OPENAI_DEFAULT_MODEL is
 * needed on the frontend (as a fallback when the backend is unreachable).
 */

import { backendFetch } from "@/lib/api/backend-fetch"

// =============================================================================
// Config Storage
// =============================================================================

/** Bump version to force reset of saved user configs */
export const CONFIG_STORAGE = {
  key: "agent-config",
  versionKey: "agent-config-version",
  version: "0.6",
} as const

// =============================================================================
// OpenAI-compatible endpoint (frontend only needs the default model name)
// =============================================================================

export const OPENAI_DEFAULT_MODEL = process.env.NEXT_PUBLIC_OPENAI_DEFAULT_MODEL || ""

export type ModelOption = string  // plain model ID, e.g. "gpt-4o" or "llama3.2"

// =============================================================================
// Model cache (Layer A: in-memory, Layer B: localStorage)
// =============================================================================

const MODELS_CACHE_KEY = "models-cache"
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour

interface ModelsCache {
  models: ModelOption[]
  expiresAt: number
}

// Layer A: in-memory cache (lives for the lifetime of the page)
let memoryCache: ModelsCache | null = null

function readLocalStorageCache(): ModelsCache | null {
  try {
    const raw = localStorage.getItem(MODELS_CACHE_KEY)
    if (!raw) return null
    const parsed: ModelsCache = JSON.parse(raw)
    return parsed.expiresAt > Date.now() ? parsed : null
  } catch {
    return null
  }
}

function writeLocalStorageCache(models: ModelOption[]): void {
  try {
    const entry: ModelsCache = { models, expiresAt: Date.now() + MODELS_CACHE_TTL_MS }
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // localStorage unavailable (SSR, private mode quota) — silently skip
  }
}

/** Invalidate both cache layers (e.g. to force a fresh fetch). */
export function clearModelsCache(): void {
  memoryCache = null
  try { localStorage.removeItem(MODELS_CACHE_KEY) } catch { /* noop */ }
}

/**
 * Fetch all available models from the backend proxy (/api/models).
 * The backend forwards to the OpenAI-compatible API, keeping the key server-side.
 * Results are cached in memory (page lifetime) and localStorage (1 hour TTL).
 */
export async function fetchAvailableModels(): Promise<ModelOption[]> {
  // Layer A: memory cache
  if (memoryCache && memoryCache.expiresAt > Date.now()) {
    return memoryCache.models
  }

  // Layer B: localStorage cache
  const lsCache = readLocalStorageCache()
  if (lsCache) {
    memoryCache = lsCache
    return lsCache.models
  }

  try {
    const response = await backendFetch("/api/models", { anonymous: true })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    // Support both { data: [...] } and flat array shapes
    const models: Array<{ id: string }> = Array.isArray(data) ? data : (data.data ?? [])
    const ids = models.map((m) => m.id).filter(Boolean)
    const result = ids.length > 0 ? ids : (OPENAI_DEFAULT_MODEL ? [OPENAI_DEFAULT_MODEL] : [])

    // Populate both cache layers
    const entry: ModelsCache = { models: result, expiresAt: Date.now() + MODELS_CACHE_TTL_MS }
    memoryCache = entry
    writeLocalStorageCache(result)

    return result
  } catch (e) {
    console.error("Failed to fetch models from backend proxy:", e)
    return OPENAI_DEFAULT_MODEL ? [OPENAI_DEFAULT_MODEL] : []
  }
}

export function getDefaultModel(): ModelOption {
  return OPENAI_DEFAULT_MODEL
}

export function getModelDisplayName(modelId: ModelOption): string {
  return modelId
}

// =============================================================================
// Agent Registry
// =============================================================================

interface AgentConfig {
  id: string
  name: string
  shortName: string
  description?: string
}

export const AGENTS = {
  generic: {
    id: "generic_agent",
    name: "Generic Agent",
    shortName: "Generic Agent",
    description: "General purpose AI assistant",
  },
  agentBuilder: {
    id: "agent_builder",
    name: "平台智能体",
    shortName: "平台智能体",
    description: "System configuration-building assistant",
  },
} as const satisfies Record<string, AgentConfig>

export type AgentKey = keyof typeof AGENTS
export type AgentType = (typeof AGENTS)[AgentKey]["id"]

// =============================================================================
// Agent Functions
// =============================================================================

export function getAllowedAgents(): AgentType[] {
  return Object.values(AGENTS).map((a) => a.id)
}

export function getDefaultAgent(): AgentType {
  return AGENTS.generic.id
}

export function isAgentAllowed(agentId: AgentType): boolean {
  return getAllowedAgents().includes(agentId)
}

export function getAgentDisplayName(agentId: AgentType): string {
  const agent = Object.values(AGENTS).find((a) => a.id === agentId)
  return agent?.name ?? agentId
}

export function getAgentShortDisplayName(agentId: AgentType): string {
  const agent = Object.values(AGENTS).find((a) => a.id === agentId)
  return agent?.shortName ?? agentId
}

// =============================================================================
// Auth Functions
// =============================================================================

export function isAuthRequired(): boolean {
  return false
}
