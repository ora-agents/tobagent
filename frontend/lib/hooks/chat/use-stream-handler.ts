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

const BRIEF_AGENT_STEPS = {
  thinking: "Understanding request",
  context: "Checking context",
  subagents: "Consulting linked agents",
} as const

function addBriefStep(steps: string[], step: string): boolean {
  if (steps.includes(step)) return false
  steps.push(step)
  return true
}

function getToolCallStepName(toolName: string): string {
  return `Tool: ${toolName}`
}

function getToolCallName(toolCall: any): string | undefined {
  const name = toolCall?.name || toolCall?.function?.name
  return typeof name === "string" && name.trim() ? name : undefined
}

function getChunkToolCalls(chunk: any): any[] {
  if (!chunk || typeof chunk !== "object") return []

  return [
    ...(Array.isArray(chunk.tool_calls) ? chunk.tool_calls : []),
    ...(Array.isArray(chunk.tool_call_chunks) ? chunk.tool_call_chunks : []),
    ...(Array.isArray(chunk.additional_kwargs?.tool_calls)
      ? chunk.additional_kwargs.tool_calls
      : []),
    ...(Array.isArray(chunk.kwargs?.tool_calls) ? chunk.kwargs.tool_calls : []),
    ...(Array.isArray(chunk.kwargs?.tool_call_chunks)
      ? chunk.kwargs.tool_call_chunks
      : []),
  ]
}

function isSubagentToolName(name?: string): boolean {
  return name === "task" || !!name?.startsWith("call_agent_")
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

function mergeStreamedContent(currentContent: string, streamedContent: string): string {
  if (!streamedContent) return currentContent
  if (!currentContent) return streamedContent
  if (streamedContent.startsWith(currentContent)) return streamedContent
  return currentContent + streamedContent
}

function findFinalAssistantMessage(messages: any[], userContent: string): any | undefined {
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

  if (!foundCurrentUser) return undefined

  const candidates = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages
  return [...candidates].reverse().find((msg: any) =>
    isAssistantMessage(msg) &&
    !hasToolCalls(msg) &&
    extractTextFromContent(msg.content).trim()
  )
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

      const model = (agentConfig?.model ?? getDefaultModel()) as ModelOption
      const recursionLimit = agentConfig?.recursionLimit ?? 100

      let assistantContent = ""
      let assistantToolCalls: ToolCall[] = []
      let runId: string | undefined = undefined
      let hasSeenNewResponse = false
      let currentUserCheckpointId: string | undefined = options?.checkpointId
      let finalAssistantCheckpointId: string | undefined

      const isCustomProfile = !!agentProfile
      const agentType = "generic_agent"
      const repos = agentConfig?.repos ?? []

      // Trace metadata for LangSmith observability
      const traceMetadata = {
        user_id: userId || "unknown",
        ...(userEmail && userEmail !== userId ? { user_email: userEmail } : {}),
        ...(userName && !userName.startsWith("User") ? { user_name: userName } : {}),
        source_type: "Chat-LangChain",
        graph: agentType,
      }

      // Build runtime context for the graph context_schema.
      const contextBase: Record<string, unknown> = { model, user_id: userId }
      if (isCustomProfile && agentProfile) {
        contextBase.agent_id = agentProfile.id
      } else if (repos.length > 0) {
        contextBase.repos = repos
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
      if (existingMessage?.toolCalls) {
        assistantToolCalls = existingMessage.toolCalls.filter(
          (toolCall) => !isSubagentToolName(toolCall.name)
        )
      }
      if (existingMessage?.subgraphOutputs || existingMessage?.toolCalls) {
        setMessages((prev) =>
          updateMessageInList(prev, assistantMessageId, {
            toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
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
                      assistantToolCalls.push({
                        id: toolCall.id,
                        name: toolCall.name,
                        args: toolCall.args,
                      })
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

                const toolCall = assistantToolCalls.find(
                  (tc) => tc.id === msg.tool_call_id
                )
                if (toolCall && msg.content) {
                  toolCall.output =
                    typeof msg.content === "string"
                      ? msg.content
                      : JSON.stringify(msg.content)
                }
              }
            })
          }
        }

        queueMessageUpdate((prev) => {
          const existing = prev.find((m) => m.id === assistantMessageId)
          const thinkingSteps = existing?.thinkingSteps || []
          const thinkingStartTime = existing?.thinkingStartTime || Date.now()
          let hasNewSteps = false

          // Track only high-level progress. Internal node names are too noisy
          // for the chat UI and can expose implementation details.
          if ((eventType === "updates" || baseEvent === "updates") && data) {
            const nodeNames = Object.keys(data)
            const hasContextStep = nodeNames.some(
              (nodeName) =>
                nodeName !== "agent" &&
                nodeName !== "model" &&
                nodeName !== "tools" &&
                !nodeName.includes("Middleware")
            )
            if (hasContextStep) {
              hasNewSteps =
                addBriefStep(thinkingSteps, BRIEF_AGENT_STEPS.context) || hasNewSteps
            }
          }

          // Check for AI thinking
          if (
            (eventType === "updates" || baseEvent === "updates") &&
            (data?.agent || data?.model) &&
            !data?.tools
          ) {
            hasNewSteps =
              addBriefStep(thinkingSteps, BRIEF_AGENT_STEPS.thinking) || hasNewSteps
          }

        // Detect subagent execution (single or parallel)
        const agentMessages = data?.agent?.messages || data?.model?.messages
        if (agentMessages && Array.isArray(agentMessages)) {
          agentMessages.forEach((msg: any) => {
            if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
              const taskTools = msg.tool_calls.filter((tc: any) => tc.name === "task")

              if (taskTools.length > 0) {
                hasNewSteps =
                  addBriefStep(thinkingSteps, BRIEF_AGENT_STEPS.subagents) ||
                  hasNewSteps
              }

              const regularToolCalls = msg.tool_calls.filter(
                (tc: any) => !isSubagentToolName(tc.name)
              )
              regularToolCalls.forEach((toolCall: any) => {
                const toolName = getToolCallName(toolCall)
                if (toolName) {
                  hasNewSteps =
                    addBriefStep(thinkingSteps, getToolCallStepName(toolName)) ||
                    hasNewSteps
                }
              })
            }
          })
        }

        if (eventType === "events") {
          const aiChunk = getEventMessageChunk(data)
          getChunkToolCalls(aiChunk).forEach((toolCall: any) => {
            const toolName = getToolCallName(toolCall)
            if (toolName && !isSubagentToolName(toolName)) {
              hasNewSteps =
                addBriefStep(thinkingSteps, getToolCallStepName(toolName)) || hasNewSteps
            }
          })
        }

        // Always ensure message exists with thinking state
        if (!existing) {
          return [
            ...prev,
            {
              id: assistantMessageId,
              role: "assistant" as const,
              content: "",
              timestamp: new Date(),
              isThinking: true,
              thinkingSteps: [...thinkingSteps],
              thinkingStartTime,
            },
          ]
        } else if (hasNewSteps) {
          return prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  isThinking: true,
                  thinkingSteps: [...thinkingSteps],
                  thinkingStartTime,
                }
              : m
          )
        }
        return prev
      })

      // Handle "values" mode - final state with complete output
      // IMPORTANT: Skip subgraph events to avoid showing subagent content in main chat
      if (eventType === "values" && !isSubgraphEvent && data?.messages && Array.isArray(data.messages)) {
        const finalAIMessage = findFinalAssistantMessage(data.messages, userContent)

        const finalContent = finalAIMessage?.content ? extractTextFromContent(finalAIMessage.content) : ""

        // Use final values as the authoritative fallback. This keeps the UI
        // populated when the server emits no main-agent token tuples while
        // still ignoring metadata-free partial aggregates.
        if (finalContent && finalContent !== assistantContent) {
          const delta = finalContent.slice(assistantContent.length)
          assistantContent = finalContent

          if (delta && onTextChunk) {
            onTextChunk(delta)
          }

          queueMessageUpdate((prev) => {
            const baseMessage: Message = {
              id: assistantMessageId,
              role: "assistant",
              content: assistantContent,
              timestamp: new Date(),
              isThinking: true,
            }

            const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
            return updateMessageInList(withMessage, assistantMessageId, {
              content: assistantContent,
              isThinking: true,
            })
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
            hasSeenNewResponse = true // Mark that we've seen new content

            // Notify TTS with the new text delta
            if (delta && onTextChunk) {
              onTextChunk(delta)
            }

            queueMessageUpdate((prev) => {
              const baseMessage: Message = {
                id: assistantMessageId,
                role: "assistant",
                content: assistantContent,
                timestamp: new Date(),
                isThinking: true,
              }

              const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
              return updateMessageInList(withMessage, assistantMessageId, {
                content: assistantContent,
                isThinking: true,
              })
            })
          }
        }
      }

      // Capture tool calls (NOT content - content comes from "values" event)
      // Support both agent (deepagent) and model (create_agent) nodes
      const agentMessages = data?.agent?.messages || data?.model?.messages
      if ((eventType === "updates" || baseEvent === "updates") && agentMessages && Array.isArray(agentMessages)) {
        agentMessages.forEach((msg: any) => {
          if (msg.type === "ai" && msg.tool_calls?.length > 0) {
            assistantToolCalls = msg.tool_calls.filter(
              (toolCall: any) => !isSubagentToolName(toolCall.name)
            )
          }
        })

        if (assistantToolCalls.length > 0) {
          queueMessageUpdate((prev) => {
            const baseMessage: Message = {
              id: assistantMessageId,
              role: "assistant",
              content: "",
              timestamp: new Date(),
              toolCalls: assistantToolCalls,
              isThinking: true,
            }

            const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
            return updateMessageInList(withMessage, assistantMessageId, {
              toolCalls: assistantToolCalls,
              isThinking: true,
            })
          })
        }
      }
    }

    flushQueuedMessageUpdates()

    // Check if stream was interrupted
    const wasInterrupted = shouldInterruptRef?.current || false

    // Mark as complete after stream ends
    setMessages((prev) => {
      const existing = prev.find((m) => m.id === assistantMessageId)
      const thinkingDuration = existing?.thinkingStartTime
        ? Date.now() - existing.thinkingStartTime
        : undefined

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
  }, [client, threadId, setMessages, agentConfig, agentProfile, userId, userEmail, userName, onTextChunk, onStreamEnd])

  return { processStream }
}
