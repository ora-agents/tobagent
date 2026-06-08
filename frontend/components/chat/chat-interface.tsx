"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import type { ClientProfile } from "@/lib/hooks"
import { Client } from "@langchain/langgraph-sdk"
import type { Message, ImageAttachment } from "@/lib/types"
import { createUserMessage, generateMessageId, extractTextFromContent } from "@/lib/utils/chat"
import { truncate } from "@/lib/utils/string"
import { useStreamHandler, useChatState } from "@/lib/hooks/chat"
import { useUserId } from "@/lib/hooks/auth"
import { useAuth } from "@/components/providers/auth-provider"
import { useFileUpload } from "@/lib/hooks/files"
import { useVoiceAgent } from "@/lib/hooks/files/use-voice-agent"
import { MessageList } from "./message-list"
import { WelcomeScreen } from "./features/welcome-screen"
import { ChatInput } from "./chat-input"
import { VoiceMiniPanel } from "./features/voice-mini-panel"
import type { AgentConfig } from "@/components/layout/agent-settings"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { LANGGRAPH_API_URL, LANGSMITH_API_KEY } from "@/lib/constants/api"
import {
  INPUT_TOO_LONG_MESSAGE,
  MAX_INPUT_CHARS,
} from "@/lib/constants/features"
import { isAndroidWebView } from "@/lib/voice/utils/browser"
import { useT } from "@/lib/i18n"

// Enhanced scrollbar styles with smooth transitions
const scrollbarStyles = `
  .custom-scrollbar {
    scroll-behavior: smooth;
    will-change: scroll-position;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(204, 120, 92, 0.4);
    border-radius: 3px;
    transition: background 0.2s ease;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(204, 120, 92, 0.6);
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:active {
    background: rgba(204, 120, 92, 0.8);
  }
`

interface ChatInterfaceProps {
  showToolCalls?: boolean
  threadId: string | null
  onCreateThread?: () => string
  onThreadUpdate?: (threadId: string, title: string, lastMessage: string, client?: ClientProfile, messageCount?: number) => void
  onThreadNotFound?: () => void
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  /** Custom agent profile; when set, the generic_agent graph is used instead. */
  agentProfile?: AgentProfile | null
  agentProfilesLoaded?: boolean
  isNewThread?: boolean
  customTitle?: string | null
  /** Pre-fill or auto-send a message. Use with autoSend to control behavior. */
  initialMessage?: string | null
  /** If true, initialMessage is sent immediately. If false, it just populates the input. */
  autoSend?: boolean
  /** Called after auto-send completes (use to clear URL params, etc.) */
  onInitialMessageSent?: () => void
  agentProfiles?: AgentProfile[]
  onAgentProfileChange?: (id: string | null) => void
  onCreateAgent?: () => void
}

interface QueuedMessage {
  content: string
  files: ImageAttachment[]
  userMessage: Message
  threadId: string
}

const toLangGraphMessages = (messages: Message[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))

export function ChatInterface({
  showToolCalls = false,
  threadId,
  onCreateThread,
  onThreadUpdate,
  onThreadNotFound,
  initialMessage,
  customTitle,
  agentConfig,
  onAgentConfigChange,
  agentProfile,
  agentProfilesLoaded = true,
  isNewThread = false,
  autoSend = false,
  onInitialMessageSent,
  agentProfiles,
  onAgentProfileChange,
  onCreateAgent,
}: ChatInterfaceProps) {
  const t = useT()
  // ============================================================================
  // State Management
  // ============================================================================

  const [messages, setMessages] = useState<Message[]>([])
  const threadStorageKey = threadId ?? "new"
  const activeThreadIdRef = useRef<string | null>(threadId)

  // UI state with reducer
  const { state: uiState, dispatch: uiDispatch, setInput } = useChatState(threadStorageKey)
  const [inputError, setInputError] = useState<string | null>(null)
  const inputLengthRef = useRef(uiState.input.length)

  // File upload state
  const {
    attachedFiles,
    uploadError,
    isDragging,
    handleFileSelect,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    removeFile,
    clearFiles,
    setUploadError,
  } = useFileUpload({
    getInputLength: () => inputLengthRef.current,
    disableImageUploads: false,
  })
  const attachedTextLength = attachedFiles.reduce((total, file) => {
    if (file.mimeType?.startsWith('image/')) return total
    return total + (file.textLength ?? 0)
  }, 0)
  const attachedTextLengthRef = useRef(attachedTextLength)
  attachedTextLengthRef.current = attachedTextLength

  // Message queue for sending while AI is responding
  const messageQueueRef = useRef<QueuedMessage[]>([])
  const isProcessingQueueRef = useRef(false)
  const [queuedMessagesDisplay, setQueuedMessagesDisplay] = useState<{ content: string; id: string }[]>([])

  const setLimitedInput = useCallback((value: string) => {
    const maxInputLength = Math.max(0, MAX_INPUT_CHARS - attachedTextLengthRef.current)
    if (value.length > maxInputLength) {
      setInputError(INPUT_TOO_LONG_MESSAGE)
      setInput(value.slice(0, maxInputLength))
      return
    }

    setInputError(null)
    setInput(value)
  }, [setInput])

  // Voice input - use cloud-based voice agent with ASR/TTS
  // Use ref for handleStop so the voice agent can interrupt the stream
  const handleStopRef = useRef<() => void>(() => {})

  useEffect(() => {
    activeThreadIdRef.current = threadId
  }, [threadId])

  const ensureThreadId = useCallback(() => {
    if (activeThreadIdRef.current) {
      return activeThreadIdRef.current
    }

    const createdThreadId = onCreateThread?.()
    if (!createdThreadId) {
      throw new Error("Unable to create a conversation thread")
    }

    activeThreadIdRef.current = createdThreadId
    return createdThreadId
  }, [onCreateThread])

  const createForkThreadId = useCallback(() => {
    const createdThreadId = onCreateThread?.()
    if (!createdThreadId) {
      throw new Error("Unable to create a forked conversation thread")
    }

    activeThreadIdRef.current = createdThreadId
    return createdThreadId
  }, [onCreateThread])

  const voiceAgent = useVoiceAgent({
    onSendMessage: (text) => {
      // Send the voice transcript directly — do NOT go through setInput +
      // setTimeout + handleSend, which is a race condition (handleSend reads
      // uiState.input from its closure, and the state update may not have
      // flushed yet, causing it to see an empty input and bail out).
      const trimmed = text.trim()
      if (!trimmed || !userId || !client) return
      let targetThreadId: string
      try {
        targetThreadId = ensureThreadId()
      } catch (error) {
        console.error("Failed to create thread for voice message:", error)
        return
      }

      const userMessage = createUserMessage(trimmed)

      // If agent is still responding and wasn't interrupted by voice, queue
      if (uiState.isLoading && !voiceInterruptRef.current) {
        messageQueueRef.current.push({
          content: trimmed,
          files: [],
          userMessage,
          threadId: targetThreadId,
        })
        setQueuedMessagesDisplay(prev => [...prev, { content: trimmed, id: userMessage.id }])
        return
      }
      voiceInterruptRef.current = false

      // Show message in chat and process immediately
      setMessages((prev) => [...prev, userMessage])
      processMessage(trimmed, [], userMessage, targetThreadId)
    },
    onInterrupt: () => {
      handleStopRef.current()
    },
    onInterimTranscript: (text) => {
      // Show real-time ASR transcript in the input box
      setLimitedInput(text)
    },
    wakeWords: agentProfile?.wakeWords || [],
    ttsVoice: agentProfile?.ttsVoice || null,
  })
  const suppressAndroidVoiceAutoFocus = isAndroidWebView() && voiceAgent.voiceState !== "idle"
  // ============================================================================
  // Refs
  // ============================================================================

  // Create a ref to control stream interruption
  const shouldInterruptRef = useRef(false)

  // Synchronous flag set by handleStop, consumed by handleSend.
  // Prevents voice messages from being queued when the user interrupts
  // the agent — isLoading may still be true because FINISH_SEND fires
  // asynchronously after the stream break.
  const voiceInterruptRef = useRef(false)

  // File input ref for triggering file selection
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Textarea ref for auto-focus
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Track previous loading state to detect completion of AI response
  const prevIsLoadingRef = useRef(false)

  // ============================================================================
  // User Information
  // ============================================================================

  // Get user information for tracking in LangSmith
  const userId = useUserId()

  // Create stable client instance with user authentication
  // Recreate when userId changes to update auth headers
  const client = useMemo(() => {
    if (!userId) {
      // Don't create client until userId is available
      // This prevents creating a client without auth headers
      return null
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${userId}`,
    }

    return new Client({
      apiUrl: LANGGRAPH_API_URL,
      apiKey: LANGSMITH_API_KEY,
      defaultHeaders: headers,
    })
  }, [userId])

  // Memoize user metadata to prevent unnecessary re-renders
  const userEmail = useMemo(
    () => userId || null,
    [userId]
  )
  const userName = useMemo(
    () => (userId ? `User ${userId.slice(0, 8)}` : null),
    [userId]
  )

  // Get user preferences from auth context for prompt injection
  const { user: authUser } = useAuth()
  const userPreferences = authUser?.preferences || null
  const safetyEnabled = authUser?.safetyEnabled || false

  // ============================================================================
  // Custom Hooks
  // ============================================================================

  const { processStream } = useStreamHandler({
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
    onTextChunk: voiceAgent.feedTtsChunk,
    onStreamEnd: voiceAgent.onAgentStreamEnd,
  })

  // ============================================================================
  // Effects
  // ============================================================================

  // Restore draft when switching threads
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Check if there's an initial message (from ticket page, etc.)
    // If so, let that take precedence on first load
    if (initialMessage && !uiState.hasAutoSent) {
      return
    }

    const draft = localStorage.getItem(`draft-${threadStorageKey}`)
    if (draft) {
      setLimitedInput(draft)
    } else {
      // Clear input when switching to thread with no draft
      setLimitedInput('')
    }
  }, [threadStorageKey, initialMessage, uiState.hasAutoSent, setLimitedInput])

  // Track if we've sent a message on the current thread to skip unnecessary reloads
  const hasSentMessageRef = useRef<string | null>(null)
  const autoSentPromptRef = useRef<string | null>(null)

  // Load conversation history when threadId changes
  useEffect(() => {
    // Capture the current threadId to prevent race conditions
    const currentThreadId = threadId

    const loadThreadHistory = async () => {
      if (!currentThreadId) {
        console.log('No thread selected - showing blank chat')
        hasSentMessageRef.current = null
        setMessages([])
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        return
      }

      // Skip reload if we just sent a message on this thread - client state is authoritative
      // This prevents race conditions where history reload overwrites trace URLs
      if (hasSentMessageRef.current === currentThreadId) {
        console.log('Skipping reload - we just sent a message on this thread')
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        return
      }

      // Skip loading for new threads - they don't exist in backend yet
      if (isNewThread) {
        console.log('New thread detected - skipping backend load')
        setMessages([])
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        return
      }

      if (!LANGGRAPH_API_URL) {
        console.error("Missing NEXT_PUBLIC_LANGGRAPH_API_URL; cannot load thread history")
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        return
      }

      // Wait for client to be ready (userId must be loaded first)
      if (!client) {
        console.log('Client not ready yet (waiting for userId)')
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        return
      }

      try {
        console.log('Loading thread history for:', currentThreadId)
        const state = await client.threads.getState(currentThreadId).catch((err) => {
          // 403 means auth issue (shouldn't happen after our fixes, but handle gracefully)
          if (err?.response?.status === 403 || err?.status === 403) {
            console.error('Authorization error loading thread:', err)
            // Notify parent to navigate to most recent thread
            onThreadNotFound?.()
            return null
          }

          // 404 means thread doesn't exist OR user doesn't have access
          if (err?.response?.status === 404 || err?.status === 404) {
            console.log('Thread not found (404) - may not exist or access denied')
            // Notify parent to navigate to most recent thread
            onThreadNotFound?.()
            return null
          }

          // Other errors - log but continue with empty thread
          console.error('Error fetching thread state:', err)
          return null
        })

        if (!state) {
          // Thread doesn't exist or wasn't accessible - start fresh
          console.log('No thread state found - starting with empty thread')
          setMessages([])
          uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
          return
        }

        const threadMessages = (state.values as any)?.messages || []
        if (threadMessages.length === 0) {
          // Thread exists but has no messages - clear messages
          console.log('Thread exists but has no messages')
          setMessages([])
          uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
          return
        }

        const checkpointsByMessageId = new Map<string, { checkpointId: string; parentCheckpointId?: string }>()
        const checkpointsByContent = new Map<string, { checkpointId: string; parentCheckpointId?: string }>()
        try {
          const history = await client.threads.getHistory(currentThreadId)
          const chronologicalHistory = [...history].reverse()

          for (const checkpointState of chronologicalHistory) {
            const stateAny = checkpointState as any
            const checkpointId =
              stateAny.config?.configurable?.checkpoint_id ||
              stateAny.metadata?.checkpoint_id
            if (!checkpointId) continue

            const parentCheckpointId =
              stateAny.parent_config?.configurable?.checkpoint_id ||
              stateAny.metadata?.parent_checkpoint_id
            const stateMessages = stateAny.values?.messages || []
            if (!Array.isArray(stateMessages) || stateMessages.length === 0) continue

            const lastMessage = stateMessages[stateMessages.length - 1]
            const rawRole = lastMessage?.type || lastMessage?.role
            const role = rawRole === "ai" || rawRole === "assistant" ? "assistant" : "user"
            if (!["human", "user", "ai", "assistant"].includes(rawRole)) continue

            const content = extractTextFromContent(lastMessage.content)
            if (!content.trim()) continue

            const checkpointInfo = { checkpointId, parentCheckpointId }
            if (lastMessage.id) {
              checkpointsByMessageId.set(lastMessage.id, checkpointInfo)
            }
            checkpointsByContent.set(`${role}:${content}`, checkpointInfo)
          }
        } catch (error) {
          console.warn("Failed to load checkpoint metadata for thread history:", error)
        }

        const convertedMessages: Message[] = threadMessages
          .filter((msg: any) => {
            const msgType = msg.type || msg.role
            return ["human", "user", "ai", "assistant"].includes(msgType)
          })
          .map((msg: any, idx: number) => {
            // Create a stable ID for historical messages
            const messageId = msg.id || `history-${currentThreadId}-${idx}-${msg.content?.slice(0, 20)}`

            const role = (msg.type === "ai" || msg.role === "assistant") ? "assistant" : "user"

            const checkpointInfo =
              checkpointsByMessageId.get(messageId) ||
              checkpointsByContent.get(`${role}:${extractTextFromContent(msg.content)}`)

            return {
              id: messageId,
              role,
              content: extractTextFromContent(msg.content),
              timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
              toolCalls: msg.tool_calls,
              runId: msg.run_id,
              checkpointId: checkpointInfo?.checkpointId,
              parentCheckpointId: checkpointInfo?.parentCheckpointId,
              thinkingDuration: msg.response_metadata?.thinking_duration,
              // Preserve images/attachments
              images: msg.images,
            }
          })
          .filter((msg: Message) => msg.content.trim().length > 0)
          .reduce((acc: Message[], msg: Message, idx: number, arr: Message[]) => {
            // For consecutive AI messages, only keep the LAST one in the group
            if (msg.role === "assistant") {
              const nextMsg = arr[idx + 1]
              if (nextMsg && nextMsg.role === "assistant") {
                return acc
              }
            }
            return [...acc, msg]
          }, [])

        console.log(`SUCCESS: Loaded ${convertedMessages.length} messages from thread history`)

        // Only set messages if we're still on the same thread (prevent race conditions)
        if (currentThreadId === threadId) {
          // Merge with existing messages to preserve client-side metadata (thinkingDuration)
          // This prevents race conditions where history reload overwrites locally-computed metadata
          setMessages(prev => {
            // Build lookup maps by message ID, runId, and content hash (for matching when IDs differ)
            // Client-generated IDs differ from backend IDs, and backend doesn't always have runId
            const existingById = new Map(
              prev.map(m => [m.id, { thinkingDuration: m.thinkingDuration, runId: m.runId }])
            )
            const existingByRunId = new Map(
              prev.filter(m => m.runId).map(m => [m.runId!, { thinkingDuration: m.thinkingDuration, runId: m.runId }])
            )
            // Match by role + content prefix (first 100 chars) as fallback when IDs don't match
            const existingByContent = new Map(
              prev.filter(m => m.role === 'assistant').map(m => [
                `${m.role}:${m.content.slice(0, 100)}`,
                { thinkingDuration: m.thinkingDuration, runId: m.runId }
              ])
            )

            return convertedMessages.map((msg, idx) => {
              // Try to find existing metadata by ID first, then by runId, then by content
              const existingByIdMatch = existingById.get(msg.id)
              const existingByRunIdMatch = msg.runId ? existingByRunId.get(msg.runId) : undefined
              const contentKey = `${msg.role}:${msg.content.slice(0, 100)}`
              const existingByContentMatch = msg.role === 'assistant' ? existingByContent.get(contentKey) : undefined
              const existing = existingByIdMatch || existingByRunIdMatch || existingByContentMatch

              if (existing) {
                return {
                  ...msg,
                  // Preserve runId from existing if backend doesn't have it
                  runId: msg.runId || existing.runId,
                  thinkingDuration: msg.thinkingDuration || existing.thinkingDuration,
                }
              }
              return msg
            })
          })
          uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
        } else {
          console.log(`Discarding messages for ${currentThreadId} - now on ${threadId}`)
          return
        }
      } catch (error) {
        console.error("Unexpected error loading thread history:", error)
        uiDispatch({ type: 'SET_LOADING_THREAD', payload: false })
      }
    }

    // Start loading state
    console.log('Thread ID changed to:', threadId)
    uiDispatch({ type: 'SET_LOADING_THREAD', payload: true })

    // Clear the "sent message" flag if we're switching to a completely different thread
    // (but keep it if it's the same thread - that's the case we want to skip reload)
    if (hasSentMessageRef.current && hasSentMessageRef.current !== threadId) {
      hasSentMessageRef.current = null
    }

    // Load new thread immediately
    loadThreadHistory()
  }, [threadId, client, uiDispatch, isNewThread])


  // Auto-focus textarea when loading completes and userId is available
  useEffect(() => {
    if (suppressAndroidVoiceAutoFocus) return

    if (!uiState.isLoadingThread && userId && textareaRef.current) {
      // Small delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        if (suppressAndroidVoiceAutoFocus) return
        textareaRef.current?.focus()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isLoadingThread, userId, suppressAndroidVoiceAutoFocus])

  // Auto-focus textarea after AI finishes responding
  useEffect(() => {
    if (suppressAndroidVoiceAutoFocus) {
      prevIsLoadingRef.current = uiState.isLoading || uiState.isRegenerating
      return
    }

    // Detect transition from loading (true) to not loading (false)
    const wasLoading = prevIsLoadingRef.current
    const isCurrentlyLoading = uiState.isLoading || uiState.isRegenerating

    // Update the ref for next render
    prevIsLoadingRef.current = isCurrentlyLoading

    // Focus only when transitioning from loading to not loading
    if (wasLoading && !isCurrentlyLoading && userId && textareaRef.current && messages.length > 0) {
      // Small delay to ensure DOM is ready and smooth transition
      const timeoutId = setTimeout(() => {
        if (suppressAndroidVoiceAutoFocus) return
        textareaRef.current?.focus()
      }, 100)
      return () => clearTimeout(timeoutId)
    }
  }, [uiState.isLoading, uiState.isRegenerating, userId, messages.length, suppressAndroidVoiceAutoFocus])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  // Process a single message (used for both immediate send and queue processing)
  const processMessage = useCallback(async (
    content: string,
    files: ImageAttachment[],
    userMessage: Message,
    targetThreadId: string,
  ) => {
    uiDispatch({ type: 'START_SEND' })
    shouldInterruptRef.current = false
    hasSentMessageRef.current = targetThreadId

    try {
      const assistantMessageId = generateMessageId()
      const { assistantContent } = await processStream(
        content,
        assistantMessageId,
        files,
        targetThreadId,
        { userMessageId: userMessage.id },
      )

      if (onThreadUpdate && assistantContent) {
        const firstUserMsg = messages.find((m) => m.role === "user") || userMessage
        const title = customTitle || truncate(firstUserMsg.content, 60) || "New conversation"
        const messageCount = messages.length + 2
        onThreadUpdate(targetThreadId, title, truncate(assistantContent, 100), undefined, messageCount)
      }
    } catch (error) {
      console.error("Error streaming from LangGraph:", error)
      const errorMessage = createUserMessage(`Error: ${error instanceof Error ? error.message : "Failed to connect to the agent"}`)
      errorMessage.role = "assistant"
      setMessages((prev) => [...prev, errorMessage])

      if (onThreadUpdate) {
        const messageCount = messages.length + 2
        onThreadUpdate(targetThreadId, customTitle || truncate(userMessage.content, 60) || "New conversation", truncate(errorMessage.content, 100), undefined, messageCount)
      }
    } finally {
      uiDispatch({ type: 'FINISH_SEND' })
    }
  }, [onThreadUpdate, processStream, messages, customTitle, uiDispatch])

  // Process queued messages one by one
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || messageQueueRef.current.length === 0) return

    isProcessingQueueRef.current = true
    const nextMessage = messageQueueRef.current.shift()!

    // Remove from queue display and add to chat
    setQueuedMessagesDisplay(prev => prev.filter(m => m.id !== nextMessage.userMessage.id))
    setMessages((prev) => [...prev, nextMessage.userMessage])

    await processMessage(
      nextMessage.content,
      nextMessage.files,
      nextMessage.userMessage,
      nextMessage.threadId,
    )

    isProcessingQueueRef.current = false

    // Process next in queue if any
    if (messageQueueRef.current.length > 0) {
      processQueue()
    }
  }, [processMessage])

  // Process queue when AI finishes responding
  useEffect(() => {
    const wasLoading = prevIsLoadingRef.current
    const isCurrentlyLoading = uiState.isLoading || uiState.isRegenerating

    // When loading finishes and there are queued messages, process them
    if (wasLoading && !isCurrentlyLoading && messageQueueRef.current.length > 0) {
      processQueue()
    }
  }, [uiState.isLoading, uiState.isRegenerating, processQueue])

  // Auto-send initial message (for ?q= URL param)
  useEffect(() => {
    const trimmedMessage = initialMessage?.trim()
    if (!trimmedMessage) {
      autoSentPromptRef.current = null
      return
    }

    if (
      autoSentPromptRef.current === trimmedMessage ||
      uiState.isLoadingThread ||
      !userId ||
      !client
    ) {
      return
    }

    if (!agentProfilesLoaded) {
      setLimitedInput(trimmedMessage)
      return
    }

    if (!agentProfile) {
      setInputError(t.selectAgentRequired)
      setLimitedInput(trimmedMessage)
      onCreateAgent?.()
      onInitialMessageSent?.()
      return
    }

    autoSentPromptRef.current = trimmedMessage
    uiDispatch({ type: 'SET_AUTO_SENT', payload: true })
    const cappedMessage = trimmedMessage.slice(0, MAX_INPUT_CHARS)
    if (trimmedMessage.length > MAX_INPUT_CHARS) {
      setInputError(INPUT_TOO_LONG_MESSAGE)
    }

    if (autoSend) {
      let targetThreadId: string
      try {
        targetThreadId = ensureThreadId()
      } catch (error) {
        console.error('Failed to create thread for initial message:', error)
        onInitialMessageSent?.()
        return
      }

      const userMessage = createUserMessage(cappedMessage)
      setMessages((prev) => [...prev, userMessage])
      processMessage(cappedMessage, [], userMessage, targetThreadId)
        .then(() => onInitialMessageSent?.())
        .catch((error) => {
          console.error('Failed to auto-send initial message:', error)
          onInitialMessageSent?.() // Clear URL param even on error to prevent retry loops
        })
    } else {
      // Just populate input (existing behavior for ticket page, etc.)
      setLimitedInput(trimmedMessage)
    }
  }, [initialMessage, autoSend, uiState.isLoadingThread, userId, client, agentProfilesLoaded, agentProfile, setLimitedInput, uiDispatch, processMessage, onInitialMessageSent, ensureThreadId, onCreateAgent, t.selectAgentRequired])

  const handleSend = useCallback(async () => {
    if (!uiState.input.trim() && attachedFiles.length === 0) {
      return
    }

    if (!agentProfile) {
      setInputError(t.selectAgentRequired)
      onCreateAgent?.()
      return
    }

    if (!userId || !client) {
      return
    }

    let targetThreadId: string
    try {
      targetThreadId = ensureThreadId()
    } catch (error) {
      console.error("Failed to create thread for message:", error)
      return
    }

    const userMessage = createUserMessage(uiState.input)
    if (attachedFiles.length > 0) {
      userMessage.images = attachedFiles
    }

    const currentInput = uiState.input
    const currentFiles = [...attachedFiles]

    // Clear input and files immediately
    setInput("")
    setInputError(null)
    clearFiles()

    // If currently loading, queue the message (don't show in chat yet)
    // Skip queue when voice interrupt is in progress (stream is being stopped)
    const wasInterrupted = voiceInterruptRef.current
    voiceInterruptRef.current = false

    if ((uiState.isLoading || uiState.isRegenerating) && !wasInterrupted) {
      const queuedItem = {
        content: currentInput,
        files: currentFiles,
        userMessage,
        threadId: targetThreadId,
      }
      messageQueueRef.current.push(queuedItem)
      setQueuedMessagesDisplay(prev => [...prev, { content: currentInput, id: userMessage.id }])
      return
    }

    // Show message in chat and process immediately
    setMessages((prev) => [...prev, userMessage])
    await processMessage(currentInput, currentFiles, userMessage, targetThreadId)

    // Check if anything was queued while processing
    if (messageQueueRef.current.length > 0) {
      processQueue()
    }
  }, [uiState.input, uiState.isLoading, uiState.isRegenerating, attachedFiles, agentProfile, userId, client, agentConfig?.model, setInput, setUploadError, clearFiles, processMessage, processQueue, ensureThreadId, onCreateAgent, t.selectAgentRequired])

  const handleStop = useCallback(async () => {
    console.log('User requested stop')
    uiDispatch({ type: 'SET_STOPPING', payload: true })
    shouldInterruptRef.current = true
    voiceInterruptRef.current = true
    messageQueueRef.current = []
    isProcessingQueueRef.current = false
    setQueuedMessagesDisplay([])
  }, [uiDispatch])

  // Keep voice agent stop ref in sync with actual handler
  useEffect(() => {
    handleStopRef.current = handleStop
  }, [handleStop])

  const handleRegenerate = useCallback(async () => {
    if (uiState.isLoading || uiState.isRegenerating) return
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMessage) return

    const messagesUpToLastUser = messages.slice(0, messages.findIndex((m) => m.id === lastUserMessage.id) + 1)
    let targetThreadId: string
    try {
      targetThreadId = createForkThreadId()
    } catch (error) {
      console.error("Failed to create forked thread for regenerate:", error)
      return
    }

    hasSentMessageRef.current = targetThreadId
    setMessages(messagesUpToLastUser)
    uiDispatch({ type: 'START_REGENERATE' })
    shouldInterruptRef.current = false

    try {
      const assistantMessageId = generateMessageId()
      const { assistantContent } = await processStream(
        lastUserMessage.content,
        assistantMessageId,
        lastUserMessage.images,
        targetThreadId,
        { inputMessages: toLangGraphMessages(messagesUpToLastUser) },
      )

      if (onThreadUpdate && assistantContent) {
        const firstUserMsg = messagesUpToLastUser.find((m) => m.role === "user")
        const title = customTitle || (firstUserMsg ? truncate(firstUserMsg.content, 60) : t.newConversation)
        const messageCount = messagesUpToLastUser.length + 1
        onThreadUpdate(targetThreadId, title, truncate(assistantContent, 100), undefined, messageCount)
      }
    } catch (error) {
      console.error("Error regenerating:", error)
      const errorMessage = createUserMessage(`Error: ${error instanceof Error ? error.message : t.failedToRegenerate}`)
      errorMessage.role = "assistant"
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      uiDispatch({ type: 'FINISH_REGENERATE' })
    }
  }, [uiState.isLoading, uiState.isRegenerating, messages, processStream, onThreadUpdate, customTitle, t.newConversation, uiDispatch, createForkThreadId])

  const handleEditAndRerun = useCallback(async (messageId: string, newContent: string) => {
    console.log('Edit and rerun from message:', messageId, 'new content:', newContent.slice(0, 50))

    if (uiState.isLoading || uiState.isRegenerating) return
    const messageIndex = messages.findIndex((m) => m.id === messageId)
    if (messageIndex === -1) return

    const messagesUpToEdit = messages.slice(0, messageIndex)
    const updatedMessage = {
      ...messages[messageIndex],
      content: newContent,
    }
    let targetThreadId: string
    try {
      targetThreadId = createForkThreadId()
    } catch (error) {
      console.error("Failed to create forked thread for edit rerun:", error)
      return
    }

    hasSentMessageRef.current = targetThreadId
    setMessages([...messagesUpToEdit, updatedMessage])
    uiDispatch({ type: 'SET_LOADING', payload: true })
    shouldInterruptRef.current = false

    try {
      const assistantMessageId = generateMessageId()
      console.log('Rerunning from edited message with assistantMessageId:', assistantMessageId)
      const { assistantContent } = await processStream(
        newContent,
        assistantMessageId,
        undefined,
        targetThreadId,
        {
          userMessageId: updatedMessage.id,
          inputMessages: toLangGraphMessages([...messagesUpToEdit, updatedMessage]),
        },
      )

      if (onThreadUpdate && assistantContent) {
        const firstUserMsg = messagesUpToEdit.find((m) => m.role === "user") || updatedMessage
        const title = customTitle || truncate(firstUserMsg.content, 60) || t.newConversation
        const messageCount = messagesUpToEdit.length + 2
        onThreadUpdate(targetThreadId, title, truncate(assistantContent, 100), undefined, messageCount)
      }
    } catch (error) {
      console.error("Error rerunning from edit:", error)
      const errorMessage = createUserMessage(`Error: ${error instanceof Error ? error.message : t.failedToRerunFromEdit}`)
      errorMessage.role = "assistant"
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      uiDispatch({ type: 'SET_LOADING', payload: false })
      uiDispatch({ type: 'SET_STOPPING', payload: false })
    }
  }, [uiState.isLoading, uiState.isRegenerating, messages, processStream, onThreadUpdate, customTitle, t.newConversation, t.failedToRerunFromEdit, uiDispatch, createForkThreadId])

  const handleCopy = async (content: string, messageId: string) => {
    await navigator.clipboard.writeText(content)
    uiDispatch({ type: 'SET_COPIED_ID', payload: messageId })
    setTimeout(() => uiDispatch({ type: 'SET_COPIED_ID', payload: null }), 2000)
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (userId) {
        handleSend()
      }
    }
  }, [userId, handleSend])

  const handleFileButtonClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [])

  const handleInputBeforeInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as InputEvent
    const insertedText = nativeEvent.data
    if (!insertedText) return

    const target = e.currentTarget
    const selectionLength = target.selectionEnd - target.selectionStart
    const nextLength = target.value.length - selectionLength + insertedText.length

    if (nextLength + attachedTextLength > MAX_INPUT_CHARS) {
      e.preventDefault()
      setInputError(INPUT_TOO_LONG_MESSAGE)
    }
  }, [attachedTextLength])

  const handleInputPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData?.getData("text") ?? ""
    if (pastedText) {
      const target = e.currentTarget
      const selectionLength = target.selectionEnd - target.selectionStart
      const nextLength = target.value.length - selectionLength + pastedText.length

      if (nextLength + attachedTextLength > MAX_INPUT_CHARS) {
        e.preventDefault()
        setInputError(INPUT_TOO_LONG_MESSAGE)
        return
      }
    }

    await handlePaste(e)
  }, [attachedTextLength, handlePaste])

  // ============================================================================
  // Computed Values
  // ============================================================================

  // Check if this is a new chat (no messages yet)
  const isNewChat = messages.length === 0 && !uiState.isLoadingThread

  // Display input with length cap (voice interim transcript shown in overlay, not in input)
  const maxDisplayInputLength = Math.max(0, MAX_INPUT_CHARS - attachedTextLength)
  const cappedDisplayInput = uiState.input.slice(0, maxDisplayInputLength)
  inputLengthRef.current = cappedDisplayInput.length

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      <style>{scrollbarStyles}</style>
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <MessageList
          messages={messages}
          showToolCalls={showToolCalls}
          isRegenerating={uiState.isRegenerating}
          copiedId={uiState.copiedId}
          onCopy={handleCopy}
          onRegenerate={handleRegenerate}
          onEditAndRerun={handleEditAndRerun}
        />

        {/* Voice mini panel (floats above input when active) */}
        <VoiceMiniPanel
          voiceState={voiceAgent.voiceState}
          isSpeaking={voiceAgent.isSpeaking}
          onExit={voiceAgent.exitVoiceMode}
        />

        {isNewChat ? (
          <WelcomeScreen
            input={cappedDisplayInput}
            onInputChange={setLimitedInput}
            onBeforeInput={handleInputBeforeInput}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            isLoading={uiState.isLoading}
            isStopping={uiState.isStopping}
            onStop={handleStop}
            userId={userId}
            attachedFiles={attachedFiles}
            uploadError={uploadError}
            inputError={inputError}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handleInputPaste}
            onRemoveFile={removeFile}
            onFileButtonClick={handleFileButtonClick}
            fileInputRef={fileInputRef}
            onFileSelect={handleFileSelect}
            textareaRef={textareaRef}
            voiceState={voiceAgent.voiceState}
            isVoiceSupported={voiceAgent.isSupported}
            onVoiceToggle={voiceAgent.toggleVoiceMode}
            voiceError={voiceAgent.error}
            agentConfig={agentConfig}
            onAgentConfigChange={onAgentConfigChange}
            agentProfile={agentProfile}
            agentProfilesLoaded={agentProfilesLoaded}
            agentProfiles={agentProfiles}
            onAgentProfileChange={onAgentProfileChange}
            onCreateAgent={onCreateAgent}
          />
        ) : (
          <ChatInput
            input={cappedDisplayInput}
            onInputChange={setLimitedInput}
            onBeforeInput={handleInputBeforeInput}
            onSend={handleSend}
            onKeyDown={handleKeyDown}
            isLoading={uiState.isLoading}
            isStopping={uiState.isStopping}
            onStop={handleStop}
            userId={userId}
            attachedFiles={attachedFiles}
            uploadError={uploadError}
            inputError={inputError}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handleInputPaste}
            onRemoveFile={removeFile}
            onFileButtonClick={handleFileButtonClick}
            fileInputRef={fileInputRef}
            onFileSelect={handleFileSelect}
            textareaRef={textareaRef}
            voiceState={voiceAgent.voiceState}
            isVoiceSupported={voiceAgent.isSupported}
            onVoiceToggle={voiceAgent.toggleVoiceMode}
            voiceError={voiceAgent.error}
            queuedMessages={queuedMessagesDisplay}
          />
        )}
      </main>
    </>
  )
}
