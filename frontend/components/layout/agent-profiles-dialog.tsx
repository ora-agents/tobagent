"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { Bot, Plus, Pencil, Trash2, Check, X, Upload, ChevronLeft, Wrench, BookOpen, Zap, Cpu } from "lucide-react"
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
import type { KnowledgeBase, Skill, McpServer } from "./management-dashboard"
import { useT, useI18n } from "@/lib/i18n"
import { useAuth } from "@/components/providers/auth-provider"

// ---------------------------------------------------------------------------
// Form state for creating / editing a profile
// ---------------------------------------------------------------------------

interface FormState {
  name: string
  description: string
  systemPrompt: string
  enabledTools: BuiltinToolId[]
  knowledgeBaseIds: string[]
  skillIds: string[]
  mcpIds: string[]
  agentIds: string[]
  wakeWords: string[]
}

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  systemPrompt: "You are a helpful assistant.",
  enabledTools: ["rag_search", "websearch", "fetch"],
  knowledgeBaseIds: [],
  skillIds: [],
  mcpIds: [],
  agentIds: [],
  wakeWords: [],
}

// ---------------------------------------------------------------------------
// Wake words editor (inline component for the profile form)
// ---------------------------------------------------------------------------

function WakeWordsEditor({
  wakeWords,
  onChange,
}: {
  wakeWords: string[]
  onChange: (words: string[]) => void
}) {
  const { locale } = useI18n()
  const [newWord, setNewWord] = useState("")

  const addWord = () => {
    const trimmed = newWord.trim()
    if (trimmed && !wakeWords.includes(trimmed)) {
      onChange([...wakeWords, trimmed])
      setNewWord("")
    }
  }

  return (
    <div className="space-y-1.5 pt-2 border-t border-border">
      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {locale === "zh" ? "唤醒词 (语音唤醒)" : "Wake Words (Voice Activation)"}
      </Label>
      <p className="text-xs text-muted-foreground">
        {locale === "zh"
          ? "说出唤醒词即可开始语音对话，无需点击麦克风按钮。"
          : "Say a wake word to start voice mode without clicking the mic button."}
      </p>

      {wakeWords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {wakeWords.map((word, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs border border-primary/20"
            >
              {word}
              <button
                type="button"
                onClick={() => onChange(wakeWords.filter((_, i) => i !== idx))}
                className="hover:text-destructive transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <Input
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addWord()
            }
          }}
          placeholder={locale === "zh" ? "输入唤醒词，如：小梯小梯" : "Enter wake word, e.g. hey assistant"}
          className="text-sm flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addWord}
          disabled={!newWord.trim()}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// RAG upload button
// ---------------------------------------------------------------------------

function RagUploadButton({ agentId }: { agentId: string }) {
  const t = useT()
  const { user } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !LANGGRAPH_API_URL || !user) return

    setUploading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const resp = await fetch(`${LANGGRAPH_API_URL}/agents/${agentId}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${user.id}` },
        body: form,
      })
      if (!resp.ok) {
        const text = await resp.text()
        setResult(`${t.uploadFailed}: ${text}`)
      } else {
        const json = await resp.json()
        const isZh = typeof window !== "undefined" && localStorage.getItem("locale") !== "en"
        const successMsg = isZh
          ? `已从 "${file.name}" 上传 ${json.chunks_ingested} 个分块`
          : `Uploaded ${json.chunks_ingested} chunks from "${file.name}"`
        setResult(successMsg)
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
          {uploading ? t.uploading : t.uploadDoc}
        </Button>
        <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD, CSV</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv"
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
  knowledgeBases?: KnowledgeBase[]
  skills?: Skill[]
  mcpServers?: McpServer[]
  allProfiles?: AgentProfile[]
}

function ProfileForm({
  initial = DEFAULT_FORM,
  onSave,
  onCancel,
  agentId,
  knowledgeBases = [],
  skills = [],
  mcpServers = [],
  allProfiles = []
}: ProfileFormProps) {
  const t = useT()
  const { locale } = useI18n()
  const [form, setForm] = useState<FormState>(initial)
  const availableAgents = allProfiles.filter(p => p.id !== agentId)

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
        <Label htmlFor="agent-name">{t.agentName}</Label>
        <Input
          id="agent-name"
          value={form.name}
          onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
          placeholder="My Assistant"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-description">{t.agentDesc}</Label>
        <Input
          id="agent-description"
          value={form.description}
          onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What does this agent do?"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="agent-system-prompt">{t.systemPrompt}</Label>
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
        <Label>{t.tools}</Label>
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

      {/* Wake Words (KWS) */}
      <WakeWordsEditor
        wakeWords={form.wakeWords}
        onChange={(wakeWords) => setForm(prev => ({ ...prev, wakeWords }))}
      />

      {form.enabledTools.includes("rag_search") && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.exclusiveKnowledgeBase}</Label>
            {agentId ? (
              <RagUploadButton agentId={agentId} />
            ) : (
              <p className="text-xs text-muted-foreground italic">{t.pleaseSaveAgentFirstToUpload}</p>
            )}
          </div>
          
          {knowledgeBases && knowledgeBases.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkedSharedKnowledgeBases}</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-1">
                {knowledgeBases.map((kb) => {
                  const linked = form.knowledgeBaseIds?.includes(kb.id)
                  return (
                    <label
                      key={kb.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                      onClick={() => {
                        const nextIds = linked
                          ? (form.knowledgeBaseIds || []).filter(id => id !== kb.id)
                          : [...(form.knowledgeBaseIds || []), kb.id];
                        setForm(prev => ({ ...prev, knowledgeBaseIds: nextIds }))
                      }}
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                      }`}>
                        {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{kb.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{kb.files?.length || 0} {t.filesLabel}</div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {skills && skills.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkCustomSkills}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-1">
            {skills.map((sk) => {
              const linked = form.skillIds?.includes(sk.id)
              return (
                <label
                  key={sk.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                  onClick={() => {
                    const nextIds = linked
                      ? (form.skillIds || []).filter(id => id !== sk.id)
                      : [...(form.skillIds || []), sk.id];
                    setForm(prev => ({ ...prev, skillIds: nextIds }))
                  }}
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                  }`}>
                    {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{sk.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{sk.description || t.noDescription}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {mcpServers && mcpServers.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkMcpServers}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-1">
            {mcpServers.map((mcp) => {
              const linked = form.mcpIds?.includes(mcp.id)
              return (
                <label
                  key={mcp.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                  onClick={() => {
                    const nextIds = linked
                      ? (form.mcpIds || []).filter(id => id !== mcp.id)
                      : [...(form.mcpIds || []), mcp.id];
                    setForm(prev => ({ ...prev, mcpIds: nextIds }))
                  }}
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                  }`}>
                    {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{mcp.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{mcp.type.toUpperCase()} | {mcp.url}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {availableAgents && availableAgents.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {locale === "zh" ? "关联其他智能体 (多智能体协同)" : "Link Other Agents (Multi-Agent)"}
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-1">
            {availableAgents.map((agent) => {
              const linked = form.agentIds?.includes(agent.id)
              return (
                <label
                  key={agent.id}
                  className="flex items-center gap-2 p-2 rounded-lg border border-border bg-card hover:bg-accent/40 cursor-pointer transition-colors"
                  onClick={() => {
                    const nextIds = linked
                      ? (form.agentIds || []).filter(id => id !== agent.id)
                      : [...(form.agentIds || []), agent.id];
                    setForm(prev => ({ ...prev, agentIds: nextIds }))
                  }}
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                    linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                  }`}>
                    {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{agent.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{agent.description || (locale === "zh" ? "无描述" : "No description")}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}


      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          onClick={() => onSave(form)}
          disabled={!form.name.trim()}
          size="sm"
        >
          {t.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t.cancel}
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
  onCreate: (data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) => Promise<AgentProfile | null> | void
  onUpdate: (id: string, data: Partial<AgentProfile>) => void
  onDelete: (id: string) => void
  knowledgeBases?: KnowledgeBase[]
  skills?: Skill[]
  mcpServers?: McpServer[]
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
  knowledgeBases: initialKnowledgeBases = [],
  skills: initialSkills = [],
  mcpServers: initialMcpServers = [],
}: AgentProfilesDialogProps) {
  const t = useT()
  const { locale } = useI18n()
  const { user } = useAuth()
  const authHeaders = useMemo(
    () => user ? { Authorization: `Bearer ${user.id}` } : undefined,
    [user],
  )
  const [view, setView] = useState<View>({ kind: "list" })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>(initialKnowledgeBases)
  const [skills, setSkills] = useState<Skill[]>(initialSkills)
  const [mcpServers, setMcpServers] = useState<McpServer[]>(initialMcpServers)

  // Auto-fetch shared KBs, skills, and MCPs when dialog is opened
  useEffect(() => {
    if (open && LANGGRAPH_API_URL && authHeaders) {
      fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases`, { headers: authHeaders })
        .then(res => res.ok ? res.json() : [])
        .then(data => setKnowledgeBases(data))
        .catch(err => console.error("Failed to fetch KBs in AgentProfilesDialog", err))

      fetch(`${LANGGRAPH_API_URL}/api/skills`, { headers: authHeaders })
        .then(res => res.ok ? res.json() : [])
        .then(data => setSkills(data))
        .catch(err => console.error("Failed to fetch Skills in AgentProfilesDialog", err))

      fetch(`${LANGGRAPH_API_URL}/api/mcp-servers`, { headers: authHeaders })
        .then(res => res.ok ? res.json() : [])
        .then(data => setMcpServers(data))
        .catch(err => console.error("Failed to fetch MCPs in AgentProfilesDialog", err))
    }
  }, [open, authHeaders])

  const handleCreate = useCallback((data: FormState) => {
    const res = onCreate({
      name: data.name.trim(),
      description: data.description.trim(),
      systemPrompt: data.systemPrompt,
      enabledTools: data.enabledTools,
      knowledgeBaseIds: data.knowledgeBaseIds,
      skillIds: data.skillIds,
      mcpIds: data.mcpIds,
      agentIds: data.agentIds,
      wakeWords: data.wakeWords,
    } as any)

    if (res && typeof res.then === "function") {
      res.then((created) => {
        if (created) {
          onSelect(created.id)
          handleOpenChange(false)
        }
      })
    } else {
      setView({ kind: "list" })
    }
  }, [onCreate, onSelect])

  const handleUpdate = useCallback((id: string, data: FormState) => {
    onUpdate(id, {
      name: data.name.trim(),
      description: data.description.trim(),
      systemPrompt: data.systemPrompt,
      enabledTools: data.enabledTools,
      knowledgeBaseIds: data.knowledgeBaseIds,
      skillIds: data.skillIds,
      mcpIds: data.mcpIds,
      agentIds: data.agentIds,
      wakeWords: data.wakeWords,
    } as any)
    
    // Auto-select updated agent and close the dialog
    onSelect(id)
    handleOpenChange(false)
  }, [onUpdate, onSelect])

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
            {view.kind === "list" && t.agents}
            {view.kind === "create" && t.newAgent}
            {view.kind === "edit" && t.editAgent}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {view.kind === "list" && t.selectCreateOrManageAgents}
            {view.kind === "create" && t.configureNewAgent}
            {view.kind === "edit" && t.editSelectedAgent}
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
                  {t.defaultSystemAgent}
                  {selectedId === null && <Check className="w-3.5 h-3.5 text-primary ml-auto" />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t.defaultSystemAgentDesc}
                </div>
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
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {profile.enabledTools && profile.enabledTools.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15 flex items-center gap-0.5" title={profile.enabledTools.join(", ")}>
                          <Wrench className="w-2.5 h-2.5" />
                          {profile.enabledTools.length} {locale === "zh" ? "工具" : "Tools"}
                        </span>
                      )}
                      {profile.knowledgeBaseIds && profile.knowledgeBaseIds.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-blue-500/10 text-blue-500 dark:text-blue-400 border border-blue-500/15 flex items-center gap-0.5">
                          <BookOpen className="w-2.5 h-2.5" />
                          {profile.knowledgeBaseIds.length} {locale === "zh" ? "知识库" : "KBs"}
                        </span>
                      )}
                      {profile.skillIds && profile.skillIds.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-500 dark:text-purple-400 border border-purple-500/15 flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" />
                          {profile.skillIds.length} {locale === "zh" ? "技能" : "Skills"}
                        </span>
                      )}
                      {profile.mcpIds && profile.mcpIds.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/15 flex items-center gap-0.5">
                          <Cpu className="w-2.5 h-2.5" />
                          {profile.mcpIds.length} MCP
                        </span>
                      )}
                      {(profile as any).agentIds && (profile as any).agentIds.length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-rose-500/15 flex items-center gap-0.5">
                          <Bot className="w-2.5 h-2.5" />
                          {(profile as any).agentIds.length} {locale === "zh" ? "协同" : "Agents"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {deleteConfirm === profile.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(profile.id)}
                          className="p-1 rounded text-destructive hover:bg-destructive/10"
                          title={t.confirmDelete}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="p-1 rounded text-muted-foreground hover:bg-muted"
                          title={t.cancel}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setView({ kind: "edit", profile })}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          title={t.editTitle}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(profile.id)}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title={t.delete}
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
                {t.newAgent}
              </button>
            </div>
          )}

          {view.kind === "create" && (
            <ProfileForm
              onSave={handleCreate}
              onCancel={() => setView({ kind: "list" })}
              knowledgeBases={knowledgeBases}
              skills={skills}
              mcpServers={mcpServers}
              allProfiles={profiles}
            />
          )}

          {view.kind === "edit" && (
            <ProfileForm
              initial={{
                name: view.profile.name,
                description: view.profile.description,
                systemPrompt: view.profile.systemPrompt,
                enabledTools: view.profile.enabledTools,
                knowledgeBaseIds: (view.profile as any).knowledgeBaseIds || [],
                skillIds: (view.profile as any).skillIds || [],
                mcpIds: (view.profile as any).mcpIds || [],
                agentIds: (view.profile as any).agentIds || [],
                wakeWords: (view.profile as any).wakeWords || [],
              }}
              onSave={data => handleUpdate(view.profile.id, data)}
              onCancel={() => setView({ kind: "list" })}
              agentId={view.profile.id}
              knowledgeBases={knowledgeBases}
              skills={skills}
              mcpServers={mcpServers}
              allProfiles={profiles}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
