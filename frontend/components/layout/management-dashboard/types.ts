export interface KBFile {
  name: string
  size: number
  uploadedAt: string
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  files: KBFile[]
  importStatus?: "ready" | "importing" | "failed" | "needs_upload"
  importError?: string | null
  isSystem?: boolean
  createdAt: string
  updatedAt: string
}

export type McpTransport = "streamable_http"

export interface McpServer {
  id: string
  name: string
  type: McpTransport
  url?: string
  headers: Record<string, string>
  tools: McpCapability[]
  resources: McpCapability[]
  prompts: McpCapability[]
  createdAt: string
  updatedAt: string
}

export interface McpCapability {
  name?: string
  title?: string
  description?: string
  uri?: string
  uriTemplate?: string
  kind?: "resource" | "template"
  [key: string]: unknown
}

export const normalizeMcpTransport = (_type?: string): McpTransport => "streamable_http"
