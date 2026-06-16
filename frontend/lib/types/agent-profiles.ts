/** Built-in tool identifiers for generic agents. */
export type BuiltinToolId = "rag_search" | "fetch" | "navigate_robot_to_point"

export const BUILTIN_TOOLS: { id: BuiltinToolId; label: string; description: string }[] = [
  {
    id: "rag_search",
    label: "Knowledge Base (RAG)",
    description: "Search documents you have uploaded to this agent.",
  },
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
  /** Enabled built-in tool IDs. */
  enabledTools: BuiltinToolId[]
  knowledgeBaseIds?: string[]
  skillIds?: string[]
  mcpIds?: string[]
  agentIds?: string[]
  wakeWords?: string[]
  roleTemplateId?: string | null
  personaStyle?: string | null
  boundaryMode?: string | null
  ttsVoice?: string | null
  voiceInterruptionEnabled?: boolean
  speakerVerificationEnabled?: boolean
  speakerVerificationBound?: boolean
  speakerSampleText?: string | null
  speakerEnrolledAt?: string | null
  userVoiceprintId?: string | null
  createdAt: string
  updatedAt: string
}

export const AGENT_PROFILES_STORAGE_KEY = "agent-profiles"
export const SELECTED_AGENT_PROFILE_KEY = "selected-agent-profile-id"

export function isDefaultAgentProfile(profile: Pick<AgentProfile, "id">): boolean {
  return profile.id === "default" || profile.id.startsWith("default_")
}
