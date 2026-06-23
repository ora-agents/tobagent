"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { ComboboxSkeleton } from "@/components/ui/loading-placeholder"
import { LoaderCircle, Plus, SendHorizontal, Square } from "lucide-react"
import { FilePreviewGrid } from "./file-preview-grid"
import { VoiceInputButton } from "./voice-input-button"
import type { ImageAttachment } from "@/lib/types"
import type { VoiceState } from "@/lib/voice/types"
import type { AgentConfig } from "@/components/layout/agent-settings"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { MAX_INPUT_CHARS } from "@/lib/constants/features"
import {
  fetchAvailableModels,
  getModelDisplayName,
  type ModelOption,
} from "@/lib/config/deployment-config"
import { isAndroidWebView } from "@/lib/voice/utils/browser"
import { useT, useI18n } from "@/lib/i18n"

interface WelcomeScreenProps {
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

  // Agent configuration
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  agentProfile?: AgentProfile | null
  agentProfilesLoaded?: boolean
  onCreateAgent?: () => void
}

/**
 * Welcome screen shown when starting a new chat.
 * Features a centered input box with file upload support.
 */
export function WelcomeScreen({
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
  agentConfig,
  onAgentConfigChange,
  agentProfile,
  agentProfilesLoaded = true,
  onCreateAgent,
}: WelcomeScreenProps) {
  const t = useT()
  const { locale } = useI18n()
  const [availableModels, setAvailableModels] = useState<ModelOption[] | null>(null)
  const hasText = input.trim().length > 0
  const suppressAndroidVoiceAutoFocus = isAndroidWebView() && voiceState !== "idle"
  const fixedAgentModel = agentProfile?.model?.trim() || null
  const displayedModel = fixedAgentModel || agentConfig?.model || ""

  useEffect(() => {
    fetchAvailableModels().then(setAvailableModels)
  }, [])

  const handleModelChange = (model: string) => {
    if (agentConfig && onAgentConfigChange) {
      onAgentConfigChange({ ...agentConfig, model })
    }
  }
  const isAgentLoading = !agentProfilesLoaded
  const hasActiveAgent = !!agentProfile

  return (
    <div className="absolute inset-0 flex items-center justify-center px-3 sm:px-4">
      <div className="w-full max-w-3xl -mt-20 sm:-mt-36">
        {/* Header */}
        <div className="text-center mb-8">
          <h2
            className="text-3xl sm:text-5xl font-normal text-foreground mb-2"
            style={{ fontFamily: "var(--font-display), 'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', Georgia, serif", letterSpacing: "-0.02em" }}
          >
            {t.whatCanIHelpWith}
          </h2>
        </div>

        {!isAgentLoading && !hasActiveAgent && (
          <div className="mb-4 rounded-lg bg-muted/70 px-4 py-3 text-sm text-muted-foreground flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{t.createAgentPrompt}</span>
            {onCreateAgent && (
              <Button
                type="button"
                size="sm"
                onClick={onCreateAgent}
                className="gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary-active"
              >
                <Plus className="w-4 h-4" />
                {t.addAgent}
              </Button>
            )}
          </div>
        )}

        {/* File Previews */}
        <FilePreviewGrid files={attachedFiles} onRemove={onRemoveFile} />

        {/* Upload Error */}
        {uploadError && (
          <div className="mb-3 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
            {uploadError}
          </div>
        )}

        {/* Voice Error */}
        {voiceError && (
          <div className="mb-3 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
            {voiceError}
          </div>
        )}

        {/* Centered Input Container */}
        <div className="relative group">
          <div className="relative">
            <div className="absolute -inset-0.5 bg-primary/5 rounded-xl opacity-60 group-hover:opacity-80 group-focus-within:opacity-100 transition-opacity duration-300" />

            <div
              className={`relative bg-muted/70 backdrop-blur-sm rounded-xl transition-all duration-300 group-hover:bg-muted group-focus-within:bg-background group-focus-within:ring-2 group-focus-within:ring-primary/15 ${
                isDragging
                  ? 'bg-primary/10 ring-2 ring-primary/25'
                  : ''
              }`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
            {isDragging && (
              <div className="absolute inset-0 bg-primary/10 rounded-xl flex items-center justify-center z-20 pointer-events-none">
                <div className="text-primary font-medium">{t.dropFilesHere}</div>
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.py,.js,.ts,.tsx,.jsx,.java,.cpp,.c,.h,.cs,.go,.rs,.rb,.php,.sh,.bash,.yaml,.yml,.json,.xml,.html,.css,.md,.txt,.log,.sql,.graphql,.r,.swift,.kt,.scala,.har"
                multiple
                onChange={onFileSelect}
                className="hidden"
              />

              {!isLoading && (
                <Button
                  onClick={onFileButtonClick}
                  variant="ghost"
                  size="sm"
                  disabled={isLoading || !userId || isAgentLoading || !hasActiveAgent}
                  className="group h-9 w-9 p-0 mb-0.5 rounded-full bg-muted/50 hover:bg-primary/10 text-muted-foreground hover:text-primary flex-shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
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
                placeholder={!userId || isAgentLoading ? t.initializing : !hasActiveAgent ? t.selectAgentRequired : isLoading ? t.typeNextMessage : t.askAnything}
                className="relative z-10 min-h-[36px] max-h-[240px] resize-none bg-transparent w-full px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200 break-words custom-scrollbar"
                disabled={isLoading || !userId || isAgentLoading || !hasActiveAgent}
                rows={1}
              />

              {hasText ? (
                <Button
                  onClick={onSend}
                  variant="ghost"
                  size="sm"
                  disabled={!userId || isAgentLoading || !hasActiveAgent}
                  className="group h-9 w-9 p-0 mb-0.5 rounded-full bg-primary text-primary-foreground hover:bg-primary-active hover:text-primary-foreground flex-shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
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
                  disabled={!userId || isAgentLoading || !hasActiveAgent}
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
                    h-9 px-4 mb-0.5 rounded-full flex-shrink-0
                    transition-all duration-200 hover:scale-105 active:scale-95
                    bg-primary/10 text-primary hover:text-primary hover:bg-primary/15
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

          {inputError && (
            <div className="mt-2 px-2 text-sm text-destructive">
              {inputError}
            </div>
          )}

          {/* Model combobox - positioned underneath chatbox in bottom left */}
          <div className="flex flex-wrap gap-3 justify-start mt-2 px-2 h-8 items-center">
            {agentConfig && onAgentConfigChange && (
              <div className="flex items-center">
                {fixedAgentModel ? (
                  <Combobox
                    options={[{ value: fixedAgentModel, label: getModelDisplayName(fixedAgentModel as ModelOption) }]}
                    value={fixedAgentModel}
                    onValueChange={() => {}}
                    prefix={locale === "zh" ? "Agent 模型：" : "Agent model: "}
                    placeholder={getModelDisplayName(fixedAgentModel as ModelOption)}
                    disabled
                  />
                ) : availableModels === null ? (
                  <ComboboxSkeleton label={t.loadingModels} />
                ) : availableModels.length > 0 ? (
                  <Combobox
                    options={availableModels.map((m) => ({ value: m, label: getModelDisplayName(m as ModelOption) }))}
                    value={displayedModel}
                    onValueChange={handleModelChange}
                    prefix={locale === "zh" ? "模型：" : "Model: "}
                    placeholder={locale === "zh" ? "选择模型..." : "Select model..."}
                    searchPlaceholder={locale === "zh" ? "搜索模型..." : "Search model..."}
                    emptyText={locale === "zh" ? "未找到该模型" : "No model found."}
                    autoFocusSearch={!suppressAndroidVoiceAutoFocus}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
