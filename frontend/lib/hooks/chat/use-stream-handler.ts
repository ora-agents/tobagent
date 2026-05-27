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
 * - Processes multiple stream modes: values, updates, messages, messages/partial
 * - Filters subgraph events to show only main agent responses
 * - Tracks execution state across streaming events
 */

import { useCallback } from "react"
import { Client } from "@langchain/langgraph-sdk"
import type {
  Message,
  ToolCall,
  SubgraphOutput,
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

function describeToolStep(name: string, args: Record<string, any> = {}): string {
  if (args.query && name === "search_docs_by_lang_chain") {
    const query = args.query.length > 40 ? args.query.substring(0, 40) + "..." : args.query
    return `Searching documentation for "${query}"`
  }
  if (name === "query_docs_filesystem_docs_by_lang_chain") {
    return "Reading documentation"
  }
  if (args.collections && name === "search_support_articles") {
    return `Searching support articles (${args.collections})`
  }
  if (args.article_id && name === "get_support_article_content") {
    return "Reading support articles"
  }
  if (name === "fetch_langchain_pricing") {
    return "Fetching LangChain pricing"
  }
  if (name === "check_links") {
    return "Checking documentation links"
  }

  return name
}

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the useStreamHandler hook.
 */
interface UseStreamHandlerProps {
  client: Client | null
  threadId: string
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
    images?: ImageAttachment[]
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
   * - Processing various stream event types (values, updates, messages, messages/partial)
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
    async (userContent: string, assistantMessageId: string, images?: ImageAttachment[]) => {
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

      const input = {
        messages: [{ role: "user", content: messageContent }],
      }

      const model = (agentConfig?.model ?? getDefaultModel()) as ModelOption
      const recursionLimit = agentConfig?.recursionLimit ?? 100

      let assistantContent = ""
      let assistantToolCalls: ToolCall[] = []
      let runId: string | undefined = undefined
      let hasSeenNewResponse = false

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

      // Build configurable dict
      const configurableBase: Record<string, unknown> = { model }
      if (isCustomProfile && agentProfile) {
        configurableBase.system_prompt = agentProfile.systemPrompt
        configurableBase.enabled_tools = agentProfile.enabledTools
        configurableBase.agent_id = agentProfile.id
        configurableBase.agent_ids = (agentProfile as any).agentIds || []
      } else if (repos.length > 0) {
        configurableBase.repos = repos
      }

      // Always inject user preferences and safety flag
      if (userPreferences) {
        configurableBase.user_preferences = userPreferences
      }
      if (safetyEnabled) {
        configurableBase.safety_enabled = true
      }

      const streamResponse = client.runs.stream(threadId, agentType, {
        input,
        config: {
          recursion_limit: recursionLimit,
          tags: ["Chat-LangChain", agentType],
          metadata: traceMetadata,
          configurable: configurableBase,
        } as any,
        streamMode: ["values", "updates", "messages"],
        streamSubgraphs: true,
        ifNotExists: "create",
      })

      // Initialize from existing message data if resuming
      let existingMessage: Message | undefined
      setMessages((prev) => {
        existingMessage = prev.find((m) => m.id === assistantMessageId)
        return prev
      })

      const subgraphOutputs: SubgraphOutput[] = existingMessage?.subgraphOutputs
        ? [...existingMessage.subgraphOutputs]
        : []

      // Restore tool calls from existing message
      if (existingMessage?.toolCalls) {
        assistantToolCalls = [...existingMessage.toolCalls]
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
        const eventParts = eventType.split("|")
        const baseEvent = eventParts[0]

        // Track subgraph outputs when they complete or stream
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
                    assistantToolCalls.push({
                      id: toolCall.id,
                      name: toolCall.name,
                      args: toolCall.args,
                    })
                  }

                  // Track task tool calls for subgraph outputs
                  if (toolCall.name === "task") {
                    const subagentName =
                      toolCall.args?.subagent_type || "subagent-task"
                    const existingOutput = subgraphOutputs.find(
                      (o) => o.toolCallId === toolCall.id
                    )

                    if (!existingOutput) {
                      subgraphOutputs.push({
                        name: subagentName,
                        output: "",
                        timestamp: Date.now(),
                        toolCallId: toolCall.id,
                        isStreaming: true,
                        isComplete: false,
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
                // Handle task tools (subagents) separately
                if (msg.name === "task" && msg.content) {
                  const existingOutput = subgraphOutputs.find(
                    (output) => output.toolCallId === msg.tool_call_id
                  )

                  if (existingOutput) {
                    existingOutput.output =
                      typeof msg.content === "string"
                        ? msg.content
                        : JSON.stringify(msg.content)
                    existingOutput.isStreaming = false
                    existingOutput.isComplete = true
                  } else {
                    const toolCall = assistantToolCalls.find(
                      (tc) => tc.id === msg.tool_call_id
                    )
                    const subagentName =
                      toolCall?.args?.subagent_type || "subagent-task"

                    const taskOutput = {
                      name: subagentName,
                      output:
                        typeof msg.content === "string"
                          ? msg.content
                          : JSON.stringify(msg.content),
                      timestamp: Date.now(),
                      toolCallId: msg.tool_call_id,
                      isStreaming: false,
                      isComplete: true,
                    }

                    subgraphOutputs.push(taskOutput)
                  }
                }
                // Handle regular tools (attach output to tool call)
                else {
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
              }
            })
          }
        }

        setMessages((prev) => {
          const existing = prev.find((m) => m.id === assistantMessageId)
          const thinkingSteps = existing?.thinkingSteps || []
          const thinkingStartTime = existing?.thinkingStartTime || Date.now()
          let hasNewSteps = false
          let hasNewSubgraphOutputs = false

          if (subgraphOutputs.length > 0) {
            const existingOutputCount = existing?.subgraphOutputs?.length || 0
            if (subgraphOutputs.length > existingOutputCount) {
              hasNewSubgraphOutputs = true
            }
          }

          // Track node executions from updates (skip 'agent', 'model', 'tools', and middleware nodes)
          if ((eventType === "updates" || baseEvent === "updates") && data) {
            Object.keys(data).forEach((nodeName) => {
              if (
                nodeName === "agent" ||
                nodeName === "model" ||
                nodeName === "tools" ||
                nodeName.includes("Middleware")  // Skip all middleware nodes
              )
                return

              const stepDesc = `Node: ${nodeName}`
              const alreadyExists = thinkingSteps.some((s) => s === stepDesc)
              if (!alreadyExists) {
                thinkingSteps.push(stepDesc)
                hasNewSteps = true
              }
            })
          }

          // Check for AI thinking
          if (
            (eventType === "updates" || baseEvent === "updates") &&
            (data?.agent || data?.model) &&
            !data?.tools
          ) {
            const aiThinkingStep = "Planning next steps..."
            if (!thinkingSteps.some((s) => s === "Planning next steps...")) {
              thinkingSteps.push(aiThinkingStep)
              hasNewSteps = true
            }
          }

        // Detect subagent execution (single or parallel)
        const agentMessages = data?.agent?.messages || data?.model?.messages
        if (agentMessages && Array.isArray(agentMessages)) {
          agentMessages.forEach((msg: any) => {
            if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
              const taskTools = msg.tool_calls.filter((tc: any) => tc.name === "task")

              // Show message for subagents (task tools)
              if (taskTools.length > 0) {
                const subagentNames = taskTools
                  .map((tc: any) => tc.args?.subagent_type || "subagent")
                  .join(", ")

                const parallelStep = taskTools.length > 1
                  ? `Calling ${taskTools.length} subagents in parallel: ${subagentNames}`
                  : `Calling subagent: ${subagentNames}`

                if (!thinkingSteps.includes(parallelStep)) {
                  thinkingSteps.push(parallelStep)
                  hasNewSteps = true
                }
              }

              msg.tool_calls
                .filter((tc: any) => tc.name !== "task")
                .forEach((toolCall: any) => {
                  const stepDesc = describeToolStep(toolCall.name, toolCall.args || {})
                  if (!thinkingSteps.includes(stepDesc)) {
                    thinkingSteps.push(stepDesc)
                    hasNewSteps = true
                  }
                })
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
              subgraphOutputs: subgraphOutputs.length > 0 ? [...subgraphOutputs] : [],
            },
          ]
        } else if (hasNewSteps || hasNewSubgraphOutputs) {
          return prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  isThinking: true,
                  thinkingSteps: [...thinkingSteps],
                  thinkingStartTime,
                  subgraphOutputs: [...subgraphOutputs],
                }
              : m
          )
        }
        return prev
      })

      // Handle "values" mode - final state with complete output
      // IMPORTANT: Skip subgraph events to avoid showing subagent content in main chat
      if (eventType === "values" && !isSubgraphEvent && data?.messages && Array.isArray(data.messages)) {
        // Find the last assistant message
        const finalAIMessage = [...data.messages].reverse().find((msg: any) =>
          msg.type === "ai" || msg.role === "assistant"
        )

        const finalContent = finalAIMessage?.content ? extractTextFromContent(finalAIMessage.content) : ""
        const hasFinalMessage = !finalAIMessage?.tool_calls || finalAIMessage.tool_calls.length === 0

        // IMPORTANT: Skip subagent responses (they typically start with JSON like '{"answer":')
        const looksLikeSubagentResponse = finalContent.trim().startsWith('{') || finalContent.trim().startsWith('{"answer')

        // Only set content if:
        // 1. We have final content
        // 2. No pending tool calls
        // 3. Haven't set content yet
        // 4. Not a subagent response
        // 5. We've seen NEW streaming content for this request (prevents using old thread history)
        if (finalContent && hasFinalMessage && !looksLikeSubagentResponse && hasSeenNewResponse && !assistantContent) {
          assistantContent = finalContent

          setMessages((prev) => {
            const baseMessage: Message = {
              id: assistantMessageId,
              role: "assistant",
              content: assistantContent,
              timestamp: new Date(),
              isThinking: true,
              subgraphOutputs: [...subgraphOutputs],
            }

            const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
            return updateMessageInList(withMessage, assistantMessageId, {
              content: assistantContent,
              isThinking: true,
              subgraphOutputs: [...subgraphOutputs],
            })
          })
        }
      }

      // Handle streaming messages - show progressive tokens
      // Try both "messages/partial" and "messages" event types
      // IMPORTANT: Skip subgraph events (they have "|" in the event type)
      if ((eventType === "messages/partial" || eventType === "messages") && !isSubgraphEvent && data) {
        // Handle both array and tuple formats
        let aiChunk: any
        if (Array.isArray(data)) {
          aiChunk = data.find((msg: any) => msg.type === "ai" || msg.role === "assistant")
        } else if (data && typeof data === 'object') {
          // Sometimes data is a tuple [message, metadata]
          if (data[0]) aiChunk = data[0]
          else aiChunk = data
        }

        if (aiChunk?.content) {
          const streamedContent = extractTextFromContent(aiChunk.content)

          // IMPORTANT: Skip subagent responses (they typically start with JSON like '{"answer":')
          const looksLikeSubagentResponse = streamedContent.trim().startsWith('{') || streamedContent.trim().startsWith('{"answer')
          if (looksLikeSubagentResponse) {
            continue
          }

          // Only update if we have content and no pending tool calls (check array length)
          const hasPendingToolCalls = aiChunk.tool_calls && Array.isArray(aiChunk.tool_calls) && aiChunk.tool_calls.length > 0
          if (streamedContent && !hasPendingToolCalls) {
            // Compute text delta for TTS streaming
            const delta = streamedContent.slice(assistantContent.length)
            assistantContent = streamedContent
            hasSeenNewResponse = true // Mark that we've seen new content

            // Notify TTS with the new text delta
            if (delta && onTextChunk) {
              onTextChunk(delta)
            }

            setMessages((prev) => {
              const baseMessage: Message = {
                id: assistantMessageId,
                role: "assistant",
                content: streamedContent,
                timestamp: new Date(),
                isThinking: true,
                subgraphOutputs: [...subgraphOutputs],
              }

              const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
              return updateMessageInList(withMessage, assistantMessageId, {
                content: streamedContent,
                isThinking: true,
                subgraphOutputs: [...subgraphOutputs],
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
            assistantToolCalls = msg.tool_calls
          }
        })

        if (assistantToolCalls.length > 0) {
          setMessages((prev) => {
            const baseMessage: Message = {
              id: assistantMessageId,
              role: "assistant",
              content: "",
              timestamp: new Date(),
              toolCalls: assistantToolCalls,
              isThinking: true,
              subgraphOutputs: [...subgraphOutputs],
            }

            const withMessage = ensureMessageExists(prev, assistantMessageId, baseMessage)
            return updateMessageInList(withMessage, assistantMessageId, {
              toolCalls: assistantToolCalls,
              isThinking: true,
              subgraphOutputs: [...subgraphOutputs],
            })
          })
        }
      }
    }

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
              subgraphOutputs: subgraphOutputs.length > 0 ? subgraphOutputs : undefined,
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
