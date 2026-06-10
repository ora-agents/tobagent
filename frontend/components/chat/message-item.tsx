import { Copy, Check, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { ThinkingTimer } from "./animations/thinking-timer"
import { AnimatedThinking } from "./animations/animated-thinking"
import type { Message } from "@/lib/types"
import { useState, useMemo, useCallback, memo, useRef, useEffect } from "react"
import { useT } from "@/lib/i18n"

// ============================================================================
// Constants
// ============================================================================

const COPY_FEEDBACK_DURATION = 2000

// Color palette for code highlighting
const CODE_COLORS = {
  // Background & borders
  blockBackground: 'oklch(0.16 0 0)',
  blockBorder: 'oklch(0.30 0 0)',
  inlineBackground: 'oklch(0.22 0 0)',
  inlineBorder: 'oklch(0.32 0 0)',

  // Primary theme colors (warm coral palette)
  primary: '#e8c9b8',      // Warm cream — properties, operators, tags
  primaryLight: '#f0dbd0',  // Light warm — strings, attributes
  primaryDark: '#cc9a80',  // Coral mid — keywords, built-ins

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
    <div className="relative group my-4">
      <SyntaxHighlighter
        language={language}
        style={customTheme}
        customStyle={{
          margin: '0.75rem 0',
          background: CODE_COLORS.blockBackground,
          border: `1px solid ${CODE_COLORS.blockBorder}`,
          borderRadius: '8px',
          padding: '1rem',
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
  showToolCalls?: boolean
  isLastAssistant: boolean
  isRegenerating: boolean
  copiedId: string | null
  onCopy: (content: string, messageId: string) => void
  onRegenerate: () => void
  onEditAndRerun?: (messageId: string, newContent: string) => void
}

export const MessageItem = memo(function MessageItem({
  message,
  showToolCalls,
  isLastAssistant,
  isRegenerating,
  copiedId,
  onCopy,
  onRegenerate,
  onEditAndRerun,
}: MessageItemProps) {
  const t = useT()
  const [editContent, setEditContent] = useState(message.content)

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && onEditAndRerun) {
      e.preventDefault()
      if (editContent.trim()) {
        onEditAndRerun(message.id, editContent.trim())
      }
    }
  }, [editContent, onEditAndRerun, message.id])

  // Track code block index to generate stable IDs during streaming
  const codeBlockIndexRef = useRef(0)

  // Reset counter before each render so code blocks get consistent indices
  codeBlockIndexRef.current = 0

  // Control the open state of the Process details panel.
  // - While thinking: keep open.
  // - When thinking transitions to done AND we have process steps: keep open so
  //   the user can see the result without having to click.
  // - The user can still manually toggle by clicking the <summary>.
  const hasProcessContent =
    !!(message.thinkingSteps && message.thinkingSteps.length > 0) ||
    !!(message.processSteps && message.processSteps.length > 0) ||
    !!(message.toolCalls && message.toolCalls.length > 0)

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
      const nowHasContent =
        !!(message.thinkingSteps && message.thinkingSteps.length > 0) ||
        !!(message.processSteps && message.processSteps.length > 0) ||
        !!(message.toolCalls && message.toolCalls.length > 0)
      if (nowHasContent) {
        setDetailsOpen(true)
      }
    }
  }, [message.isThinking, message.thinkingSteps, message.processSteps, message.toolCalls])

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
      `}</style>
      <div className={`flex gap-3 sm:gap-4 items-start group/message ${message.role === "user" ? "justify-end" : ""}`}>
      <div className={`min-w-0 space-y-2 ${message.role === "user" ? "max-w-[80%]" : "flex-1"}`}>
        <div
          className={`transition-all duration-150 ease-out ${
            message.role === "user"
              ? "bg-card/95 backdrop-blur-sm border-2 border-border/50 rounded-xl px-3 py-2 text-foreground"
              : "text-foreground"
          }`}
          style={{
            willChange: message.isThinking ? 'contents' : 'auto',
            contain: 'layout style paint',
          }}
        >
          {/* Thinking indicator and Process - only for assistant messages */}
          {message.role === "assistant" && (message.isThinking || message.thinkingStartTime || (message.thinkingSteps && message.thinkingSteps.length > 0) || (message.toolCalls && message.toolCalls.length > 0) || (message.processSteps && message.processSteps.length > 0)) && (
            <details
              open={detailsOpen}
              onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
              className="mb-3 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs"
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
              {message.thinkingSteps && message.thinkingSteps.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground">
                  {message.thinkingSteps.map((step, idx) => (
                    <span
                      key={`${message.id}-step-${idx}`}
                      className="rounded-full border border-border/70 bg-background/55 px-2 py-0.5 leading-5"
                    >
                      {step}
                    </span>
                  ))}
                </div>
              )}
              {message.processSteps && message.processSteps.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {message.processSteps.map((step, idx) => {
                    if (step.type === "text" && step.content) {
                      return (
                        <div key={`ps-${idx}`} className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap bg-muted/20 rounded-lg border border-border/30">
                          {step.content}
                        </div>
                      )
                    } else if (step.type === "tool" && step.tool) {
                      const tool = step.tool
                      return (
                        <div
                          key={`ps-${idx}-${tool.id}`}
                          className="px-3 py-2 rounded-lg border border-border bg-muted/50 text-xs"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-primary">
                              {t.tool}: {tool.name}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-muted-foreground">
                            <details>
                              <summary className="cursor-pointer hover:opacity-80">
                                {t.viewArguments}
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">
                                {JSON.stringify(tool.args, null, 2)}
                              </pre>
                            </details>
                            {tool.output && (
                              <details className="mt-2">
                                <summary className="cursor-pointer hover:opacity-80">
                                  {t.viewOutput}
                                </summary>
                                <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">
                                  {typeof tool.output === "string"
                                    ? tool.output
                                    : JSON.stringify(tool.output, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      )
                    }
                    return null
                  })}
                </div>
              ) : (
                showToolCalls && message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.toolCalls.map((tool) => (
                      <div
                        key={tool.id}
                        className="px-3 py-2 rounded-lg border border-border bg-muted/50 text-xs"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-primary">
                            {t.tool}: {tool.name}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          <details>
                            <summary className="cursor-pointer hover:opacity-80">
                              {t.viewArguments}
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">
                              {JSON.stringify(tool.args, null, 2)}
                            </pre>
                          </details>
                          {tool.output && (
                            <details className="mt-2">
                              <summary className="cursor-pointer hover:opacity-80">
                                {t.viewOutput}
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap break-words text-[10px]">
                                {typeof tool.output === "string"
                                  ? tool.output
                                  : JSON.stringify(tool.output, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </details>
          )}

          {message.role === "user" ? (
              <div className="space-y-2">
                {/* File attachments - uniform grid layout */}
                {message.images && message.images.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 mb-3">
                    {message.images.map((file) => {
                      const isImage = file.mimeType?.startsWith('image/')
                      const fileName = file.name || "File"
                      const fileExt = fileName.split('.').pop()?.toLowerCase()
                      const fileSizeKB = file.size ? Math.round(file.size / 1024) : 0

                      // Get file type icon color
                      const getFileColor = () => {
                        return "text-white"
                      }

                      return (
                        <div
                          key={file.id}
                          className="h-32 rounded-lg border-2 border-border bg-muted/30 hover:bg-muted/50 hover:border-primary transition-all flex flex-col overflow-hidden"
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
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`w-10 h-10 mb-2 ${getFileColor()}`}
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                              </svg>
                              <span className="text-xs font-medium text-foreground truncate w-full px-1 mb-1" title={fileName}>
                                {fileName}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded bg-muted ${getFileColor()}`}>
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
                {/* Text content — always-editable, Enter to rerun */}
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleEditKeyDown}
                  className="chat-message-textarea min-h-0 w-full resize-none bg-transparent border-0 p-0 text-sm leading-relaxed text-foreground focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                  rows={1}
                />
              </div>
          ) : (
            <div className="relative">
              <div
                className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none break-words overflow-wrap break-word transition-opacity duration-200 ease-out"
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
                    className="h-8 px-2 text-xs"
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
                      className="h-8 px-2 text-xs"
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
    prevProps.showToolCalls !== nextProps.showToolCalls ||
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
