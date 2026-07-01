import { LANGGRAPH_API_URL } from "@/lib/constants/api"

export interface RuntimeCapabilities {
  smsAuth: boolean
  langfuseTracing: boolean
}

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  smsAuth: false,
  langfuseTracing: false,
}

export async function fetchRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const resp = await fetch(`${LANGGRAPH_API_URL}/api/capabilities`, {
    headers: { "Content-Type": "application/json" },
  })
  if (!resp.ok) {
    throw new Error(`Failed to load capabilities: HTTP ${resp.status}`)
  }
  const data = await resp.json()
  return {
    smsAuth: data?.smsAuth === true,
    langfuseTracing: data?.langfuseTracing === true,
  }
}
