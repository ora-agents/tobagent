/**
 * Stream Handler Hook
 *
 * This hook manages the streaming of LangGraph agent responses, handling real-time
 * message updates, tool calls, thinking steps, and subgraph outputs.
 *
 * Key Features:
 * - Real-time streaming of agent responses with progressive token display
 * - Tool call tracking and output capture (both regular tools and subagents)
 * - Thinking step visualization showing agent's reasoning process
 * - Subagent execution tracking with parallel execution support
 * - Stream interruption support
 * - SSR-safe implementation
 *
 * Architecture:
 * - Processes multiple stream modes: values, updates, events, checkpoints
 * - Filters subgraph events to show only main agent responses
 * - Tracks execution state across streaming events
 */

import { useCallback } from "react"
import { Client } from "@langchain/langgraph-sdk"
import type {
  Message,
  ProcessStep,
  ToolCall,
  ImageAttachment,
} from "../../types"
import {
  extractTextFromContent,
  ensureMessageExists,
  updateMessageInList,
} from "../../utils/chat"
import type { AgentConfig } from "@/components/layout/agent-settings"
import { getDefaultModel, type ModelOption } from "../../config/deployment-config"
import type { AgentProfile } from "../../types/agent-profiles"

// ============================================================================
// Constants
// ============================================================================

import { LANGGRAPH_API_URL } from "../../constants/api"

function isSubagentToolName(name?: string): boolean {
  return name === "task" || name === "read_skill" || !!name?.startsWith("call_agent_")
}

function getStreamMessageMetadata(data: any, chunk?: any): Record<string, any> {
  if (Array.isArray(data) && data[1] && typeof data[1] === "object") {
    return data[1]
  }
  if (data?.metadata && typeof data.metadata === "object") {
    return data.metadata
  }
  if (chunk?.metadata && typeof chunk.metadata === "object") {
    return chunk.metadata
  }
  return {}
}

function isSubagentMessageStream(eventType: string, data: any, chunk?: any): boolean {
  if (eventType.includes("|")) return true

  const metadata = getStreamMessageMetadata(data, chunk)
  const tags = Array.isArray(metadata.tags) ? metadata.tags : []
  if (metadata.stream_scope === "subagent" || tags.includes("subagent")) {
    return true
  }

  const checkpointNs =
    metadata.langgraph_checkpoint_ns ||
    metadata.checkpoint_ns ||
    metadata.checkpointNamespace

  return typeof checkpointNs === "string" && checkpointNs.includes("subagent")
}

function isUserMessage(msg: any): boolean {
  const role = msg?.type || msg?.role
  return role === "human" || role === "user"
}

function isAssistantMessage(msg: any): boolean {
  const role = msg?.type || msg?.role
  return role === "ai" || role === "assistant"
}

function isToolMessage(msg: any): boolean {
  const role = msg?.type || msg?.role
  return role === "tool"
}

function hasToolCalls(msg: any): boolean {
  return Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
}

function getEventMessageChunk(data: any): any | undefined {
  if (!data || typeof data !== "object") return undefined
  if (data.event !== "on_chat_model_stream" && data.event !== "on_llm_stream") {
    return undefined
  }

  const eventData = data.data
  if (!eventData || typeof eventData !== "object") return undefined

  return eventData.chunk ?? eventData.output ?? eventData
}

function getEventRunId(data: any): string {
  return typeof data?.run_id === "string" ? data.run_id : ""
}

function hasToolCallChunks(chunk: any): boolean {
  if (!chunk || typeof chunk !== "object") return false

  return (
    (Array.isArray(chunk.tool_calls) && chunk.tool_calls.length > 0) ||
    (Array.isArray(chunk.tool_call_chunks) && chunk.tool_call_chunks.length > 0) ||
    (Array.isArray(chunk.invalid_tool_calls) && chunk.invalid_tool_calls.length > 0) ||
    (Array.isArray(chunk.additional_kwargs?.tool_calls) &&
      chunk.additional_kwargs.tool_calls.length > 0) ||
    (Array.isArray(chunk.kwargs?.tool_calls) && chunk.kwargs.tool_calls.length > 0) ||
    (Array.isArray(chunk.kwargs?.tool_call_chunks) &&
      chunk.kwargs.tool_call_chunks.length > 0)
  )
}

function getChunkText(chunk: any): string {
  if (!chunk || typeof chunk !== "object") return ""
  if (chunk.content !== undefined) return extractTextFromContent(chunk.content)
  if (typeof chunk.text === "string") return chunk.text
  if (typeof chunk.delta === "string") return chunk.delta
  if (typeof chunk.token === "string") return chunk.token
  return ""
}

function getDisplayText(content: unknown): string {
  const text = extractTextFromContent(content)
  if (text) return text
  if (content === undefined || content === null) return ""
  if (typeof content === "string") return content

  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function mergeStreamedContent(currentContent: string, streamedContent: string): string {
  if (!streamedContent) return currentContent
  if (!currentContent) return streamedContent
  if (streamedContent.startsWith(currentContent)) return streamedContent
  return currentContent + streamedContent
}

function normalizeToolCall(toolCall: any): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    args: toolCall.args ?? {},
    ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
  }
}

function mergeToolCalls(current: ToolCall[], incoming: any[]): ToolCall[] {
  const incomingById = new Map(
    incoming.map((toolCall) => {
      const normalized = normalizeToolCall(toolCall)
      return [normalized.id, normalized]
    })
  )
  const currentIds = new Set(current.map((toolCall) => toolCall.id))

  return [
    ...current.map((toolCall) => {
      const next = incomingById.get(toolCall.id)
      if (!next) return toolCall

      return {
        ...toolCall,
        ...next,
        output: next.output !== undefined ? next.output : toolCall.output,
      }
    }),
    ...incoming
      .map(normalizeToolCall)
      .filter((toolCall) => !currentIds.has(toolCall.id)),
  ]
}

function syncProcessStepTools(
  processSteps: ProcessStep[],
  toolCalls: ToolCall[]
): ProcessStep[] {
  const toolsById = new Map(toolCalls.map((toolCall) => [toolCall.id, toolCall]))

  return processSteps.map((step) => {
    if (step.type !== "tool" || !step.tool) return step
    const tool = toolsById.get(step.tool.id)
    return tool && tool !== step.tool ? { ...step, tool } : step
  })
}

function applyToolOutput(
  toolCalls: ToolCall[],
  processSteps: ProcessStep[],
  toolCallId: string,
  output: unknown
): { toolCalls: ToolCall[]; processSteps: ProcessStep[] } {
  let updatedTool: ToolCall | undefined
  const nextToolCalls = toolCalls.map((toolCall) => {
    if (toolCall.id !== toolCallId) return toolCall
    updatedTool = { ...toolCall, output }
    return updatedTool
  })

  const nextProcessSteps = processSteps.map((step) => {
    if (step.type !== "tool" || step.tool?.id !== toolCallId) return step
    return {
      ...step,
      tool: updatedTool ?? { ...step.tool, output },
    }
  })

  return {
    toolCalls: nextToolCalls,
    processSteps: nextProcessSteps,
  }
}

function findDisplayMessagesAfterUser(messages: any[], userContent: string): any[] {
  let lastUserIndex = -1
  let foundCurrentUser = !userContent

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index]
    if (!isUserMessage(msg)) continue

    const content = msg.content ? extractTextFromContent(msg.content) : ""
    if (!userContent || content === userContent || content.includes(userContent)) {
      lastUserIndex = index
      foundCurrentUser = true
      break
    }
  }

  if (!foundCurrentUser) return []

  const candidates = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages
  return candidates.filter((msg: any) =>
    (
      (isAssistantMessage(msg) && getDisplayText(msg.content).trim()) ||
      (isToolMessage(msg) && getDisplayText(msg.content).trim())
    )
  )
}

function replaceAssistantResponseMessages(
  messages: Message[],
  assistantMessageId: string,
  assistantMessages: Message[]
): Message[] {
  const syntheticPrefix = `${assistantMessageId}-values-`
  const streamPrefix = `${assistantMessageId}-stream-`
  const toolPrefix = `${assistantMessageId}-tool-`
  const isPreviousResponseMessage = (message: Message) =>
    message.id === assistantMessageId ||
    message.id.startsWith(syntheticPrefix) ||
    message.id.startsWith(streamPrefix) ||
    message.id.startsWith(toolPrefix)
  const insertIndex = messages.findIndex(isPreviousResponseMessage)
  const withoutPreviousValues = messages.filter(
    (message) => !isPreviousResponseMessage(message)
  )

  if (insertIndex < 0) {
    return [...withoutPreviousValues, ...assistantMessages]
  }

  const boundedInsertIndex = Math.min(insertIndex, withoutPreviousValues.length)
  return [
    ...withoutPreviousValues.slice(0, boundedInsertIndex),
    ...assistantMessages,
    ...withoutPreviousValues.slice(boundedInsertIndex),
  ]
}

function toDisplayResponseMessages(
  displayMessages: any[],
  assistantMessageId: string,
  finalAssistantCheckpointId: string | undefined,
  currentUserCheckpointId: string | undefined
): Message[] {
  let assistantSegmentIndex = 0
  let hasSeenTool = false
  let hasSeenAssistant = false

  return displayMessages.map((msg: any, index: number): Message => {
    const role = isToolMessage(msg) ? "tool" : "assistant"
    const content = getDisplayText(msg.content)
    let id: string

    if (role === "tool") {
      hasSeenTool = true
      id = `${assistantMessageId}-tool-${msg.tool_call_id || msg.id || index}`
    } else if (!hasSeenAssistant && !hasSeenTool) {
      hasSeenAssistant = true
      id = assistantMessageId
    } else {
      hasSeenAssistant = true
      assistantSegmentIndex += 1
      id = hasSeenTool
        ? `${assistantMessageId}-stream-${assistantSegmentIndex}`
        : `${assistantMessageId}-values-${msg.id || index}`
    }

    return {
      id,
      role,
      content,
      timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
      isThinking: true,
      runId: msg.run_id,
      checkpointId: index === displayMessages.length - 1 ? finalAssistantCheckpointId : undefined,
      parentCheckpointId: currentUserCheckpointId,
      toolName: msg.name,
      toolCallId: msg.tool_call_id,
    }
  })
}

function upsertStreamedToolMessage(
  messages: Message[],
  assistantMessageId: string,
  tool: ToolCall
): Message[] {
  const messageId = `${assistantMessageId}-tool-${tool.id}`
  const content = getDisplayText(tool.output ?? tool.args)
  const existingIndex = messages.findIndex((message) => message.id === messageId)
  const toolMessage: Message = {
    id: messageId,
    role: "tool",
    content,
    timestamp: new Date(),
    isThinking: tool.output === undefined,
    toolName: tool.name,
    toolCallId: tool.id,
  }

  if (existingIndex >= 0) {
    return messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            ...toolMessage,
            timestamp: message.timestamp,
          }
        : message
    )
  }

  const insertIndex = messages.findIndex((message) => message.id === assistantMessageId)
  if (insertIndex < 0) {
    return [...messages, toolMessage]
  }

  let boundedInsertIndex = insertIndex + 1
  while (
    boundedInsertIndex < messages.length &&
    messages[boundedInsertIndex].id.startsWith(`${assistantMessageId}-`)
  ) {
    boundedInsertIndex += 1
  }

  return [
    ...messages.slice(0, boundedInsertIndex),
    toolMessage,
    ...messages.slice(boundedInsertIndex),
  ]
}

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the useStreamHandler hook.
 */
interface UseStreamHandlerProps {
  client: Client | null
  threadId: string | null
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  agentConfig?: AgentConfig
  /** Custom agent profile to use instead of (or alongside) the built-in agents. */
  agentProfile?: AgentProfile | null
  shouldInterruptRef?: React.MutableRefObject<boolean>
  userId?: string | null
  userEmail?: string | null
  userName?: string | null
  /** User's general preferences injected into agent system prompt. */
  userPreferences?: string | null
  /** When true, agent must confirm before executing dangerous actions. */
  safetyEnabled?: boolean
  conversationSource?: "main" | "agent_app"
  /**
   * Called with each new text chunk as it streams in (delta, not accumulated).
   * Used by voice agent to feed text to TTS in real-time.
   */
  onTextChunk?: (delta: string) => void
  /** Called when the stream completes (after all chunks). */
  onStreamEnd?: () => void
}

/**
 * Return type for the useStreamHandler hook.
 */
interface UseStreamHandlerReturn {
  processStream: (
    userContent: string,
    assistantMessageId: string,
    images?: ImageAttachment[],
    threadIdOverride?: string,
    options?: {
      checkpointId?: string
      replayFromCheckpoint?: boolean
      userMessageId?: string
      inputMessages?: Array<{ role: "user" | "assistant"; content: unknown }>
    }
  ) => Promise<{ assistantContent: string; runId: string | undefined }>
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook to handle streaming responses from LangGraph agents.
 *
 * Manages the complete lifecycle of agent streaming including:
 * - Processing streamed chunks and updating message state
 * - Tracking tool calls and their outputs
 * - Visualizing thinking steps and subagent execution
 *
 * @param client - LangGraph SDK client instance
 * @param threadId - ID of the conversation thread
 * @param setMessages - State setter for messages array
 * @param agentConfig - Optional agent configuration (model, recursion limit, agent type)
 * @param shouldInterruptRef - Optional ref to signal stream interruption
 * @returns Object containing processStream function
 *
 * @example
 * ```tsx
 * const { processStream } = useStreamHandler({
 *   client: langGraphClient,
 *   threadId: "thread-123",
 *   setMessages: setMessages,
 *   agentConfig: { model: "openai:gpt-4o", agentType: "generic_agent" }
 * })
 *
 * await processStream("What is LangChain?", "msg-456")
 * ```
 */
export function useStreamHandler({
  client,
  threadId,
  setMessages,
  agentConfig,
  agentProfile,
  shouldInterruptRef,
  userId,
  userEmail,
  userName,
  userPreferences,
  safetyEnabled,
  conversationSource = "main",
  onTextChunk,
  onStreamEnd,
}: UseStreamHandlerProps): UseStreamHandlerReturn {
  /**
   * Processes the stream of agent responses.
   *
   * Main function that handles:
   * - Initiating the stream with LangGraph SDK
   * - Processing various stream event types (values, updates, events, checkpoints)
   * - Tracking tool calls, thinking steps, and subagent outputs
   * - Updating message state in real-time
   * - Handling stream interruption
   *
   * @param userContent - User's message content
   * @param assistantMessageId - ID for the assistant's response message
   * @param images - Optional image attachments
   * @returns Promise with assistant content and run ID
   */
  const processStream = useCallback(
    async (
      userContent: string,
      assistantMessageId: string,
      images?: ImageAttachment[],
      threadIdOverride?: string,
      options?: {
        checkpointId?: string
        replayFromCheckpoint?: boolean
        userMessageId?: string
        inputMessages?: Array<{ role: "user" | "assistant"; content: unknown }>
      },
    ) => {
      if (!LANGGRAPH_API_URL) {
        throw new Error(
          "Missing LANGGRAPH_API_URL; cannot invoke LangGraph"
        )
      }

      if (!client) {
        throw new Error(
          "Client not initialized; cannot invoke LangGraph. User ID may not be loaded yet."
        )
      }

      const targetThreadId = threadIdOverride ?? threadId
      if (!targetThreadId) {
        throw new Error("Thread ID is required before invoking LangGraph")
      }

      // Format message content - use multimodal format if files are present
      let messageContent: any
      if (images && images.length > 0) {
        // Build multimodal message with text and files
        const contentBlocks: any[] = [
          {
            type: "text",
            text: userContent || "Please analyze the attached file(s)."
          }
        ]

        // Process each file
        for (const file of images) {
          // Public CLC does not support HAR analysis; avoid sending large traces to the docs agent.
          if (file.name?.toLowerCase().endsWith(".har")) continue

          const isImage = file.mimeType?.startsWith('image/')

          if (isImage) {
            // Image files: send as base64 image_url
            contentBlocks.push({
              type: "image_url",
              image_url: {
                url: `data:${file.mimeType};base64,${file.base64}`
              }
            })
          } else {
            // Text files: decode base64 and send as text block
            try {
              // Decode base64 to get text content
              const decodedContent = atob(file.base64 || '')
              console.log(`📄 Decoded file ${file.name}:`, {
                mimeType: file.mimeType,
                size: file.size,
                contentLength: decodedContent.length,
                preview: decodedContent.slice(0, 100)
              })
              contentBlocks.push({
                type: "text",
                text: `**File: ${file.name || 'unknown'}**\n\`\`\`\n${decodedContent}\n\`\`\``
              })
            } catch (error) {
              console.error(`Failed to decode file ${file.name}:`, error)
              contentBlocks.push({
                type: "text",
                text: `[Failed to decode file: ${file.name}]`
              })
            }
          }
        }

        messageContent = contentBlocks
      } else {
        // Text-only message
        messageContent = userContent
      }

      // Log the final message being sent
      console.log('📤 Sending message to agent:', {
        hasFiles: images && images.length > 0,
        fileCount: images?.length || 0,
        contentBlocks: Array.isArray(messageContent) ? messageContent.length : 1,
        messagePreview: Array.isArray(messageContent)
          ? messageContent.map(block => `${block.type}: ${block.text?.slice(0, 50) || 'image'}...`)
          : messageContent.slice(0, 100)
      })

      const input = options?.replayFromCheckpoint
        ? null
        : options?.inputMessages
          ? { messages: options.inputMessages }
        : {
            messages: [{ role: "user", content: messageContent }],
          }

      const model = ((agentProfile?.model || agentConfig?.model || getDefaultModel()) as ModelOption)
      const recursionLimit = agentConfig?.recursionLimit ?? 100

      let assistantContent = ""
      let activeAssistantMessageId = assistantMessageId
      let activeAssistantSegmentContent = ""
      let assistantToolCalls: ToolCall[] = []
      let assistantProcessSteps: ProcessStep[] = []
      let runId: string | undefined = undefined
      let hasSeenNewResponse = false
      let hasStreamedToolMessages = false
      let shouldStartAssistantSegmentAfterTool = false
      let streamedAssistantSegmentIndex = 0
      let currentUserCheckpointId: string | undefined = options?.checkpointId
      let finalAssistantCheckpointId: string | undefined
      let orderedResponseMessagesFromValues: Message[] = []

      const isCustomProfile = !!agentProfile
      const agentType = agentProfile?.graphId?.trim() || "generic_agent"
      const repos = agentConfig?.repos ?? []

      // Trace metadata for Langfuse observability
      const sourceType = conversationSource === "agent_app" ? "Agent App" : "Chat-LangChain"
      const traceMetadata = {
        user_id: userId || "unknown",
        langfuse_user_id: userId || "unknown",
        langfuse_session_id: targetThreadId,
        langfuse_tags: ["Chat-LangChain", agentType, "agent"],
        ...(userEmail && userEmail !== userId ? { user_email: userEmail } : {}),
        ...(userName && !userName.startsWith("User") ? { user_name: userName } : {}),
        ...(agentProfile?.id ? { agent_id: agentProfile.id } : {}),
        ...(agentProfile?.name ? { agent_name: agentProfile.name } : {}),
        source_type: sourceType,
        ...(conversationSource === "agent_app" ? { conversation_source: "agent_app" } : {}),
        graph: agentType,
      }

      // Build runtime context for the graph context_schema.
      const isRobotEnvironment = (() => {
        if (typeof window === "undefined") return false
        const params = new URLSearchParams(window.location.search)
        return (
          params.get("robot_environment") === "1" ||
          params.get("robot_environment") === "true" ||
          Boolean((window as any).__TOB_ROBOT_ENV__)
        )
      })()

      const contextBase: Record<string, unknown> = { model, user_id: userId }
      if (isCustomProfile && agentProfile) {
        contextBase.agent_id = agentProfile.id
        if (agentProfile.ownerUserId) {
          contextBase.agent_owner_user_id = agentProfile.ownerUserId
        }
        if (agentProfile.shareToken) {
          contextBase.share_token = agentProfile.shareToken
        }
      } else if (repos.length > 0) {
        contextBase.repos = repos
      }
      if (isRobotEnvironment) {
        contextBase.robot_environment = true
      }

      // Always inject user preferences and safety flag
      if (userPreferences) {
        contextBase.user_preferences = userPreferences
      }
      if (safetyEnabled) {
        contextBase.safety_enabled = true
      }

      const streamResponse = client.runs.stream(targetThreadId, agentType, {
        input,
        context: contextBase,
        ...(options?.checkpointId ? { checkpointId: options.checkpointId } : {}),
        config: {
          recursion_limit: recursionLimit,
          tags: ["Chat-LangChain", agentType],
          metadata: traceMetadata,
        } as any,
        streamMode: ["values", "updates", "events", "checkpoints"],
        streamSubgraphs: false,
        ifNotExists: "create",
      })

      // Initialize from existing message data if resuming
      let existingMessage: Message | undefined
      setMessages((prev) => {
        existingMessage = prev.find((m) => m.id === assistantMessageId)
        return prev
      })

      // Restore tool calls from existing message
      if (existingMessage?.processSteps) {
        assistantProcessSteps = [...existingMessage.processSteps]
      }
      if (existingMessage?.toolCalls) {
        assistantToolCalls = existingMessage.toolCalls.filter(
          (toolCall) => !isSubagentToolName(toolCall.name)
        )
      }
      if (existingMessage?.subgraphOutputs || existingMessage?.toolCalls) {
        setMessages((prev) =>
          updateMessageInList(prev, assistantMessageId, {
            toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
            processSteps: assistantProcessSteps.length > 0 ? assistantProcessSteps : undefined,
            subgraphOutputs: undefined,
          })
        )
      }

      let pendingMessageUpdater: ((prev: Message[]) => Message[]) | null = null
      const toolCallingModelRuns = new Set<string>()
      let scheduledMessageFlush:
        | { type: "raf"; id: number }
        | { type: "timeout"; id: ReturnType<typeof setTimeout> }
        | null = null

      const flushQueuedMessageUpdates = () => {
        if (scheduledMessageFlush) {
          if (scheduledMessageFlush.type === "raf" && typeof window !== "undefined") {
            window.cancelAnimationFrame(scheduledMessageFlush.id)
          } else if (scheduledMessageFlush.type === "timeout") {
            clearTimeout(scheduledMessageFlush.id)
          }
          scheduledMessageFlush = null
        }

        if (!pendingMessageUpdater) return
        const updater = pendingMessageUpdater
        pendingMessageUpdater = null
        setMessages(updater)
      }

      const queueMessageUpdate = (updater: (prev: Message[]) => Message[]) => {
        const previousUpdater = pendingMessageUpdater
        pendingMessageUpdater = previousUpdater
          ? ((prev) => updater(previousUpdater(prev)))
          : updater

        if (scheduledMessageFlush) return

        if (typeof window !== "undefined" && window.requestAnimationFrame) {
          const id = window.requestAnimationFrame(flushQueuedMessageUpdates)
          scheduledMessageFlush = { type: "raf", id }
        } else {
          const id = setTimeout(flushQueuedMessageUpdates, 32)
          scheduledMessageFlush = { type: "timeout", id }
        }
      }

      const queueStreamedToolMessage = (tool: ToolCall) => {
        hasStreamedToolMessages = true
        shouldStartAssistantSegmentAfterTool = true
        queueMessageUpdate((prev) =>
          upsertStreamedToolMessage(prev, assistantMessageId, tool)
        )
      }

      for await (const chunk of streamResponse) {
        // Check if user requested interrupt
        if (shouldInterruptRef?.current) {
          break
        }

        const eventType = chunk.event as string
        const data = chunk.data as any

        // Capture run_id from metadata
        if (!runId) {
          const possibleRunId =
            (chunk as any).metadata?.run_id ||
            (chunk as any).run_id ||
            (chunk as any).data?.run_id

          if (possibleRunId) {
            runId = possibleRunId
          }
        }

        const isSubgraphEvent = eventType.includes("|")
        const isSubagentMessageEvent =
          (eventType === "messages" || eventType === "events") &&
          isSubagentMessageStream(eventType, data, chunk)
        const eventParts = eventType.split("|")
        const baseEvent = eventParts[0]

        if ((eventType === "checkpoints" || baseEvent === "checkpoints") && !isSubgraphEvent && data) {
          const checkpointId = data.config?.configurable?.checkpoint_id
          const parentCheckpointId = data.parent_config?.configurable?.checkpoint_id
          const checkpointMessages = data.values?.messages
          const lastMessage = Array.isArray(checkpointMessages)
            ? checkpointMessages[checkpointMessages.length - 1]
            : undefined
          const lastRole = lastMessage?.type || lastMessage?.role
          const lastContent = lastMessage?.content ? extractTextFromContent(lastMessage.content) : ""

          if (checkpointId && (lastRole === "human" || lastRole === "user") && lastContent === userContent) {
            currentUserCheckpointId = checkpointId

            if (options?.userMessageId) {
              queueMessageUpdate((prev) =>
                updateMessageInList(prev, options.userMessageId!, {
                  checkpointId,
                  parentCheckpointId,
                })
              )
            }
          }

          if (checkpointId && (lastRole === "ai" || lastRole === "assistant")) {
            finalAssistantCheckpointId = checkpointId
          }
        }

        // Track tool calls. Subagent tool output is intentionally kept out of
        // frontend state; the parent agent consumes it and streams one final answer.
        if (
          (eventType === "updates" ||
            (baseEvent === "updates" && isSubgraphEvent)) &&
          data
        ) {
          // Update tool calls from agent/model messages
          const agentMessages = data.agent?.messages || data.model?.messages
          if (agentMessages && Array.isArray(agentMessages)) {
            agentMessages.forEach((msg: any) => {
              if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                msg.tool_calls.forEach((toolCall: any) => {
                  const existingToolCall = assistantToolCalls.find(
                    (tc) => tc.id === toolCall.id
                  )
                  if (!existingToolCall) {
                    if (!isSubagentToolName(toolCall.name)) {
                      assistantToolCalls = mergeToolCalls(
                        assistantToolCalls,
                        [toolCall]
                      )
                      const tool = assistantToolCalls.find((item) => item.id === toolCall.id)
                      if (tool) {
                        queueStreamedToolMessage(tool)
                      }
                    }
                  }
                })
              }
            })
          }

          // Process tool messages (both regular tools and subagent responses)
          if (data.tools?.messages && Array.isArray(data.tools.messages)) {
            data.tools.messages.forEach((msg: any) => {
              if (msg.type === "tool" && msg.tool_call_id) {
                if (isSubagentToolName(msg.name)) return

                if (
                  assistantToolCalls.some((tc) => tc.id === msg.tool_call_id) &&
                  msg.content
                ) {
                  const output =
                    typeof msg.content === "string"
                      ? msg.content
                      : JSON.stringify(msg.content)
                  const nextState = applyToolOutput(
                    assistantToolCalls,
                    assistantProcessSteps,
                    msg.tool_call_id,
                    output
                  )
                  assistantToolCalls = nextState.toolCalls
                  assistantProcessSteps = nextState.processSteps
                  const tool = assistantToolCalls.find((item) => item.id === msg.tool_call_id)
                  if (tool) {
                    queueStreamedToolMessage(tool)
                  }
                }
              }
            })
          }
        }

      // Handle "values" mode - final state with complete output
      // IMPORTANT: Skip subgraph events to avoid showing subagent content in main chat
      if (eventType === "values" && !isSubgraphEvent && data?.messages && Array.isArray(data.messages)) {
        const displayMessages = findDisplayMessagesAfterUser(data.messages, userContent)
        const nextResponseMessages = toDisplayResponseMessages(
          displayMessages,
          assistantMessageId,
          finalAssistantCheckpointId,
          currentUserCheckpointId
        )
        const finalContent = nextResponseMessages
          .filter((message) => message.role === "assistant")
          .map((message) => message.content)
          .filter(Boolean)
          .join("\n\n")
        const displayContent = nextResponseMessages
          .map((message) => `${message.role}:${message.content}`)
          .join("\n\n")

        // Use final values as the authoritative fallback. This keeps the UI
        // populated when the server emits no main-agent token tuples while
        // still ignoring metadata-free partial aggregates.
        if (
          nextResponseMessages.length > 0 &&
          displayContent &&
          (displayContent !== orderedResponseMessagesFromValues.map((message) => `${message.role}:${message.content}`).join("\n\n") ||
            nextResponseMessages.length !== orderedResponseMessagesFromValues.length)
        ) {
          const delta = finalContent.slice(assistantContent.length)
          assistantContent = finalContent
          orderedResponseMessagesFromValues = nextResponseMessages

          if (delta && onTextChunk) {
            onTextChunk(delta)
          }

          queueMessageUpdate((prev) => {
            const withMessage = ensureMessageExists(prev, assistantMessageId, nextResponseMessages[0])
            return replaceAssistantResponseMessages(withMessage, assistantMessageId, nextResponseMessages)
          })
        }
      }

      // Handle astream_events-style model token events. Tool-call assistant
      // messages are skipped; only natural-language answer chunks render.
      if (eventType === "events" && !isSubagentMessageEvent && data) {
        const aiChunk = getEventMessageChunk(data)

        if (aiChunk) {
          const eventRunId = getEventRunId(data)
          if (eventRunId && hasToolCallChunks(aiChunk)) {
            toolCallingModelRuns.add(eventRunId)
          }
          if (eventRunId && toolCallingModelRuns.has(eventRunId)) {
            continue
          }

          const streamedContent = getChunkText(aiChunk)

          // IMPORTANT: Skip subagent responses (they typically start with JSON like '{"answer":')
          const looksLikeSubagentResponse = streamedContent.trim().startsWith('{') || streamedContent.trim().startsWith('{"answer')
          if (looksLikeSubagentResponse) {
            continue
          }

          // Only update if we have content and no pending tool calls.
          const hasPendingToolCalls = hasToolCallChunks(aiChunk)
          if (streamedContent && !hasPendingToolCalls) {
            const nextAssistantContent = mergeStreamedContent(assistantContent, streamedContent)
            const delta = nextAssistantContent.slice(assistantContent.length)
            assistantContent = nextAssistantContent
            if (shouldStartAssistantSegmentAfterTool) {
              streamedAssistantSegmentIndex += 1
              activeAssistantMessageId = `${assistantMessageId}-stream-${streamedAssistantSegmentIndex}`
              activeAssistantSegmentContent = ""
              shouldStartAssistantSegmentAfterTool = false
            }
            activeAssistantSegmentContent = mergeStreamedContent(
              activeAssistantSegmentContent,
              streamedContent
            )
            hasSeenNewResponse = true // Mark that we've seen new content

            // Notify TTS with the new text delta
            if (delta && onTextChunk) {
              onTextChunk(delta)
            }

            const segmentMessageId = activeAssistantMessageId
            const segmentContent = activeAssistantSegmentContent
            queueMessageUpdate((prev) => {
              const baseMessage: Message = {
                id: segmentMessageId,
                role: "assistant",
                content: segmentContent,
                timestamp: new Date(),
                isThinking: true,
              }

              const withMessage = ensureMessageExists(prev, segmentMessageId, baseMessage)
              return updateMessageInList(withMessage, segmentMessageId, {
                content: segmentContent,
                isThinking: true,
              })
            })
          }
        }
      }

      // Capture intermediate text and tool calls into processSteps
      // Support both agent (deepagent) and model (create_agent) nodes
      const agentMessages = data?.agent?.messages || data?.model?.messages
      if ((eventType === "updates" || baseEvent === "updates") && data) {
        if (agentMessages && Array.isArray(agentMessages)) {
          agentMessages.forEach((msg: any) => {
            if (msg.type === "ai" || msg.role === "assistant") {
              const hasToolCallsInMsg = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0

              // Only capture text as intermediate processStep when the same AI message
              // also contains tool_calls — this is thinking/reasoning text BEFORE tool execution.
              // Text in AI messages WITHOUT tool_calls is the final response, not a process step.
              if (hasToolCallsInMsg && msg.content && typeof msg.content === "string" && msg.content.trim()) {
                const textContent = msg.content.trim()
                if (!assistantProcessSteps.find(s => s.type === "text" && s.content === textContent)) {
                  assistantProcessSteps.push({ type: "text", content: textContent })
                }
              }

              if (hasToolCallsInMsg) {
                const newTools = msg.tool_calls.filter((toolCall: any) => !isSubagentToolName(toolCall.name))
                if (newTools.length > 0) {
                  assistantToolCalls = mergeToolCalls(assistantToolCalls, newTools)
                  newTools.forEach((toolCall: any) => {
                    const tool = assistantToolCalls.find((item) => item.id === toolCall.id)
                    if (tool) {
                      queueStreamedToolMessage(tool)
                    }
                  })
                  assistantProcessSteps = syncProcessStepTools(
                    assistantProcessSteps,
                    assistantToolCalls
                  )
                  newTools.forEach((tc: any) => {
                    if (!assistantProcessSteps.find(s => s.type === "tool" && s.tool?.id === tc.id)) {
                      const tool = assistantToolCalls.find((item) => item.id === tc.id)
                      if (tool) {
                        assistantProcessSteps = [
                          ...assistantProcessSteps,
                          { type: "tool", tool },
                        ]
                      }
                    }
                  })
                }
              }
            }
          })
        }
        
        if (data.tools?.messages && Array.isArray(data.tools.messages)) {
          data.tools.messages.forEach((msg: any) => {
            if (msg.type === "tool" && msg.tool_call_id) {
              const output =
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content)
              const nextState = applyToolOutput(
                assistantToolCalls,
                assistantProcessSteps,
                msg.tool_call_id,
                output
              )
              assistantToolCalls = nextState.toolCalls
              assistantProcessSteps = nextState.processSteps
              const updatedTool = assistantToolCalls.find(
                (item) => item.id === msg.tool_call_id
              )
              if (updatedTool) {
                queueStreamedToolMessage(updatedTool)
              }
              if (
                !assistantProcessSteps.some(
                  (step) => step.type === "tool" && step.tool?.id === msg.tool_call_id
                )
              ) {
                const tool = assistantToolCalls.find(
                  (item) => item.id === msg.tool_call_id
                )
                if (tool) {
                  assistantProcessSteps = [
                    ...assistantProcessSteps,
                    { type: "tool", tool },
                  ]
                }
              }
            }
          })
        }

      }
    }

    flushQueuedMessageUpdates()

    // Check if stream was interrupted
    const wasInterrupted = shouldInterruptRef?.current || false

    // Mark as complete after stream ends
    // Explicitly include processSteps and toolCalls to prevent data loss
    // when the RAF-scheduled queueMessageUpdate races with this final setMessages call.
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === assistantMessageId)
      const thinkingDuration = existing?.thinkingStartTime
        ? Date.now() - existing.thinkingStartTime
        : undefined

      if (orderedResponseMessagesFromValues.length > 0) {
        const finalOrderedMessages = orderedResponseMessagesFromValues.map((message, index) => ({
          ...message,
          isThinking: false,
          thinkingDuration: index === 0 ? thinkingDuration : message.thinkingDuration,
          runId: message.runId || runId,
          checkpointId:
            index === orderedResponseMessagesFromValues.length - 1
              ? finalAssistantCheckpointId || message.checkpointId
              : message.checkpointId,
          parentCheckpointId: message.parentCheckpointId || currentUserCheckpointId,
          subgraphOutputs: undefined,
          wasInterrupted,
        }))
        return replaceAssistantResponseMessages(prev, assistantMessageId, finalOrderedMessages)
      }

      if (hasStreamedToolMessages) {
        let lastAssistantIndex = -1
        prev.forEach((message, index) => {
          if (
            message.role === "assistant" &&
            (message.id === assistantMessageId || message.id.startsWith(`${assistantMessageId}-stream-`))
          ) {
            lastAssistantIndex = index
          }
        })

        return prev.map((m, index) => {
          if (m.id === assistantMessageId || m.id.startsWith(`${assistantMessageId}-stream-`)) {
            return {
              ...m,
              isThinking: false,
              thinkingDuration: m.id === assistantMessageId ? thinkingDuration : m.thinkingDuration,
              runId: m.runId || runId,
              checkpointId: index === lastAssistantIndex ? finalAssistantCheckpointId : m.checkpointId,
              parentCheckpointId: m.parentCheckpointId || currentUserCheckpointId,
              processSteps: undefined,
              toolCalls: undefined,
              subgraphOutputs: undefined,
              wasInterrupted,
            }
          }

          if (m.id.startsWith(`${assistantMessageId}-tool-`)) {
            return {
              ...m,
              isThinking: false,
              wasInterrupted,
            }
          }

          return m
        })
      }

      return prev.map((m) =>
        m.id === assistantMessageId
          ? {
              ...m,
              content: wasInterrupted && !assistantContent
                ? "Response stopped. The agent was interrupted while processing your request."
                : assistantContent || "(No response generated)",
              isThinking: false,
              thinkingDuration,
              runId,
              checkpointId: finalAssistantCheckpointId,
              parentCheckpointId: currentUserCheckpointId,
              processSteps: undefined,
              toolCalls: undefined,
              subgraphOutputs: undefined,
              wasInterrupted,
            }
          : m
      )
    })

    // Fetch usage metadata and generate public share link if we have a runId
    // LangSmith tracing is handled server-side via traceMetadata; no client-side fetch needed.

    // Notify stream end (used by voice agent to finalize TTS)
    onStreamEnd?.()

    return { assistantContent, runId }
  }, [client, threadId, setMessages, agentConfig, agentProfile, userId, userEmail, userName, conversationSource, onTextChunk, onStreamEnd])

  return { processStream }
}
