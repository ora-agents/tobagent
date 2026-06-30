/**
 * Chat Input Component
 *
 * Fixed input area at the bottom of the chat interface.
 * Includes file upload, drag & drop, and paste support.
 */

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { LoaderCircle, Plus, SendHorizontal, Square } from "lucide-react"
import { FilePreviewGrid } from "./features/file-preview-grid"
import { VoiceInputButton } from "./features/voice-input-button"
import type { ImageAttachment } from "@/lib/types"
import type { VoiceState } from "@/lib/voice/types"
import { MAX_INPUT_CHARS } from "@/lib/constants/features"
import { useT } from "@/lib/i18n"

interface ChatInputProps {
  input: string
  onInputChange: (value: string) => void
  onBeforeInput: (e: React.FormEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  isLoading: boolean
  isStopping: boolean
  onStop: () => void
  userId?: string | null

  // File upload
  attachedFiles: ImageAttachment[]
  uploadError: string | null
  inputError: string | null
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onRemoveFile: (fileId: string) => void
  onFileButtonClick: (e: React.MouseEvent) => void
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  textareaRef?: React.RefObject<HTMLTextAreaElement>

  // Voice input
  voiceState?: VoiceState
  isVoiceSupported?: boolean
  onVoiceToggle?: () => void
  voiceError?: string | null

  // Queued messages
  queuedMessages?: { content: string; id: string }[]
}

/**
 * Chat input area with file upload support.
 * Displays at the bottom of the chat interface when there are existing messages.
 */
export function ChatInput({
  input,
  onInputChange,
  onBeforeInput,
  onSend,
  onKeyDown,
  isLoading,
  isStopping,
  onStop,
  userId,
  attachedFiles,
  uploadError,
  inputError,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  onRemoveFile,
  onFileButtonClick,
  fileInputRef,
  onFileSelect,
  textareaRef,
  voiceState = "idle",
  isVoiceSupported,
  onVoiceToggle,
  voiceError,
  queuedMessages = [],
}: ChatInputProps) {
  const t = useT()
  const hasText = input.trim().length > 0

  return (
    <div className="relative bg-background">
      <div className="relative">
        <div className="mx-auto w-full max-w-4xl px-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-4">
          {/* File Previews */}
          <FilePreviewGrid files={attachedFiles} onRemove={onRemoveFile} />

          {/* Upload Error */}
          {uploadError && (
            <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {uploadError}
            </div>
          )}

          {/* Voice Error */}
          {voiceError && (
            <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {voiceError}
            </div>
          )}

          {/* Queued Messages */}
          {queuedMessages.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {queuedMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-1.5 text-muted-foreground flex-shrink-0">
                    <svg
                      className="w-3 h-3 animate-pulse"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    <span className="text-xs font-medium">{t.queued}</span>
                  </div>
                  <span className="truncate text-foreground">{msg.content}</span>
                </div>
              ))}
            </div>
          )}

          <div className="relative">
            <div className="relative">
              <div
                className={`relative rounded-xl bg-secondary transition-[background-color,box-shadow] duration-200 ${
                  isDragging
                    ? 'bg-primary-soft ring-[3px] ring-primary/25'
                    : ''
                }`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                {isDragging && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-primary-soft/90 pointer-events-none">
                    <div className="text-primary font-medium">{t.dropFilesHere}</div>
                  </div>
                )}
                <div className="flex items-end gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3">
                  {/* Hidden File Input */}
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.py,.js,.ts,.tsx,.jsx,.java,.cpp,.c,.h,.cs,.go,.rs,.rb,.php,.sh,.bash,.yaml,.yml,.json,.xml,.html,.css,.md,.txt,.log,.sql,.graphql,.r,.swift,.kt,.scala,.har"
                    multiple
                    onChange={onFileSelect}
                    className="hidden"
                  />

                  {/* File Upload Button - Stays at bottom as textarea grows */}
                  {!isLoading && (
                    <Button
                      onClick={onFileButtonClick}
                      variant="ghost"
                      size="sm"
                      disabled={isLoading || !userId}
                      className="mb-0.5 h-10 w-10 flex-shrink-0 rounded-lg bg-card p-0 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary sm:h-9 sm:w-9"
                      type="button"
                      title={t.attachFiles}
                    >
                      <Plus className="w-4.5 h-4.5" strokeWidth={2.5} />
                    </Button>
                  )}

                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    onBeforeInput={onBeforeInput}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    maxLength={MAX_INPUT_CHARS}
                    placeholder={
                      !userId
                        ? t.initializing
                        : isLoading
                          ? t.typeNextMessage
                          : t.askAnything
                    }
                    className="scrollbar-none relative z-10 min-h-[40px] max-h-[32dvh] w-full resize-none break-words bg-transparent px-2 py-2.5 text-base leading-relaxed text-foreground transition-all duration-200 placeholder:text-muted-foreground focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 sm:min-h-[36px] sm:max-h-[240px] sm:px-3 sm:py-2 sm:text-sm"
                    disabled={!userId}
                    rows={1}
                  />

                  {hasText ? (
                    <Button
                      onClick={onSend}
                      variant="ghost"
                      size="sm"
                      disabled={!userId}
                      className="mb-0.5 h-10 w-10 flex-shrink-0 rounded-lg bg-primary p-0 text-primary-foreground transition-colors hover:bg-primary-active hover:text-primary-foreground sm:h-9 sm:w-9"
                      type="button"
                      title={t.sendMessage}
                      aria-label={t.sendMessage}
                    >
                      <SendHorizontal className="w-4 h-4" strokeWidth={2.5} />
                    </Button>
                  ) : isVoiceSupported && onVoiceToggle && (
                    <VoiceInputButton
                      voiceState={voiceState}
                      isSupported={isVoiceSupported}
                      disabled={!userId}
                      onClick={onVoiceToggle}
                      size="sm"
                    />
                  )}

                  {isLoading && (
                    <Button
                      onClick={onStop}
                      variant="ghost"
                      size="sm"
                      disabled={isStopping}
                      className={`
                        h-10 px-3 sm:h-9 sm:px-4 mb-0.5 rounded-lg flex-shrink-0
                        transition-colors duration-200
                        bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary
                        ${isStopping ? 'opacity-60 cursor-not-allowed' : ''}
                      `}
                      type="button"
                      title={isStopping ? t.stopping : t.stop}
                      aria-label={isStopping ? t.stopping : t.stop}
                    >
                      {isStopping ? (
                        <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Square className="w-3 h-3 fill-current" />
                      )}
                      <span className="text-xs font-medium">
                        {isStopping ? t.stopping : t.stop}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {inputError && (
            <div className="mt-1 px-2 text-xs text-destructive">
              {inputError}
            </div>
          )}

          {/* Simple help text - hidden on mobile */}
          <div className="hidden sm:flex items-center justify-between mt-1 px-2">
            <p className="text-[11px] text-muted-foreground">
              <kbd className="rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-foreground">Enter</kbd> {t.enterToSend}
              <span className="mx-1">•</span>
              <kbd className="rounded bg-secondary px-1 py-0.5 text-[10px] font-medium text-foreground">Shift+Enter</kbd> {t.shiftEnterNewLine}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
