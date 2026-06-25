/** Built-in tool identifiers for generic agents. */
export type BuiltinToolId = "rag_search" | "fetch" | "query_form_data" | "manage_form_data" | "navigate_robot_to_point"
export type FormRecordPermission = "create" | "read" | "update" | "delete"

export const BUILTIN_TOOLS: { id: BuiltinToolId; label: string; description: string }[] = [
  {
    id: "fetch",
    label: "Fetch URL",
    description: "Retrieve the content of any web page or API endpoint.",
  },
  {
    id: "navigate_robot_to_point",
    label: "Control Robot",
    description: "Move the robot to a saved navigation point when running in the robot environment.",
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
  /** LangGraph assistant/graph used to run this profile. Empty defaults to generic_agent. */
  graphId?: "generic_agent" | "agent_builder" | string | null
  /** Enabled built-in tool IDs. */
  enabledTools: BuiltinToolId[]
  knowledgeBaseIds?: string[]
  skillIds?: string[]
  mcpIds?: string[]
  agentIds?: string[]
  formIds?: string[]
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
  createdAt: string
  updatedAt: string
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
  createdAt: string
  updatedAt: string
}

export interface AgentShareImportResponse {
  agent: AgentProfile
  resourceIdMap: Record<string, Record<string, string>>
  warnings: string[]
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
