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
  createdAt: string
  updatedAt: string
}

export const normalizeMcpTransport = (_type?: string): McpTransport => "streamable_http"
