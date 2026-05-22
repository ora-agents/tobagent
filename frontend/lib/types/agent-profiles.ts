/** Built-in tool identifiers for generic agents. */
export type BuiltinToolId = "rag_search" | "websearch" | "fetch"

export const BUILTIN_TOOLS: { id: BuiltinToolId; label: string; description: string }[] = [
  {
    id: "rag_search",
    label: "Knowledge Base (RAG)",
    description: "Search documents you have uploaded to this agent.",
  },
  {
    id: "websearch",
    label: "Web Search",
    description: "Search the web using Tavily (requires TAVILY_API_KEY).",
  },
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
  /** Enabled built-in tool IDs. */
  enabledTools: BuiltinToolId[]
  createdAt: string
  updatedAt: string
}

export const AGENT_PROFILES_STORAGE_KEY = "agent-profiles"
export const SELECTED_AGENT_PROFILE_KEY = "selected-agent-profile-id"
