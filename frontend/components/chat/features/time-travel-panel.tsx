"use client"

import { History, GitBranch, Clock, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Checkpoint } from "@/lib/hooks/threads"
import { formatDistanceToNow } from "date-fns"
import { useT } from "@/lib/i18n"

interface TimeTravelPanelProps {
  checkpoints: Checkpoint[]
  currentCheckpointId?: string
  onJumpToCheckpoint: (checkpointId: string) => void
  onForkFromCheckpoint: (checkpointId: string) => void
  isOpen: boolean
  onClose: () => void
}

export function TimeTravelPanel({
  checkpoints,
  currentCheckpointId,
  onJumpToCheckpoint,
  onForkFromCheckpoint,
  isOpen,
  onClose,
}: TimeTravelPanelProps) {
  const t = useT()
  if (!isOpen) return null

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col bg-card shadow-depth-hover">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <History className="h-4 w-4" />
            </span>
            <h2 className="font-semibold text-foreground">{t.timeTravel}</h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close time travel panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {checkpoints.length} {t.checkpointsInConversation}
        </p>
      </div>

      {/* Checkpoint List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {checkpoints.map((checkpoint, idx) => {
            // Safely extract checkpoint ID with fallback
            const checkpointId = checkpoint.config?.configurable?.checkpoint_id ||
                                 checkpoint.metadata?.checkpoint_id ||
                                 `checkpoint-${idx}`
            const isCurrent = checkpointId === currentCheckpointId

            return (
              <div
                key={checkpointId}
                className={`cursor-pointer rounded-lg p-3 transition-colors ${
                  isCurrent
                    ? "bg-primary-soft text-primary"
                    : "bg-secondary text-foreground hover:bg-muted"
                }`}
                onClick={() => onJumpToCheckpoint(checkpointId)}
              >
                {/* Step Info */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className={`h-3 w-3 ${isCurrent ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs font-medium ${isCurrent ? "text-primary" : "text-foreground"}`}>
                      {t.step} {checkpoint.metadata?.step ?? idx}
                    </span>
                    {isCurrent && (
                      <span className="rounded bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">{t.current}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {checkpoint.created_at &&
                      formatDistanceToNow(new Date(checkpoint.created_at), {
                        addSuffix: true,
                      })}
                  </span>
                </div>

                {/* Metadata */}
                {checkpoint.metadata?.writes && (
                  <div className="mb-2 text-xs text-muted-foreground">
                    {Object.keys(checkpoint.metadata.writes).map((key) => (
                      <div key={key} className="flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" />
                        <span className="font-mono">{key}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      onJumpToCheckpoint(checkpointId)
                    }}
                  >
                    <History className="w-3 h-3 mr-1" />
                    {t.jumpHere}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      onForkFromCheckpoint(checkpointId)
                    }}
                  >
                    <GitBranch className="w-3 h-3 mr-1" />
                    {t.fork}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
