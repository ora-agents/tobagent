"use client"

import React, { useState, useEffect, useCallback, useRef } from "react"
import {
  Wrench,
  Bot,
  Database,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  FileText,
  Upload,
  BookOpen,
  Code2,
  PlusCircle,
  HelpCircle,
  File
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import type { AgentProfile, BuiltinToolId } from "@/lib/types/agent-profiles"
import { BUILTIN_TOOLS } from "@/lib/types/agent-profiles"

// ---------------------------------------------------------------------------
// Skills Data Types & Storage
// ---------------------------------------------------------------------------
export interface Skill {
  id: string
  name: string
  description: string
  content: string
  createdAt: string
  updatedAt: string
}

const SKILLS_STORAGE_KEY = "skills-profiles"

const DEFAULT_SKILL_TEMPLATE = `---
name: my-skill
description: Describe what this skill does and when to use it. Include clear trigger situations, major capabilities, and important constraints.
license: Apache-2.0
compatibility: Requires Python 3.11+, bash, and internet access
metadata:
  author: your-org
  version: "1.0.0"
  category: engineering
allowed-tools: Bash Read Write Edit
---

# Purpose

This skill helps the agent perform a specific task reliably and consistently.

Use this skill when:
- The user asks for this exact kind of task.
- The task matches the trigger conditions described in \`description\`.
- The task requires the conventions, constraints, or workflows defined here.

Do not use this skill when:
- The request is unrelated.
- The environment requirements are not available.
- Another specialized skill is a better match.

# Scope

This skill is responsible for:
- Task A
- Task B
- Task C

This skill is not responsible for:
- External approvals
- Manual dashboard-only operations
- Tasks requiring unsupported tools

# Inputs

Expected inputs may include:
- User goal
- Source files
- Environment constraints
- Desired output format

Before starting, confirm:
1. What the user wants produced.
2. Which files or inputs are available.
3. Any constraints on tools, format, or style.

# Workflow

1. Understand the user's objective.
2. Identify required files, parameters, and constraints.
3. Choose the correct approach using the decision rules below.
4. Execute the task in the required order.
5. Validate the output.
6. Return results in the expected format.

# Decision rules

| Situation | Action |
|---|---|
| Input is incomplete | Ask for the missing minimum details |
| Multiple valid strategies exist | Choose the simplest one that satisfies constraints |
| A required dependency is missing | Stop and explain what is missing |
| A step is risky or destructive | Ask for confirmation first |

# Constraints

Always follow these rules:
- Prefer deterministic, repeatable steps.
- Do not assume unavailable tools.
- Do not fabricate files, results, or external states.
- Preserve user data unless explicitly told to modify it.
- Surface blocking issues early.

# Output requirements

The final result should:
- Match the requested format
- Include only necessary explanation
- Be validated before returning
- Highlight any assumptions or limitations

# Validation checklist

Before finishing, verify:
- The output is complete
- The format is correct
- The task requirements were satisfied
- No forbidden action was taken
- Any important caveats were stated

# Edge cases

Handle these carefully:
- Missing inputs
- Invalid file formats
- Partial success
- Conflicting user instructions
- Unsupported environments

# Common mistakes

Avoid:
- Using deprecated files or APIs
- Skipping required validation
- Choosing tools not allowed in this environment
- Producing verbose output when concise output is expected

# References

For detailed guidance, see:
- [Reference guide](references/REFERENCE.md)
- [Examples](references/EXAMPLES.md)

# Scripts

If needed, use:
- \`scripts/run.sh\`
- \`scripts/process.py\`
`

// ---------------------------------------------------------------------------
// Knowledge Base Types & Storage
// ---------------------------------------------------------------------------
export interface KBFile {
  name: string
  size: number
  uploadedAt: string
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  files: KBFile[]
  createdAt: string
  updatedAt: string
}

const KB_STORAGE_KEY = "knowledge-bases"

// ---------------------------------------------------------------------------
// Properties Interface
// ---------------------------------------------------------------------------
interface ManagementDashboardProps {
  initialTab: "skills" | "agents" | "knowledge"
  onBackToChat: () => void
  // Agent Profiles bindings
  agentProfiles: AgentProfile[]
  selectedAgentProfileId: string | null
  setSelectedAgentProfileId: (id: string | null) => void
  createAgentProfile: (data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) => AgentProfile
  updateAgentProfile: (id: string, data: Partial<Omit<AgentProfile, "id" | "createdAt">>) => void
  deleteAgentProfile: (id: string) => void
}

export function ManagementDashboard({
  initialTab,
  onBackToChat,
  agentProfiles,
  selectedAgentProfileId,
  setSelectedAgentProfileId,
  createAgentProfile,
  updateAgentProfile,
  deleteAgentProfile
}: ManagementDashboardProps) {
  const t = useT()
  const [activeTab, setActiveTab] = useState<"skills" | "agents" | "knowledge">(initialTab)

  // ---------------------------------------------------------------------------
  // Local States
  // ---------------------------------------------------------------------------
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [isEditingSkill, setIsEditingSkill] = useState(false)
  const [isCreatingSkill, setIsCreatingSkill] = useState(false)
  const [skillForm, setSkillForm] = useState({ name: "", description: "", content: "" })

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKBId, setSelectedKBId] = useState<string | null>(null)
  const [isEditingKB, setIsEditingKB] = useState(false)
  const [isCreatingKB, setIsCreatingKB] = useState(false)
  const [kbForm, setKbForm] = useState({ name: "", description: "" })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingFile, setUploadingFile] = useState(false)

  const [agentForm, setAgentForm] = useState<{
    name: string
    description: string
    systemPrompt: string
    enabledTools: BuiltinToolId[]
  }>({ name: "", description: "", systemPrompt: "", enabledTools: [] })
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isEditingAgent, setIsEditingAgent] = useState(false)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load local data on Mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedSkills = localStorage.getItem(SKILLS_STORAGE_KEY)
      if (savedSkills) {
        try {
          const parsed = JSON.parse(savedSkills)
          setSkills(parsed)
          if (parsed.length > 0) setSelectedSkillId(parsed[0].id)
        } catch { /* noop */ }
      }

      const savedKBs = localStorage.getItem(KB_STORAGE_KEY)
      if (savedKBs) {
        try {
          const parsed = JSON.parse(savedKBs)
          setKnowledgeBases(parsed)
          if (parsed.length > 0) setSelectedKBId(parsed[0].id)
        } catch { /* noop */ }
      }
    }
  }, [])

  // Sync to activeTab change from props
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  // Save Skills
  const saveSkillsToLocalStorage = (newSkills: Skill[]) => {
    setSkills(newSkills)
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(newSkills))
  }

  // Save Knowledge Bases
  const saveKBsToLocalStorage = (newKBs: KnowledgeBase[]) => {
    setKnowledgeBases(newKBs)
    localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(newKBs))
  }

  // ---------------------------------------------------------------------------
  // Skills Actions
  // ---------------------------------------------------------------------------
  const handleSelectSkill = (id: string) => {
    setSelectedSkillId(id)
    setIsEditingSkill(false)
    setIsCreatingSkill(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateSkill = () => {
    setIsCreatingSkill(true)
    setIsEditingSkill(false)
    setSkillForm({
      name: "",
      description: "",
      content: DEFAULT_SKILL_TEMPLATE
    })
    setDeleteConfirmId(null)
  }

  const handleStartEditSkill = (skill: Skill) => {
    setIsEditingSkill(true)
    setIsCreatingSkill(false)
    setSkillForm({
      name: skill.name,
      description: skill.description,
      content: skill.content
    })
    setDeleteConfirmId(null)
  }

  const handleSaveSkill = () => {
    if (!skillForm.name.trim()) return

    const now = new Date().toISOString()
    if (isCreatingSkill) {
      const newSkill: Skill = {
        id: crypto.randomUUID(),
        name: skillForm.name.trim(),
        description: skillForm.description.trim(),
        content: skillForm.content,
        createdAt: now,
        updatedAt: now
      }
      const updated = [...skills, newSkill]
      saveSkillsToLocalStorage(updated)
      setSelectedSkillId(newSkill.id)
      setIsCreatingSkill(false)
    } else if (isEditingSkill && selectedSkillId) {
      const updated = skills.map(sk =>
        sk.id === selectedSkillId
          ? {
              ...sk,
              name: skillForm.name.trim(),
              description: skillForm.description.trim(),
              content: skillForm.content,
              updatedAt: now
            }
          : sk
      )
      saveSkillsToLocalStorage(updated)
      setIsEditingSkill(false)
    }
  }

  const handleDeleteSkill = (id: string) => {
    const updated = skills.filter(sk => sk.id !== id)
    saveSkillsToLocalStorage(updated)
    setDeleteConfirmId(null)
    if (updated.length > 0) {
      setSelectedSkillId(updated[0].id)
    } else {
      setSelectedSkillId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Agents Actions
  // ---------------------------------------------------------------------------
  const handleSelectAgent = (id: string | null) => {
    setSelectedAgentId(id)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateAgent = () => {
    setIsCreatingAgent(true)
    setIsEditingAgent(false)
    setAgentForm({
      name: "",
      description: "",
      systemPrompt: "You are a helpful assistant.",
      enabledTools: ["rag_search", "websearch", "fetch"]
    })
    setDeleteConfirmId(null)
  }

  const handleStartEditAgent = (profile: AgentProfile) => {
    setIsEditingAgent(true)
    setIsCreatingAgent(false)
    setAgentForm({
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt,
      enabledTools: profile.enabledTools
    })
    setDeleteConfirmId(null)
  }

  const handleSaveAgent = () => {
    if (!agentForm.name.trim()) return

    if (isCreatingAgent) {
      const created = createAgentProfile({
        name: agentForm.name.trim(),
        description: agentForm.description.trim(),
        systemPrompt: agentForm.systemPrompt,
        enabledTools: agentForm.enabledTools
      })
      setSelectedAgentId(created.id)
      setIsCreatingAgent(false)
    } else if (isEditingAgent && selectedAgentId) {
      updateAgentProfile(selectedAgentId, {
        name: agentForm.name.trim(),
        description: agentForm.description.trim(),
        systemPrompt: agentForm.systemPrompt,
        enabledTools: agentForm.enabledTools
      })
      setIsEditingAgent(false)
    }
  }

  const handleDeleteAgent = (id: string) => {
    deleteAgentProfile(id)
    setDeleteConfirmId(null)
    setSelectedAgentId(null)
  }

  const handleToggleTool = (toolId: BuiltinToolId) => {
    setAgentForm(prev => {
      const alreadyEnabled = prev.enabledTools.includes(toolId)
      const nextTools = alreadyEnabled
        ? prev.enabledTools.filter(t => t !== toolId)
        : [...prev.enabledTools, toolId]
      return { ...prev, enabledTools: nextTools }
    })
  }

  // ---------------------------------------------------------------------------
  // Knowledge Base Actions
  // ---------------------------------------------------------------------------
  const handleSelectKB = (id: string) => {
    setSelectedKBId(id)
    setIsEditingKB(false)
    setIsCreatingKB(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateKB = () => {
    setIsCreatingKB(true)
    setIsEditingKB(false)
    setKbForm({ name: "", description: "" })
    setDeleteConfirmId(null)
  }

  const handleStartEditKB = (kb: KnowledgeBase) => {
    setIsEditingKB(true)
    setIsCreatingKB(false)
    setKbForm({ name: kb.name, description: kb.description })
    setDeleteConfirmId(null)
  }

  const handleSaveKB = () => {
    if (!kbForm.name.trim()) return

    const now = new Date().toISOString()
    if (isCreatingKB) {
      const newKB: KnowledgeBase = {
        id: crypto.randomUUID(),
        name: kbForm.name.trim(),
        description: kbForm.description.trim(),
        files: [],
        createdAt: now,
        updatedAt: now
      }
      const updated = [...knowledgeBases, newKB]
      saveKBsToLocalStorage(updated)
      setSelectedKBId(newKB.id)
      setIsCreatingKB(false)
    } else if (isEditingKB && selectedKBId) {
      const updated = knowledgeBases.map(kb =>
        kb.id === selectedKBId
          ? {
              ...kb,
              name: kbForm.name.trim(),
              description: kbForm.description.trim(),
              updatedAt: now
            }
          : kb
      )
      saveKBsToLocalStorage(updated)
      setIsEditingKB(false)
    }
  }

  const handleDeleteKB = (id: string) => {
    const updated = knowledgeBases.filter(kb => kb.id !== id)
    saveKBsToLocalStorage(updated)
    setDeleteConfirmId(null)
    if (updated.length > 0) {
      setSelectedKBId(updated[0].id)
    } else {
      setSelectedKBId(null)
    }
  }

  const handleTriggerUpload = () => {
    fileInputRef.current?.click()
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedKBId) return

    setUploadingFile(true)
    setTimeout(() => {
      const updated = knowledgeBases.map(kb => {
        if (kb.id === selectedKBId) {
          const fileExists = kb.files.some(f => f.name === file.name)
          if (fileExists) return kb

          const newFile: KBFile = {
            name: file.name,
            size: file.size,
            uploadedAt: new Date().toISOString()
          }
          return {
            ...kb,
            files: [...kb.files, newFile],
            updatedAt: new Date().toISOString()
          }
        }
        return kb
      })
      saveKBsToLocalStorage(updated)
      setUploadingFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }, 800)
  }

  const handleDeleteKBFile = (fileName: string) => {
    if (!selectedKBId) return
    const updated = knowledgeBases.map(kb => {
      if (kb.id === selectedKBId) {
        return {
          ...kb,
          files: kb.files.filter(f => f.name !== fileName),
          updatedAt: new Date().toISOString()
        }
      }
      return kb
    })
    saveKBsToLocalStorage(updated)
  }

  // Format Helper
  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return "0 Bytes"
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
  }

  // Current Selections
  const selectedSkill = skills.find(sk => sk.id === selectedSkillId) || null
  const selectedAgent = selectedAgentId === null ? null : (agentProfiles.find(p => p.id === selectedAgentId) || null)
  const selectedKB = knowledgeBases.find(kb => kb.id === selectedKBId) || null

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* 1. Header Area */}
      <header className="h-16 px-6 border-b border-border/60 bg-background/95 backdrop-blur flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide flex items-center gap-1.5 font-display">
              {t.management}
            </h1>
            <p className="text-[11px] text-muted-foreground/80 leading-none">
              Configure and orchestrate your custom assets
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onBackToChat}
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200 border-border/80 shadow-depth-xs rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.backToChat}
        </Button>
      </header>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Content Detail View */}
        <main className="flex-1 flex overflow-hidden bg-background">
          {/* ========================================== */}
          {/* SKILLS TAB PANEL                           */}
          {/* ========================================== */}
          {activeTab === "skills" && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Skill List */}
              <div className="w-[300px] border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.skillsManager}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleStartCreateSkill}
                    className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none"
                    title={t.addSkill}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {skills.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground/80">
                      <Wrench className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40 opacity-70" />
                      {t.noSkills}
                    </div>
                  ) : (
                    skills.map(skill => (
                      <div
                        key={skill.id}
                        onClick={() => handleSelectSkill(skill.id)}
                        className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                          selectedSkillId === skill.id
                            ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                            : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                        }`}
                      >
                        <div className="font-semibold text-sm truncate pr-16">{skill.name}</div>
                        <div className="text-xs text-muted-foreground mt-1 truncate pr-8">
                          {skill.description || "No description provided"}
                        </div>

                        {/* List Actions */}
                        <div
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}
                        >
                          {deleteConfirmId === skill.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteSkill(skill.id)}
                                className="p-1 rounded text-destructive hover:bg-destructive/10"
                                title="Confirm delete"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1 rounded text-muted-foreground hover:bg-muted"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEditSkill(skill)}
                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(skill.id)}
                                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Skill Edit Form / Details */}
              <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent flex flex-col">
                {isCreatingSkill || isEditingSkill ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Code2 className="w-5 h-5 text-primary" />
                        {isCreatingSkill ? t.addSkill : t.editSkill}
                      </h2>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSaveSkill}
                          disabled={!skillForm.name.trim()}
                          className="bg-primary hover:bg-primary-active text-primary-foreground rounded-lg cursor-pointer"
                        >
                          {t.save}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setIsEditingSkill(false)
                            setIsCreatingSkill(false)
                          }}
                          className="rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer"
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="skill-name">{t.skillName}</Label>
                        <Input
                          id="skill-name"
                          value={skillForm.name}
                          onChange={e => setSkillForm({ ...skillForm, name: e.target.value })}
                          placeholder="my-awesome-skill"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="skill-desc">{t.skillDesc}</Label>
                        <Input
                          id="skill-desc"
                          value={skillForm.description}
                          onChange={e => setSkillForm({ ...skillForm, description: e.target.value })}
                          placeholder="What tasks does this skill accomplish?"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="skill-content">{t.skillContent}</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSkillForm({ ...skillForm, content: DEFAULT_SKILL_TEMPLATE })}
                          className="text-[11px] h-7 px-2 hover:bg-primary/10 hover:text-primary gap-1"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          {t.skillTemplate}
                        </Button>
                      </div>
                      <Textarea
                        id="skill-content"
                        value={skillForm.content}
                        onChange={e => setSkillForm({ ...skillForm, content: e.target.value })}
                        rows={16}
                        placeholder="Add skill rules and template text..."
                        className="resize-none font-mono text-xs bg-background border-border/80 leading-relaxed rounded-lg"
                      />
                    </div>


                  </div>
                ) : selectedSkill ? (
                  <div className="max-w-2xl space-y-4 flex-1 flex flex-col">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display">{selectedSkill.name}</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedSkill.description || "No description provided."}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartEditSkill(selectedSkill)}
                        className="gap-1.5 border-border hover:bg-primary/10 hover:text-primary rounded-lg"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {t.editSkill}
                      </Button>
                    </div>

                    <div className="flex-1 flex flex-col bg-background/50 border border-border/40 rounded-xl overflow-hidden shadow-inset-light mt-4">
                      <div className="px-4 py-2 border-b border-border/30 bg-muted/20 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase font-mono">
                          SKILL TEXT MARKDOWN
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(selectedSkill.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex-1 p-4 overflow-auto font-mono text-xs text-muted-foreground/90 whitespace-pre-wrap leading-relaxed select-all">
                        {selectedSkill.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">Select a skill to view or create a new one.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStartCreateSkill}
                        className="mt-3 gap-1.5 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-lg"
                      >
                        <Plus className="w-4 h-4 text-primary" />
                        {t.addSkill}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* AGENTS TAB PANEL                           */}
          {/* ========================================== */}
          {activeTab === "agents" && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left Agent List */}
              <div className="w-[300px] border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.agentsManager}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleStartCreateAgent}
                    className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none"
                    title={t.addAgent}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {/* Default Built-in Agent */}
                  <div
                    onClick={() => handleSelectAgent(null)}
                    className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                      selectedAgentId === null
                        ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                        : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                    }`}
                  >
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-primary" />
                      Default Agent
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      LangChain documentation assistant
                    </div>
                  </div>

                  {/* Custom Agents */}
                  {agentProfiles.map(profile => (
                    <div
                      key={profile.id}
                      onClick={() => handleSelectAgent(profile.id)}
                      className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                        selectedAgentId === profile.id
                          ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                          : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                      }`}
                    >
                      <div className="font-semibold text-sm flex items-center gap-1.5 truncate pr-16">
                        <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                        {profile.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate pr-8">
                        {profile.description || "No description provided"}
                      </div>

                      {/* List Actions */}
                      <div
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        {deleteConfirmId === profile.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteAgent(profile.id)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10"
                              title="Confirm delete"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="p-1 rounded text-muted-foreground hover:bg-muted"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEditAgent(profile)}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(profile.id)}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Agent Form / Details */}
              <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
                {isCreatingAgent || isEditingAgent ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        {isCreatingAgent ? t.addAgent : t.editAgent}
                      </h2>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSaveAgent}
                          disabled={!agentForm.name.trim()}
                          className="bg-primary hover:bg-primary-active text-primary-foreground rounded-lg cursor-pointer"
                        >
                          {t.save}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setIsEditingAgent(false)
                            setIsCreatingAgent(false)
                          }}
                          className="rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer"
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-name">{t.agentName}</Label>
                        <Input
                          id="agent-name"
                          value={agentForm.name}
                          onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                          placeholder="Custom Agent"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-desc">{t.agentDesc}</Label>
                        <Input
                          id="agent-desc"
                          value={agentForm.description}
                          onChange={e => setAgentForm({ ...agentForm, description: e.target.value })}
                          placeholder="Short description of this agent"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="agent-prompt">{t.systemPrompt}</Label>
                      <Textarea
                        id="agent-prompt"
                        value={agentForm.systemPrompt}
                        onChange={e => setAgentForm({ ...agentForm, systemPrompt: e.target.value })}
                        rows={6}
                        placeholder="You are a helpful assistant..."
                        className="resize-none bg-background border-border/80 rounded-lg text-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t.tools}</Label>
                      <div className="space-y-2 border border-border/50 rounded-xl p-3 bg-background/50">
                        {BUILTIN_TOOLS.map(tool => {
                          const enabled = agentForm.enabledTools.includes(tool.id)
                          return (
                            <div
                              key={tool.id}
                              onClick={() => handleToggleTool(tool.id)}
                              className="flex items-start gap-3 cursor-pointer group p-2 rounded-lg hover:bg-muted/20"
                            >
                              <span
                                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                                  enabled ? "bg-primary border-primary" : "border-muted-foreground/40 group-hover:border-primary/50"
                                }`}
                              >
                                {enabled && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </span>
                              <div>
                                <div className="text-sm font-medium">{tool.label}</div>
                                <div className="text-xs text-muted-foreground">{tool.description}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>


                  </div>
                ) : selectedAgentId !== null && selectedAgent ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Bot className="w-6 h-6 text-primary" />
                          {selectedAgent.name}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedAgent.description || "No description provided."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={selectedAgentProfileId === selectedAgent.id ? "secondary" : "outline"}
                          size="sm"
                          onClick={() => setSelectedAgentProfileId(selectedAgent.id)}
                          className={`gap-1.5 rounded-lg border transition-all ${
                            selectedAgentProfileId === selectedAgent.id
                              ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                              : "border-border hover:bg-primary/10 hover:text-primary"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          {selectedAgentProfileId === selectedAgent.id ? "Selected" : "Set Active"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEditAgent(selectedAgent)}
                          className="gap-1.5 border-border hover:bg-primary/10 hover:text-primary rounded-lg"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t.editAgent}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4 mt-6">
                      <div className="border border-border/40 rounded-xl bg-background/50 overflow-hidden">
                        <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                          <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase font-mono">
                            SYSTEM INSTRUCTIONS
                          </span>
                        </div>
                        <div className="p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {selectedAgent.systemPrompt}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          ENABLED TOOLS
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {BUILTIN_TOOLS.map(tool => {
                            const isEnabled = selectedAgent.enabledTools.includes(tool.id)
                            return (
                              <div
                                key={tool.id}
                                className={`p-3 border rounded-xl flex flex-col justify-between transition-all ${
                                  isEnabled
                                    ? "border-primary/30 bg-primary/5"
                                    : "border-border/60 bg-muted/5 opacity-60"
                                }`}
                              >
                                <div>
                                  <div className="text-xs font-bold font-mono text-foreground flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? "bg-primary" : "bg-muted-foreground/50"}`} />
                                    {tool.label}
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                                    {tool.description}
                                  </p>
                                </div>
                                <span className={`text-[10px] font-mono mt-3 self-start px-1.5 py-0.5 rounded font-bold ${isEnabled ? "bg-primary/15 text-primary border border-primary/20" : "bg-muted text-muted-foreground"}`}>
                                  {isEnabled ? "ENABLED" : "DISABLED"}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : selectedAgentId === null ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Bot className="w-6 h-6 text-primary" />
                          Default System Agent
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          The preconfigured documentation assistant helper.
                        </p>
                      </div>
                      <Button
                        variant={selectedAgentProfileId === null ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setSelectedAgentProfileId(null)}
                        className={`gap-1.5 rounded-lg border transition-all ${
                          selectedAgentProfileId === null
                            ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                            : "border-border hover:bg-primary/10 hover:text-primary"
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        {selectedAgentProfileId === null ? "Selected" : "Set Active"}
                      </Button>
                    </div>

                    <div className="border border-border/40 rounded-xl bg-background/50 overflow-hidden mt-6">
                      <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                        <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase font-mono">
                          SYSTEM INFORMATION
                        </span>
                      </div>
                      <div className="p-4 text-sm text-muted-foreground leading-relaxed space-y-2">
                        <p>This is the standard builtin LangChain agent. It has the primary knowledge base (RAG Search), Fetch capabilities, and standard model definitions enabled.</p>
                        <p>Customize it by clicking the "+" icon on the left panel to create your own bespoke assistant model with custom prompts and specialized tools.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Bot className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">Select an Agent configuration or create a new one.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStartCreateAgent}
                        className="mt-3 gap-1.5 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-lg"
                      >
                        <Plus className="w-4 h-4 text-primary" />
                        {t.addAgent}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* KNOWLEDGE BASE TAB PANEL                   */}
          {/* ========================================== */}
          {activeTab === "knowledge" && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left KB List */}
              <div className="w-[300px] border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.kbManager}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleStartCreateKB}
                    className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none"
                    title={t.addKnowledge}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {knowledgeBases.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground/80">
                      <Database className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40 opacity-70" />
                      {t.noKB}
                    </div>
                  ) : (
                    knowledgeBases.map(kb => (
                      <div
                        key={kb.id}
                        onClick={() => handleSelectKB(kb.id)}
                        className={`group relative p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                          selectedKBId === kb.id
                            ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                            : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                        }`}
                      >
                        <div className="font-semibold text-sm truncate pr-16">{kb.name}</div>
                        <div className="text-xs text-muted-foreground mt-1 truncate pr-8 flex items-center gap-1">
                          <FileText className="w-3 h-3 flex-shrink-0 text-muted-foreground/75" />
                          {kb.files.length} {kb.files.length === 1 ? "file" : "files"}
                        </div>

                        {/* List Actions */}
                        <div
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}
                        >
                          {deleteConfirmId === kb.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteKB(kb.id)}
                                className="p-1 rounded text-destructive hover:bg-destructive/10"
                                title="Confirm delete"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1 rounded text-muted-foreground hover:bg-muted"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEditKB(kb)}
                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(kb.id)}
                                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right KB Edit Form / Details */}
              <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
                {isCreatingKB || isEditingKB ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-primary" />
                        {isCreatingKB ? t.addKnowledge : t.editKnowledge}
                      </h2>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSaveKB}
                          disabled={!kbForm.name.trim()}
                          className="bg-primary hover:bg-primary-active text-primary-foreground rounded-lg cursor-pointer"
                        >
                          {t.save}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setIsEditingKB(false)
                            setIsCreatingKB(false)
                          }}
                          className="rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer"
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="kb-name">{t.kbName}</Label>
                        <Input
                          id="kb-name"
                          value={kbForm.name}
                          onChange={e => setKbForm({ ...kbForm, name: e.target.value })}
                          placeholder="My KB Archive"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="kb-desc">{t.kbDesc}</Label>
                        <Input
                          id="kb-desc"
                          value={kbForm.description}
                          onChange={e => setKbForm({ ...kbForm, description: e.target.value })}
                          placeholder="Context description of uploaded files"
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                    </div>


                  </div>
                ) : selectedKB ? (
                  <div className="max-w-3xl space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Database className="w-6 h-6 text-primary" />
                          {selectedKB.name}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedKB.description || "No description provided."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEditKB(selectedKB)}
                          className="gap-1.5 border-border hover:bg-primary/10 hover:text-primary rounded-lg"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t.editKB}
                        </Button>
                      </div>
                    </div>

                    {/* KB File Management */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold tracking-wide flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-primary" />
                          {t.kbFiles}
                        </h3>

                        <div>
                          <Button
                            size="sm"
                            onClick={handleTriggerUpload}
                            disabled={uploadingFile}
                            className="bg-primary hover:bg-primary-active text-primary-foreground gap-1.5 rounded-lg border-none"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingFile ? "Uploading…" : t.uploadDoc}
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.txt,.md,.markdown"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                        </div>
                      </div>

                      {/* File List */}
                      <div className="space-y-2 mt-4">
                        {selectedKB.files.length === 0 ? (
                          <div className="text-center py-8 text-xs text-muted-foreground/80 border border-dashed border-border/80 rounded-xl">
                            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30 opacity-70" />
                            No documents linked to this Knowledge Base yet.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {selectedKB.files.map(file => (
                              <div
                                key={file.name}
                                className="p-3 border border-border/60 rounded-xl bg-background flex items-center justify-between hover:border-primary/20 transition-all duration-200"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-8 h-8 bg-muted/40 border border-border/40 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <File className="w-4 h-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold truncate pr-4 text-foreground">
                                      {file.name}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                      {formatBytes(file.size)} • {new Date(file.uploadedAt).toLocaleDateString()}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDeleteKBFile(file.name)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  title="Delete Document"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Database className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">Select a Knowledge Base or create a new one.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStartCreateKB}
                        className="mt-3 gap-1.5 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-lg"
                      >
                        <Plus className="w-4 h-4 text-primary" />
                        {t.addKnowledge}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
