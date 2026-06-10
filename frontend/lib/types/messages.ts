/**
 * Message Types
 *
 * Type definitions for chat messages and related structures.
 */

import type { ToolCall } from "./tools"
import type { SubgraphOutput } from "./tools"
import type { ImageAttachment } from "./images"

export interface ProcessStep {
  type: "text" | "tool"
  content?: string
  tool?: ToolCall
}

/**
 * Represents a chat message from either user or assistant.
 * Contains metadata for streaming, tool calls, and tracing.
 */
export interface Message {
  // Core properties
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date

  // Image attachments
  images?: ImageAttachment[]

  // Tool execution
  toolCalls?: ToolCall[]
  subgraphOutputs?: SubgraphOutput[]

  // Thinking/streaming state
  isThinking?: boolean
  thinkingSteps?: string[]
  processSteps?: ProcessStep[]
  thinkingStartTime?: number
  thinkingDuration?: number

  // LangSmith tracing
  runId?: string

  // LangGraph checkpoint metadata used for replay/regeneration
  checkpointId?: string
  parentCheckpointId?: string

  // Interruption tracking
  wasInterrupted?: boolean
}
