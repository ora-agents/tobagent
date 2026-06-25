import { Check, ChevronDown, Copy, FileText, RefreshCw, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ThinkingTimer } from "./animations/thinking-timer"
import { AnimatedThinking } from "./animations/animated-thinking"
import type { Message, ToolCall } from "@/lib/types"
import { useState, useMemo, useCallback, memo, useRef, useEffect } from "react"
import { useT } from "@/lib/i18n"
import { isAndroidWebView } from "@/lib/voice/utils/browser"

// ============================================================================
// Constants
// ============================================================================

const COPY_FEEDBACK_DURATION = 2000
const USER_MESSAGE_COLLAPSE_CHAR_LIMIT = 520
const USER_MESSAGE_COLLAPSE_LINE_LIMIT = 8

// Color palette for code highlighting
const CODE_COLORS = {
  // Background & borders
  blockBackground: 'oklch(0.16 0 0)',
  blockBorder: 'oklch(0.30 0 0)',
  inlineBackground: 'oklch(0.22 0 0)',
  inlineBorder: 'oklch(0.32 0 0)',

  // Primary theme colors (WSIRI blue palette)
  primary: '#dbeafe',      // Blue-tinted light — properties, operators, tags
  primaryLight: '#eff6ff',  // Pale blue — strings, attributes
  primaryDark: '#93c5fd',  // Mid blue — keywords, built-ins

  // Accent colors
  blue: '#60a5fa',         // Functions
  yellow: '#fbbf24',       // Classes
  orange: '#f59e0b',       // Numbers, booleans
  green: '#10b981',        // Selectors, inserted
  red: '#ef4444',          // Important, deleted

  // Neutral colors
  text: '#e4e4e7',         // Main text
  comment: '#6b7280',      // Comments, docstrings
  punctuation: '#a1a1aa',  // Punctuation
} as const

// ============================================================================
// Syntax Highlighting Theme
// ============================================================================

const customTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: CODE_COLORS.blockBackground,
    border: `1px solid ${CODE_COLORS.blockBorder}`,
    borderRadius: '8px',
    padding: '1rem',
    margin: '0.75rem 0',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    color: CODE_COLORS.text,
    fontSize: '13px',
    lineHeight: '1.6',
  },
  // Token colors - grouped by theme color
  'comment': { color: CODE_COLORS.comment },
  'prolog': { color: CODE_COLORS.comment },
  'doctype': { color: CODE_COLORS.comment },
  'cdata': { color: CODE_COLORS.comment },
  'punctuation': { color: CODE_COLORS.punctuation },

  'property': { color: CODE_COLORS.primary },
  'tag': { color: CODE_COLORS.primary },
  'operator': { color: CODE_COLORS.primary },
  'entity': { color: CODE_COLORS.primary },
  'url': { color: CODE_COLORS.primary },
  'attr-name': { color: CODE_COLORS.primary },

  'string': { color: CODE_COLORS.primaryLight },
  'char': { color: CODE_COLORS.primaryLight },
  'attr-value': { color: CODE_COLORS.primaryLight },

  'builtin': { color: CODE_COLORS.primaryDark },
  'atrule': { color: CODE_COLORS.primaryDark },
  'keyword': { color: CODE_COLORS.primaryDark },

  'boolean': { color: CODE_COLORS.orange },
  'number': { color: CODE_COLORS.orange },
  'constant': { color: CODE_COLORS.orange },
  'symbol': { color: CODE_COLORS.orange },
  'regex': { color: CODE_COLORS.orange },

  'selector': { color: CODE_COLORS.green },
  'inserted': { color: CODE_COLORS.green },

  'function': { color: CODE_COLORS.blue },
  'class-name': { color: CODE_COLORS.yellow },
  'variable': { color: CODE_COLORS.text },

  'important': { color: CODE_COLORS.red, fontWeight: 'bold' },
  'deleted': { color: CODE_COLORS.red },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively extract text content from ReactMarkdown nodes
 * Used for extracting code from markdown code blocks for copy functionality
 */
const extractTextFromNode = (node: any): string => {
  if (typeof node === 'string') return node
  if (node?.props?.children) {
    if (typeof node.props.children === 'string') {
      return node.props.children
    }
    if (Array.isArray(node.props.children)) {
      return node.props.children.map(extractTextFromNode).join('')
    }
    return extractTextFromNode(node.props.children)
  }
  return ''
}

const formatToolValue = (value: unknown): string => {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const getToolArgsSummary = (args: Record<string, any>): string => {
  if (typeof args?.url === "string") return args.url
  if (typeof args?.query === "string") return args.query

  const compactArgs = JSON.stringify(args)
  return compactArgs && compactArgs !== "{}" ? compactArgs : ""
}

const ToolCallPreview = memo(function ToolCallPreview({ tool }: { tool: ToolCall }) {
  const t = useT()
  const argsValue = formatToolValue(tool.args).trim()
  const outputValue = formatToolValue(tool.output).trim()
  const argsSummary = getToolArgsSummary(tool.args)
  const hasOutput = tool.output !== undefined && tool.output !== null && outputValue.length > 0

  return (
    <details className="group/tool-call overflow-hidden rounded-lg bg-secondary text-xs text-foreground open:bg-card">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20">
        <Settings className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="shrink-0 font-mono text-[13px] font-semibold text-foreground">
          {tool.name}
        </span>
        {argsSummary && (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">
            {argsSummary}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {hasOutput ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <span className="text-[11px] text-muted-foreground">{t.running}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open/tool-call:rotate-180" />
        </div>
      </summary>
      <div className="max-h-80 overflow-y-auto bg-muted px-3 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {argsValue && (
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">
            {argsValue}
          </pre>
        )}
        {hasOutput && (
          <pre className="mt-3 pt-3 whitespace-pre-wrap break-words text-muted-foreground">
            {outputValue}
          </pre>
        )}
      </div>
    </details>
  )
})

/**
 * Individual code block component with its own copy state
 * This prevents the copy button from flickering during streaming
 */
const CodeBlock = memo(({ codeString, language }: { codeString: string; language: string }) => {
  const t = useT()
  const [isCopied, setIsCopied] = useState(false)

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(codeString)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), COPY_FEEDBACK_DURATION)
  }, [codeString])

  return (
    <div className="relative group my-3 max-w-full overflow-hidden sm:my-4">
      <SyntaxHighlighter
        language={language}
        style={customTheme}
        customStyle={{
          margin: '0.75rem 0',
          background: CODE_COLORS.blockBackground,
          border: `1px solid ${CODE_COLORS.blockBorder}`,
          borderRadius: '8px',
          padding: '1rem',
          maxWidth: '100%',
          overflowX: 'auto',
        }}
        codeTagProps={{
          style: {
            fontSize: '13px',
            fontFamily: 'var(--font-mono), ui-monospace, monospace',
          }
        }}
      >
        {codeString}
      </SyntaxHighlighter>
      <button
        onClick={handleCopyCode}
        className="absolute top-2 right-2 sm:top-3 sm:right-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md text-xs flex items-center gap-1 sm:gap-1.5 backdrop-blur-sm"
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          color: CODE_COLORS.text,
          border: `1px solid ${CODE_COLORS.blockBorder}`,
          willChange: 'opacity',
        }}
        aria-label="Copy code to clipboard"
      >
        {isCopied ? (
          <>
            <Check className="w-3.5 h-3.5" />
            {t.copied}
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            {t.copy}
          </>
        )}
      </button>
    </div>
  )
})

interface MessageItemProps {
  message: Message
  isLastAssistant: boolean
  isRegenerating: boolean
  copiedId: string | null
  onCopy: (content: string, messageId: string) => void
  onRegenerate: () => void
  onEditAndRerun?: (messageId: string, newContent: string) => void
}

export const MessageItem = memo(function MessageItem({
  message,
  isLastAssistant,
  isRegenerating,
  copiedId,
  onCopy,
  onRegenerate,
  onEditAndRerun,
}: MessageItemProps) {
  const t = useT()
  const [editContent, setEditContent] = useState(message.content)
  const [isEditingUserMessage, setIsEditingUserMessage] = useState(false)
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false)
  const [useAndroidWebViewLayout, setUseAndroidWebViewLayout] = useState(false)
  const userEditTextareaRef = useRef<HTMLTextAreaElement>(null)

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && onEditAndRerun) {
      e.preventDefault()
      if (editContent.trim()) {
        onEditAndRerun(message.id, editContent.trim())
        setIsEditingUserMessage(false)
      }
    }
  }, [editContent, onEditAndRerun, message.id])

  const startEditingUserMessage = useCallback(() => {
    if (!onEditAndRerun) return
    setEditContent(message.content)
    setIsEditingUserMessage(true)
  }, [message.content, onEditAndRerun])

  const cancelEditingUserMessage = useCallback(() => {
    setEditContent(message.content)
    setIsEditingUserMessage(false)
  }, [message.content])

  useEffect(() => {
    setUseAndroidWebViewLayout(isAndroidWebView())
  }, [])

  useEffect(() => {
    setIsUserMessageExpanded(false)
  }, [message.id, message.content])

  useEffect(() => {
    if (!isEditingUserMessage) {
      setEditContent(message.content)
      return
    }

    const textarea = userEditTextareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [isEditingUserMessage, message.content])

  // Track code block index to generate stable IDs during streaming
  const codeBlockIndexRef = useRef(0)

  // Reset counter before each render so code blocks get consistent indices
  codeBlockIndexRef.current = 0

  // Control the open state of the Process details panel.
  // - While thinking: keep open.
  // - When thinking transitions to done AND we have process steps: keep open so
  //   the user can see the result without having to click.
  // - The user can still manually toggle by clicking the <summary>.
  const hasProcessContent = !!(message.processSteps && message.processSteps.length > 0)
  const hasTextProcessSteps = !!message.processSteps?.some(step => step.type === "text" && step.content)
  const showProcessDetailsPanel = !!message.isThinking || hasTextProcessSteps
  const userMessageLineCount = typeof message.content === "string" ? message.content.split(/\r\n|\r|\n/).length : 0
  const shouldCollapseUserMessage =
    message.role === "user" &&
    !isEditingUserMessage &&
    typeof message.content === "string" &&
    (message.content.length > USER_MESSAGE_COLLAPSE_CHAR_LIMIT || userMessageLineCount > USER_MESSAGE_COLLAPSE_LINE_LIMIT)

  const [detailsOpen, setDetailsOpen] = useState(
    () => !!message.isThinking || hasProcessContent
  )

  // Sync open state when isThinking changes:
  // - thinking starts  → open
  // - thinking ends    → stay open if there is content to show
  const prevIsThinkingRef = useRef(message.isThinking)
  useEffect(() => {
    const wasThinking = prevIsThinkingRef.current
    prevIsThinkingRef.current = message.isThinking
    if (message.isThinking) {
      // Agent started (re-)thinking — open the panel
      setDetailsOpen(true)
    } else if (wasThinking && !message.isThinking) {
      // Thinking just finished — keep open so the user sees the process result
      if (message.processSteps && message.processSteps.length > 0) {
        setDetailsOpen(true)
      }
    }
  }, [message.isThinking, message.processSteps])

  // Memoize markdown components to prevent button remounting during streaming
  const markdownComponents = useMemo(() => ({
    // Custom link renderer - opens in new tab
    a: ({ children, ...props }: any) => (
      <a
        {...props}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Custom code renderer - handles both inline code and code blocks
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : 'text'
      const codeString = String(children).replace(/\n$/, '')

      // Check if it's inline code: single backticks or no newlines
      const isInlineCode = inline === true || (!className && !codeString.includes('\n'))

      // Inline code (single backticks) — theme-aware via .prose code CSS
      if (isInlineCode) {
        return (
          <code
            className="px-1.5 py-0.5 text-[13px] font-mono rounded-[5px]"
            {...props}
          >
            {children}
          </code>
        )
      }

      // Code blocks (triple backticks) - use stable ID based on position, not content
      // This prevents flickering during streaming when code content changes
      const blockIndex = codeBlockIndexRef.current++
      const codeBlockId = `${message.id}-code-${blockIndex}`

      // Render a separate component for the code block with copy functionality
      return <CodeBlock key={codeBlockId} codeString={codeString} language={language} />
    },
  }), [message.id])

  return (
    <>
      <style jsx>{`
        @keyframes dance {
          0% { transform: rotate(-30deg) scale(1); }
          25% { transform: rotate(0deg) scale(1.05); }
          50% { transform: rotate(30deg) scale(1); }
          75% { transform: rotate(0deg) scale(1.05); }
          100% { transform: rotate(-30deg) scale(1); }
        }
        @keyframes spin360 {
          0%, 90% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .dance-wrapper {
          animation: spin360 6s linear infinite;
        }
        .dancing {
          animation: dance 0.8s ease-in-out infinite;
        }

        /* Smooth text rendering optimizations */
        .prose {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }

        /* Optimize layout performance during streaming */
        .prose > * {
          transition: opacity 0.1s ease-out;
        }

        details > summary::-webkit-details-marker {
          display: none;
        }

      `}</style>
      <div className={`flex min-w-0 gap-3 sm:gap-4 items-start group/message ${message.role === "user" ? "justify-end" : ""}`}>
      <div
        className={`min-w-0 space-y-2 ${
          message.role === "user"
            ? useAndroidWebViewLayout
              ? "ml-auto w-fit max-w-[92%] sm:max-w-[80%]"
              : "max-w-[92%] sm:max-w-[80%]"
            : "flex-1"
        }`}
      >
        <div
          className={`transition-all duration-150 ease-out ${
            message.role === "user"
              ? "rounded-xl bg-secondary px-3 py-2 text-foreground"
              : "text-foreground"
          }`}
          style={{
            willChange: message.isThinking ? 'contents' : 'auto',
            contain: 'layout style paint',
          }}
        >
          {/* Process panel - only shown when there are intermediate process steps */}
          {message.role === "assistant" && message.processSteps && message.processSteps.length > 0 && !showProcessDetailsPanel && (
            <div className="mb-3 space-y-2">
              {message.processSteps.map((step, idx) => {
                if (step.type === "tool" && step.tool) {
                  return <ToolCallPreview key={`ps-${idx}-${step.tool.id}`} tool={step.tool} />
                }
                return null
              })}
            </div>
          )}

          {message.role === "assistant" && message.processSteps && message.processSteps.length > 0 && showProcessDetailsPanel && (
            <details
              open={detailsOpen}
              onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
              className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs"
            >
              <summary className="cursor-pointer flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors marker:text-muted-foreground">
                {message.isThinking && (
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary/35 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                )}
                <span>
                  {message.isThinking ? <AnimatedThinking /> : <span className="font-medium">Process</span>}
                </span>
                <span className="ml-1">•</span>
                <ThinkingTimer
                  startTime={message.thinkingStartTime}
                  duration={message.thinkingDuration}
                  isThinking={!!message.isThinking}
                />
              </summary>
              {message.processSteps && message.processSteps.length > 0 && (
                <div className="mt-3 space-y-3">
                  {message.processSteps.map((step, idx) => {
                    if (step.type === "text" && step.content) {
                      return (
                        <div key={`ps-${idx}`} className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
                          {step.content}
                        </div>
                      )
                    } else if (step.type === "tool" && step.tool) {
                      const tool = step.tool
                      return (
                        <ToolCallPreview key={`ps-${idx}-${tool.id}`} tool={tool} />
                      )
                    }
                    return null
                  })}
                </div>
              )}
            </details>
          )}

          {message.role === "user" ? (
              <div className="space-y-2">
                {/* File attachments - uniform grid layout */}
                {message.images && message.images.length > 0 && (
                  <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
                    {message.images.map((file) => {
                      const isImage = file.mimeType?.startsWith('image/')
                      const fileName = file.name || "File"
                      const fileExt = fileName.split('.').pop()?.toLowerCase()
                      const fileSizeKB = file.size ? Math.round(file.size / 1024) : 0

                      // Get file type icon color
                      const getFileColor = () => "text-primary"

                      return (
                        <div
                          key={file.id}
                          className="flex h-32 flex-col overflow-hidden rounded-lg bg-muted transition-colors hover:bg-secondary"
                        >
                          {isImage ? (
                            // Image with filename overlay
                            <div className="relative h-full w-full">
                              <img
                                src={file.url || `data:${file.mimeType};base64,${file.base64}`}
                                alt={fileName}
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1">
                                <p className="text-xs text-white truncate" title={fileName}>
                                  {fileName}
                                </p>
                              </div>
                            </div>
                          ) : (
                            // File card with icon
                            <div className="h-full flex flex-col items-center justify-center p-3 text-center">
                              <FileText className={`mb-2 h-10 w-10 ${getFileColor()}`} />
                              <span className="text-xs font-medium text-foreground truncate w-full px-1 mb-1" title={fileName}>
                                {fileName}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className={`rounded bg-primary-soft px-1.5 py-0.5 text-xs font-bold ${getFileColor()}`}>
                                  {fileExt?.toUpperCase().slice(0, 4)}
                                </span>
                                {fileSizeKB > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {fileSizeKB}KB
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {isEditingUserMessage ? (
                  <Textarea
                    ref={userEditTextareaRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={cancelEditingUserMessage}
                    className={`chat-message-textarea min-h-0 resize-none bg-transparent border-0 p-0 text-sm leading-relaxed text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none ${
                      useAndroidWebViewLayout ? "min-w-[12ch] max-w-full" : "w-full"
                    }`}
                    rows={1}
                  />
                ) : (
                  <div className="space-y-1.5">
                    <div
                      className={`relative max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed ${
                        shouldCollapseUserMessage && !isUserMessageExpanded
                          ? "max-h-40 overflow-hidden"
                          : ""
                      } ${onEditAndRerun ? "cursor-text" : ""}`}
                      onClick={startEditingUserMessage}
                      role={onEditAndRerun ? "textbox" : undefined}
                      aria-label={onEditAndRerun ? "Edit message" : undefined}
                      tabIndex={onEditAndRerun ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          startEditingUserMessage()
                        }
                      }}
                    >
                      {message.content}
                      {shouldCollapseUserMessage && !isUserMessageExpanded && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-secondary" />
                      )}
                    </div>
                    {shouldCollapseUserMessage && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setIsUserMessageExpanded((expanded) => !expanded)
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
                        aria-expanded={isUserMessageExpanded}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isUserMessageExpanded ? "rotate-180" : ""}`} />
                        {isUserMessageExpanded ? t.collapseMessage : t.expandMessage}
                      </button>
                    )}
                  </div>
                )}
              </div>
          ) : (
            <div className="relative">
              <div
                className="prose prose-sm max-w-none break-words text-sm leading-relaxed transition-opacity duration-200 ease-out dark:prose-invert [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
                style={{
                  animation: message.isThinking ? 'none' : 'fadeIn 0.3s ease-out',
                  willChange: message.isThinking ? 'contents, opacity' : 'auto',
                  backfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                }}
              >
                {message.content && typeof message.content === 'string' ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {message.content}
                  </ReactMarkdown>
              ) : null}
              </div>

            </div>
          )}
        </div>

        {message.role === "assistant" && (
          <>
            <div className="flex gap-1 sm:gap-2 items-center flex-wrap">
              {!message.isThinking && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopy(message.content, message.id)}
                    className="h-8 rounded-md bg-secondary px-2 text-xs text-foreground hover:bg-primary-soft hover:text-primary"
                  >
                    {copiedId === message.id ? (
                      <>
                        <Check className="w-3 h-3 mr-1" />
                        {t.copied}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 mr-1" />
                        {t.copy}
                      </>
                    )}
                  </Button>

                  {isLastAssistant && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onRegenerate}
                      disabled={isRegenerating}
                      className="h-8 rounded-md bg-secondary px-2 text-xs text-foreground hover:bg-primary-soft hover:text-primary"
                    >
                      <RefreshCw className={`w-3 h-3 mr-1 ${isRegenerating ? "animate-spin" : ""}`} />
                      {t.regenerate}
                    </Button>
                  )}
                </>
              )}

            </div>



          </>
        )}
      </div>
    </div>
    </>
  )
}, (prevProps, nextProps) => {
  // Custom comparison: skip re-render only if props affecting THIS message are unchanged
  // Message content/object changed - always re-render (e.g., during streaming)
  if (prevProps.message !== nextProps.message) {
    return false
  }

  // copiedId changed - only re-render if it affects this message
  const copiedIdAffectsThis =
    prevProps.copiedId !== nextProps.copiedId &&
    (prevProps.copiedId === prevProps.message.id || nextProps.copiedId === nextProps.message.id)

  // Other props that affect rendering
  const otherPropsChanged =
    prevProps.isRegenerating !== nextProps.isRegenerating ||
    prevProps.isLastAssistant !== nextProps.isLastAssistant

  // Re-render if any relevant prop changed
  if (copiedIdAffectsThis || otherPropsChanged) {
    return false
  }

  // Function references - if they changed, we need to re-render (shouldn't happen with useCallback)
  const functionsChanged =
    prevProps.onCopy !== nextProps.onCopy ||
    prevProps.onRegenerate !== nextProps.onRegenerate
  
  if (functionsChanged) {
    return false
  }
  
  // All props that matter for this message are unchanged - skip re-render
  return true
})
