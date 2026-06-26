import type { Thread } from "@/lib/hooks/threads"

export type ThreadSourceKind = "main" | "api_key" | "agent_app" | "shared_agent_app"

export interface ThreadSourceInfo {
  kind: ThreadSourceKind
  labelZh: string
  labelEn: string
}

export function getThreadSource(thread: Thread): ThreadSourceInfo {
  const metadata = thread.metadata || {}
  const sourceType = typeof metadata.source_type === "string" ? metadata.source_type.toLowerCase() : ""
  const conversationSource =
    typeof metadata.conversation_source === "string" ? metadata.conversation_source.toLowerCase() : ""
  const authSource = typeof metadata.auth_source === "string" ? metadata.auth_source.toLowerCase() : ""
  const hasExternalApiSource =
    sourceType.includes("api") ||
    metadata.created_via_api_key === true ||
    authSource === "api_key" ||
    authSource === "apikey" ||
    conversationSource === "api_key" ||
    conversationSource === "apikey"
  const isSharedAgentApp =
    Boolean(metadata.shared_agent_owner_user_id && metadata.shared_agent_viewer_user_id) &&
    metadata.shared_agent_owner_user_id !== metadata.shared_agent_viewer_user_id
  const isAgentApp =
    sourceType.includes("agent app") ||
    sourceType === "agent_app" ||
    sourceType === "agentapp" ||
    conversationSource === "agent_app" ||
    conversationSource === "agentapp" ||
    conversationSource === "agent app"

  if (hasExternalApiSource) {
    return { kind: "api_key", labelZh: "API Key", labelEn: "API Key" }
  }
  if (isSharedAgentApp) {
    return { kind: "shared_agent_app", labelZh: "访客 App", labelEn: "Guest App" }
  }
  if (isAgentApp) {
    return { kind: "agent_app", labelZh: "Agent App", labelEn: "Agent App" }
  }
  return { kind: "main", labelZh: "主界面", labelEn: "Main" }
}
