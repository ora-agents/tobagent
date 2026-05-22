"use client"

import { useState, useCallback, useRef } from "react"
import { Bot, Plus, Pencil, Trash2, Check, X, Upload, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AgentProfile, BuiltinToolId } from "@/lib/types/agent-profiles"
import { BUILTIN_TOOLS } from "@/lib/types/agent-profiles"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

// ---------------------------------------------------------------------------
// Form state for creating / editing a profile
// ---------------------------------------------------------------------------

interface FormState {
  name: string
  description: string
  systemPrompt: string
  enabledTools: BuiltinToolId[]
}

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  systemPrompt: "You are a helpful assistant.",
  enabledTools: ["rag_search", "websearch", "fetch"],
}

// ---------------------------------------------------------------------------
// RAG upload button
// ---------------------------------------------------------------------------

function RagUploadButton({ agentId }: { agentId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !LANGGRAPH_API_URL) return

    setUploading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const resp = await fetch(`${LANGGRAPH_API_URL}/agents/${agentId}/upload`, {
        method: "POST",
        body: form,
      })
      if (!resp.ok) {
        const text = await resp.text()
        setResult(`Upload failed: ${text}`)
      } else {
        const json = await resp.json()
        setResult(`Uploaded ${json.chunks_ingested} chunks from "${file.name}"`)
      }
    } catch (err) {
      setResult(`Upload error: ${err}`)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="w-3.5 h-3.5" />
          {uploading ? "Uploading…" : "Upload Document"}
        </Button>
        <span className="text-xs text-muted-foreground">PDF, TXT, MD</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
      {result && (
        <p className="text-xs text-muted-foreground">{result}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile form (create / edit)
// ---------------------------------------------------------------------------

interface ProfileFormProps {
  initial?: FormState
  onSave: (data: FormState) => void
  onCancel: () => void
  agentId?: string  // present when editing an existing agent
}

function ProfileForm({ initial = DEFAULT_FORM, onSave, onCancel, agentId }: ProfileFormProps) {
  const [form, setForm] = useState<FormState>(initial)

  const toggleTool = (id: BuiltinToolId) => {
    setForm(prev => ({
      ...prev,
      enabledTools: prev.enabledTools.includes(id)
        ? prev.enabledTools.filter(t => t !== id)
        : [...prev.enabledTools, id],
    }))
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          value={form.name}
          onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="My Assistant"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-description">Description</Label>
        <Input
          id="agent-description"
          value={form.description}
          onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What does this agent do?"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-system-prompt">System Prompt</Label>
        <Textarea
          id="agent-system-prompt"
          value={form.systemPrompt}
          onChange={e => setForm(prev => ({ ...prev, systemPrompt: e.target.value }))}
          rows={5}
          placeholder="You are a helpful assistant."
          className="resize-none text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Tools</Label>
        <div className="space-y-2">
          {BUILTIN_TOOLS.map(tool => {
            const enabled = form.enabledTools.includes(tool.id)
            return (
              <label
                key={tool.id}
                className="flex items-start gap-2.5 cursor-pointer group"
                onClick={() => toggleTool(tool.id)}
              >
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                  enabled ? "bg-primary border-primary" : "border-muted-foreground/40 group-hover:border-primary/50"
                }`}>
                  {enabled && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </span>
                <div>
                  <div className="text-sm font-medium">{tool.label}</div>
                  <div className="text-xs text-muted-foreground">{tool.description}</div>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {agentId && form.enabledTools.includes("rag_search") && (
        <div className="space-y-1.5">
          <Label>Knowledge Base</Label>
          <RagUploadButton agentId={agentId} />
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          onClick={() => onSave(form)}
          disabled={!form.name.trim()}
          size="sm"
        >
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; profile: AgentProfile }

interface AgentProfilesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  profiles: AgentProfile[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCreate: (data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) => void
  onUpdate: (id: string, data: Partial<AgentProfile>) => void
  onDelete: (id: string) => void
}

export function AgentProfilesDialog({
  open,
  onOpenChange,
  profiles,
  selectedId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: AgentProfilesDialogProps) {
  const [view, setView] = useState<View>({ kind: "list" })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const handleCreate = useCallback((data: FormState) => {
    onCreate({
      name: data.name.trim(),
      description: data.description.trim(),
      systemPrompt: data.systemPrompt,
      enabledTools: data.enabledTools,
    })
    setView({ kind: "list" })
  }, [onCreate])

  const handleUpdate = useCallback((id: string, data: FormState) => {
    onUpdate(id, {
      name: data.name.trim(),
      description: data.description.trim(),
      systemPrompt: data.systemPrompt,
      enabledTools: data.enabledTools,
    })
    setView({ kind: "list" })
  }, [onUpdate])

  const handleDelete = useCallback((id: string) => {
    onDelete(id)
    setDeleteConfirm(null)
  }, [onDelete])

  // Reset to list view when dialog closes
  const handleOpenChange = (open: boolean) => {
    if (!open) setView({ kind: "list" })
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {view.kind !== "list" && (
              <button
                onClick={() => setView({ kind: "list" })}
                className="mr-1 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {view.kind === "list" && "Agents"}
            {view.kind === "create" && "New Agent"}
            {view.kind === "edit" && "Edit Agent"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {view.kind === "list" && "Select, create, or manage agent profiles"}
            {view.kind === "create" && "Configure a new agent profile"}
            {view.kind === "edit" && "Edit the selected agent profile"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 mt-2">
          {view.kind === "list" && (
            <div className="space-y-2">
              {/* "No agent" option */}
              <button
                onClick={() => { onSelect(null); handleOpenChange(false) }}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors text-sm ${
                  selectedId === null
                    ? "border-primary/60 bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/30"
                }`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                  Default
                  {selectedId === null && <Check className="w-3.5 h-3.5 text-primary ml-auto" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">LangChain documentation assistant</div>
              </button>

              {profiles.map(profile => (
                <div
                  key={profile.id}
                  className={`group relative flex items-start gap-2 px-3 py-2.5 rounded-md border transition-colors cursor-pointer ${
                    selectedId === profile.id
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-muted/30"
                  }`}
                  onClick={() => { onSelect(profile.id); handleOpenChange(false) }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {profile.name}
                      {selectedId === profile.id && <Check className="w-3.5 h-3.5 text-primary ml-auto" />}
                    </div>
                    {profile.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{profile.description}</div>
                    )}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {profile.enabledTools.map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {deleteConfirm === profile.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(profile.id)}
                          className="p-1 rounded text-destructive hover:bg-destructive/10"
                          title="Confirm delete"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="p-1 rounded text-muted-foreground hover:bg-muted"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setView({ kind: "edit", profile })}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(profile.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={() => setView({ kind: "create" })}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border hover:border-primary/40 hover:bg-muted/20 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Agent
              </button>
            </div>
          )}

          {view.kind === "create" && (
            <ProfileForm
              onSave={handleCreate}
              onCancel={() => setView({ kind: "list" })}
            />
          )}

          {view.kind === "edit" && (
            <ProfileForm
              initial={{
                name: view.profile.name,
                description: view.profile.description,
                systemPrompt: view.profile.systemPrompt,
                enabledTools: view.profile.enabledTools,
              }}
              onSave={data => handleUpdate(view.profile.id, data)}
              onCancel={() => setView({ kind: "list" })}
              agentId={view.profile.id}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
