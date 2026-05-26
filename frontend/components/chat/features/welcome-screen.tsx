"use client"

import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FilePreviewGrid } from "./file-preview-grid"
import { VoiceInputButton } from "./voice-input-button"
import type { ImageAttachment } from "@/lib/types"
import type { AgentConfig } from "@/components/layout/agent-settings"
import type { AgentProfile } from "@/lib/types/agent-profiles"
import { MAX_INPUT_CHARS } from "@/lib/constants/features"
import {
  fetchAvailableModels,
  getModelDisplayName,
  type ModelOption,
} from "@/lib/config/deployment-config"
import { useT, useI18n } from "@/lib/i18n"
import { ChevronDown } from "lucide-react"

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
  isVoiceListening?: boolean
  isVoiceSupported?: boolean
  onVoiceToggle?: () => void
  voiceError?: string | null

  // Agent configuration
  agentConfig?: AgentConfig
  onAgentConfigChange?: (config: AgentConfig) => void
  agentProfile?: AgentProfile | null
  onOpenAgentProfiles?: () => void
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
  isVoiceListening,
  isVoiceSupported,
  onVoiceToggle,
  voiceError,
  agentConfig,
  onAgentConfigChange,
  agentProfile,
  onOpenAgentProfiles,
}: WelcomeScreenProps) {
  const t = useT()
  const { locale } = useI18n()
  const [availableModels, setAvailableModels] = useState<ModelOption[] | null>(null)

  useEffect(() => {
    fetchAvailableModels().then(setAvailableModels)
  }, [])

  const handleModelChange = (model: string) => {
    if (agentConfig && onAgentConfigChange) {
      onAgentConfigChange({ ...agentConfig, model })
    }
  }

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
            {/* High-contrast glow layer for visibility */}
            <div className="absolute -inset-1 bg-primary/8 rounded-2xl opacity-70 group-hover:opacity-90 group-focus-within:opacity-100 transition-opacity duration-300" />

            <div
              className={`relative bg-card/95 backdrop-blur-sm border-2 rounded-xl transition-all duration-300 group-hover:bg-card/98 group-focus-within:bg-white/5 group-focus-within:ring-2 group-focus-within:ring-primary/20 ${
                isDragging
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : 'border-border/50 group-hover:border-primary/60 group-focus-within:border-primary/70'
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
                  disabled={isLoading || !userId}
                  className="group h-9 w-9 p-0 mb-0.5 rounded-full bg-muted/50 hover:bg-primary/10 text-muted-foreground hover:text-primary border-0 flex-shrink-0 transition-all duration-200 hover:scale-105 active:scale-95"
                  type="button"
                  title={t.attachFiles}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-4.5 h-4.5"
                  >
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
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
                placeholder={userId ? t.askAnything : t.initializing}
                className="relative z-10 min-h-[36px] max-h-[240px] resize-none bg-transparent border-0 w-full px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 transition-all duration-200 break-words custom-scrollbar"
                disabled={isLoading || !userId}
                rows={1}
              />

              {isVoiceSupported && onVoiceToggle && (
                <VoiceInputButton
                  isListening={isVoiceListening ?? false}
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
                    h-9 px-4 mb-0.5 rounded-full flex-shrink-0
                    transition-all duration-200 hover:scale-105 active:scale-95
                    bg-muted text-primary hover:text-primary hover:bg-muted/80 border-2 border-primary
                    ${isStopping ? 'opacity-60 cursor-not-allowed' : ''}
                  `}
                  type="button"
                  title={isStopping ? t.stopping : t.stop}
                >
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

          {/* Model & Agent selectors - positioned underneath chatbox in bottom left */}
          <div className="flex flex-wrap gap-2 justify-start mt-2 px-2 h-8 items-center text-xs text-muted-foreground">
            {/* Model selector dropdown */}
            {agentConfig && onAgentConfigChange && (
              <div className="flex items-center">
                {availableModels === null ? (
                  <div className="h-8 w-36 rounded-md bg-muted/40 animate-pulse" />
                ) : availableModels.length > 0 ? (
                  <Select value={agentConfig.model} onValueChange={handleModelChange}>
                    <SelectTrigger className="h-8 text-sm border-0 bg-transparent hover:bg-muted/50 px-2 gap-1 w-auto shadow-none font-medium flex items-center text-foreground">
                      <span className="text-muted-foreground mr-1">{locale === "zh" ? "模型：" : "Model: "}</span>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((model) => (
                        <SelectItem key={model} value={model}>
                          {getModelDisplayName(model as ModelOption)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            )}

            {/* Agent selector button */}
            {onOpenAgentProfiles && (
              <div className="flex items-center border-l border-border/40 pl-2">
                <button
                  type="button"
                  onClick={onOpenAgentProfiles}
                  className="h-8 text-sm border-0 bg-transparent hover:bg-muted/50 px-2 gap-1 rounded-md transition-colors font-medium flex items-center text-foreground"
                >
                  <span className="text-muted-foreground mr-1">{locale === "zh" ? "智能体：" : "Agent: "}</span>
                  <span>{agentProfile?.name ?? (locale === "zh" ? "默认系统智能体" : "Default")}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
