/** Built-in tool identifiers for generic agents. */
export type BuiltinToolId = "rag_search" | "fetch" | "query_form_data" | "manage_form_data"
export type FormRecordPermission = "create" | "read" | "update" | "delete"

export const BUILTIN_TOOLS: { id: BuiltinToolId; label: string; description: string }[] = [
  {
    id: "fetch",
    label: "Fetch URL",
    description: "Retrieve the content of any web page or API endpoint.",
  },
]

/** A user-defined agent profile stored in localStorage. */
export interface AgentProfile {
  /** UUID, generated on creation. */
  id: string
  name: string
  description: string
  systemPrompt: string
  /** Optional model ID used when this agent runs. Empty means use the global chat model. */
  model?: string | null
  /** Optional sampling temperature. Empty means use the model provider/default chat temperature. */
  modelTemperature?: number | null
  /** LangGraph assistant/graph used to run this profile. Empty defaults to generic_agent. */
  graphId?: "generic_agent" | "agent_builder" | string | null
  /** Enabled built-in tool IDs. */
  enabledTools: BuiltinToolId[]
  knowledgeBaseIds?: string[]
  skillIds?: string[]
  skillCategoryIds?: string[]
  mcpIds?: string[]
  agentIds?: string[]
  formIds?: string[]
  formCategoryIds?: string[]
  formPermissions?: Record<string, FormRecordPermission[]>
  wakeWords?: string[]
  roleTemplateId?: string | null
  personaStyle?: string | null
  boundaryMode?: string | null
  ttsVoice?: string | null
  isHidden?: boolean
  voiceInterruptionEnabled?: boolean
  speakerVerificationEnabled?: boolean
  speakerVerificationBound?: boolean
  speakerSampleText?: string | null
  speakerEnrolledAt?: string | null
  userVoiceprintId?: string | null
  /** Owner used at runtime for shared agent app profiles. */
  ownerUserId?: string | null
  /** Share token used to authorize direct shared-agent runs. */
  shareToken?: string | null
  /** True when this profile is a transient app profile loaded from a share link. */
  isSharedApp?: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentShareAccess {
  token: string
  agentProfileId: string
  purchased: boolean
  requiresPurchase: boolean
  priceCents: number
  currency: string
  trialDurationMinutes: number
  trialActive: boolean
  trialExpiresAt?: string | null
}

export interface AgentProfileVersion {
  id: string
  agentProfileId: string
  version: number
  snapshot: AgentProfile
  createdAt: string
}

export interface AgentShareOptions {
  knowledgeBases: boolean
  skills: boolean
  mcpServers: boolean
  agents: boolean
  forms: boolean
}

export interface AgentShareLink {
  token: string
  agentProfileId: string
  include: AgentShareOptions
  customSlug?: string | null
  priceCents: number
  currency: string
  trialDurationMinutes: number
  createdAt: string
  updatedAt: string
}

export interface AgentShareImportResponse {
  agent: AgentProfile
  resourceIdMap: Record<string, Record<string, string>>
  warnings: string[]
}

export interface AgentSharePreview {
  token: string
  agent: AgentProfile
  ownerUserId: string
  include: AgentShareOptions
  resources: Record<string, number>
  customSlug?: string | null
  priceCents: number
  currency: string
  isPaid: boolean
  trialDurationMinutes: number
  createdAt: string
}

export interface AgentSharePurchase {
  orderId: string
  outTradeNo: string
  status: string
  amountCents: number
  currency: string
  codeUrl?: string | null
  paymentProvider: string
  paymentConfigured: boolean
}

export interface AgentConfigTomlImportResponse {
  agents: AgentProfile[]
  resourceIdMap: Record<string, Record<string, string>>
  warnings: string[]
}

export const AGENT_PROFILES_STORAGE_KEY = "agent-profiles"
export const SELECTED_AGENT_PROFILE_KEY = "selected-agent-profile-id"

export function isDefaultAgentProfile(profile: Pick<AgentProfile, "id">): boolean {
  return profile.id === "default" || profile.id.startsWith("default_")
}

export function isSystemAgentProfile(profile: Pick<AgentProfile, "id" | "graphId">): boolean {
  return profile.graphId === "agent_builder" || isDefaultAgentProfile(profile)
}
