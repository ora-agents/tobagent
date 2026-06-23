"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"
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
  File,
  Cpu,
  Copy,
  Settings,
  History,
  RotateCcw,
  Share2,
  EyeOff,
  Search,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { ComboboxSkeleton } from "@/components/ui/loading-placeholder"
import { PromptMarkdownEditor } from "@/components/layout/prompt-markdown-editor"
import { useT, useI18n } from "@/lib/i18n"
import type { AgentProfile, AgentProfileVersion, AgentShareLink, AgentShareOptions, BuiltinToolId } from "@/lib/types/agent-profiles"
import { BUILTIN_TOOLS } from "@/lib/types/agent-profiles"
import {
  fetchAvailableModels,
  getDefaultModel,
  getModelDisplayName,
  type ModelOption,
} from "@/lib/config/deployment-config"
import {
  BOUNDARY_MODE_LABELS,
  PERSONA_STYLE_LABELS,
  ROLE_TEMPLATES,
  TTS_VOICES,
  type BoundaryMode,
  type PersonaStyle,
} from "@/lib/types/role-templates"
import { generateUUID } from "@/lib/utils"
import { useAuth } from "@/components/providers/auth-provider"

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

function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let name = ""
  let description = ""
  
  if (match) {
    const yamlContent = match[1]
    const nameMatch = yamlContent.match(/^name:\s*(.+)$/m)
    const descMatch = yamlContent.match(/^description:\s*(.+)$/m)
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '')
  }
  
  return {
    name: name || "Untitled Skill",
    description: description || "No description provided."
  }
}

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
  isSystem?: boolean
  createdAt: string
  updatedAt: string
}

const KB_STORAGE_KEY = "knowledge-bases"

type McpTransport = "streamable_http"

export interface McpServer {
  id: string
  name: string
  type: McpTransport
  url?: string
  headers: Record<string, string>
  createdAt: string
  updatedAt: string
}

const normalizeMcpTransport = (_type?: string): McpTransport => "streamable_http"

// ---------------------------------------------------------------------------
// Properties Interface
// ---------------------------------------------------------------------------
interface ManagementDashboardProps {
  initialTab: "skills" | "agents" | "knowledge" | "mcp"
  onBackToChat: () => void
  // Agent Profiles bindings
  agentProfiles: AgentProfile[]
  selectedAgentProfileId: string | null
  setSelectedAgentProfileId: (id: string | null) => void
  createAgentProfile: (data: Omit<AgentProfile, "id" | "createdAt" | "updatedAt">) => Promise<AgentProfile | null>
  updateAgentProfile: (id: string, data: Partial<Omit<AgentProfile, "id" | "createdAt">>) => Promise<AgentProfile | null>
  deleteAgentProfile: (id: string) => void
  fetchAgentProfileVersions: (id: string) => Promise<AgentProfileVersion[]>
  restoreAgentProfileVersion: (id: string, versionId: string) => Promise<AgentProfile | null>
  createAgentShareLink: (id: string, include: AgentShareOptions) => Promise<AgentShareLink | null>
  editAgentIdOnOpen?: string | null
  onEditAgentChange?: (id: string | null) => void
  createAgentOnOpenSignal?: number
  // User voiceprints
  userVoiceprints: { id: string; name: string; sampleText: string | null; enrolledAt: string | null; createdAt: string }[]
  onNavigateToUserSettings: () => void
}

export function ManagementDashboard({
  initialTab,
  onBackToChat,
  agentProfiles,
  selectedAgentProfileId,
  setSelectedAgentProfileId,
  createAgentProfile,
  updateAgentProfile,
  deleteAgentProfile,
  fetchAgentProfileVersions,
  restoreAgentProfileVersion,
  createAgentShareLink,
  editAgentIdOnOpen,
  onEditAgentChange,
  createAgentOnOpenSignal = 0,
  userVoiceprints,
  onNavigateToUserSettings,
}: ManagementDashboardProps) {
  const t = useT()
  const { locale } = useI18n()
  const { user } = useAuth()
  const authHeaders = useMemo(
    () => user ? { Authorization: `Bearer ${user.id}` } : undefined,
    [user],
  )
  const [activeTab, setActiveTab] = useState<"skills" | "agents" | "knowledge" | "mcp">(initialTab)

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

  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null)
  const [isEditingMcp, setIsEditingMcp] = useState(false)
  const [isCreatingMcp, setIsCreatingMcp] = useState(false)
  const [mcpForm, setMcpForm] = useState({
    name: "",
    type: "streamable_http" as McpTransport,
    url: "",
    headers: "{}"
  })

  const [agentForm, setAgentForm] = useState<{
    name: string
    description: string
    systemPrompt: string
    model: string
    enabledTools: BuiltinToolId[]
    knowledgeBaseIds: string[]
    skillIds: string[]
    mcpIds: string[]
    agentIds: string[]
    wakeWords: string[]
    roleTemplateId: string
    personaStyle: PersonaStyle
    boundaryMode: BoundaryMode
    ttsVoice: string
    isHidden: boolean
    voiceInterruptionEnabled: boolean
    speakerVerificationEnabled: boolean
    userVoiceprintId: string | null
  }>({
    name: "",
    description: "",
    systemPrompt: "",
    model: "",
    enabledTools: [],
    knowledgeBaseIds: [],
    skillIds: [],
    mcpIds: [],
    agentIds: [],
    wakeWords: [],
    roleTemplateId: "",
    personaStyle: "professional",
    boundaryMode: "business_only",
    ttsVoice: "Cherry",
    isHidden: false,
    voiceInterruptionEnabled: true,
    speakerVerificationEnabled: false,
    userVoiceprintId: null
  })
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isEditingAgent, setIsEditingAgent] = useState(false)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)
  const [agentSkillSearch, setAgentSkillSearch] = useState("")
  const [agentMcpSearch, setAgentMcpSearch] = useState("")
  const [agentRoleSearch, setAgentRoleSearch] = useState("")
  // Guard: prevents the selectedAgentProfileId useEffect from re-entering edit mode right after a save
  const isSavingRef = useRef(false)
  const [copiedAgentId, setCopiedAgentId] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [agentVersions, setAgentVersions] = useState<AgentProfileVersion[]>([])
  const [agentVersionsLoading, setAgentVersionsLoading] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null)
  const [shareOptions, setShareOptions] = useState<AgentShareOptions>({
    knowledgeBases: true,
    skills: true,
    mcpServers: true,
    agents: true,
  })
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [sharingAgentId, setSharingAgentId] = useState<string | null>(null)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [newWakeWord, setNewWakeWord] = useState("")
  const activeEditingAgentId = selectedAgentId

  // ---------------------------------------------------------------------------
  // Load local data on Mount via Backend API
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!LANGGRAPH_API_URL || !authHeaders) return

    async function loadData() {
      // 1. Fetch Skills
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/skills`, { headers: authHeaders })
        if (resp.ok) {
          const data = await resp.json()
          setSkills(data)
          if (data.length > 0) setSelectedSkillId(data[0].id)
        }
      } catch (err) {
        console.error("Failed to load skills from database", err)
      }

      // 2. Fetch Knowledge Bases
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases`, { headers: authHeaders })
        if (resp.ok) {
          const data = await resp.json()
          setKnowledgeBases(data)
          if (data.length > 0) setSelectedKBId(data[0].id)
        }
      } catch (err) {
        console.error("Failed to load knowledge bases from database", err)
      }

      // 3. Fetch MCP Servers
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/mcp-servers`, { headers: authHeaders })
        if (resp.ok) {
          const data = await resp.json()
          const servers = data.map((server: McpServer) => ({
            ...server,
            type: normalizeMcpTransport(server.type)
          }))
          setMcpServers(servers)
          if (servers.length > 0) setSelectedMcpId(servers[0].id)
        }
      } catch (err) {
        console.error("Failed to load MCP servers from database", err)
      }
    }

    loadData()
  }, [authHeaders])

  useEffect(() => {
    let cancelled = false
    setModelsLoading(true)
    fetchAvailableModels()
      .then((models) => {
        if (!cancelled) setAvailableModels(models)
      })
      .catch(() => {
        if (!cancelled) setAvailableModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedAgentId || activeTab !== "agents" || isCreatingAgent) {
      setAgentVersions([])
      return
    }

    let cancelled = false
    setAgentVersionsLoading(true)
    fetchAgentProfileVersions(selectedAgentId)
      .then((versions) => {
        if (!cancelled) setAgentVersions(versions)
      })
      .finally(() => {
        if (!cancelled) setAgentVersionsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTab, selectedAgentId, isCreatingAgent, fetchAgentProfileVersions])

  // Sync to activeTab change from props
  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  // Sync selectedAgentId with selectedAgentProfileId from props when entering the
  // agents tab or when the active chat role changes. Do not re-run this sync just
  // because editing/creating ended; cancel should keep the locally selected role.
  useEffect(() => {
    if (activeTab !== "agents") return
    if (isSavingRef.current) {
      isSavingRef.current = false
      return
    }
    if (isEditingAgent || isCreatingAgent) return

    setSelectedAgentId(selectedAgentProfileId)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
  }, [selectedAgentProfileId, activeTab])

  useEffect(() => {
    if (activeTab !== "agents" || !editAgentIdOnOpen) return

    const profile = agentProfiles.find(p => p.id === editAgentIdOnOpen)
    if (profile) {
      handleStartEditAgent(profile)
    }
  }, [activeTab, editAgentIdOnOpen, agentProfiles])

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
    setSelectedSkillId(skill.id)
    setIsEditingSkill(true)
    setIsCreatingSkill(false)
    setSkillForm({
      name: skill.name,
      description: skill.description,
      content: skill.content
    })
    setDeleteConfirmId(null)
  }

  const handleSaveSkill = async () => {
    if (!LANGGRAPH_API_URL || !authHeaders) return

    const { name: parsedName, description: parsedDesc } = parseSkillFrontmatter(skillForm.content)
    const now = new Date().toISOString()
    if (isCreatingSkill) {
      const newSkill: Skill = {
        id: generateUUID(),
        name: parsedName,
        description: parsedDesc,
        content: skillForm.content,
        createdAt: now,
        updatedAt: now
      }
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/skills`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(newSkill),
        })
        if (resp.ok) {
          const saved = await resp.json()
          setSkills(prev => [...prev, saved])
          setSelectedSkillId(saved.id)
          setIsCreatingSkill(false)
        }
      } catch (err) {
        console.error("Failed to persist skill to database", err)
      }
    } else if (isEditingSkill && selectedSkillId) {
      const target = skills.find(sk => sk.id === selectedSkillId)
      if (!target) return
      
      const updatedSkill: Skill = {
        ...target,
        name: parsedName,
        description: parsedDesc,
        content: skillForm.content,
        updatedAt: now
      }
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/skills/${selectedSkillId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedSkill),
        })
        if (resp.ok) {
          const saved = await resp.json()
          setSkills(prev => prev.map(sk => sk.id === selectedSkillId ? saved : sk))
          setIsEditingSkill(false)
        }
      } catch (err) {
        console.error("Failed to update skill in database", err)
      }
    }
  }

  const handleDeleteSkill = async (id: string) => {
    if (!LANGGRAPH_API_URL || !authHeaders) return
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/skills/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        setSkills(prev => {
          const updated = prev.filter(sk => sk.id !== id)
          if (updated.length > 0) {
            setSelectedSkillId(updated[0].id)
          } else {
            setSelectedSkillId(null)
          }
          return updated
        })
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error("Failed to delete skill from database", err)
    }
  }

  // ---------------------------------------------------------------------------
  // Agents Actions
  // ---------------------------------------------------------------------------
  const handleSelectAgent = (id: string | null) => {
    setSelectedAgentId(id)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
    onEditAgentChange?.(null)
    setDeleteConfirmId(null)
    setShareLink(null)
  }

  const handleStartCreateAgent = useCallback(() => {
    setIsCreatingAgent(true)
    setIsEditingAgent(false)
    onEditAgentChange?.(null)
    setAgentSkillSearch("")
    setAgentMcpSearch("")
    setAgentRoleSearch("")
    setAgentForm({
      name: "",
      description: "",
      systemPrompt: "You are a helpful assistant.",
      model: getDefaultModel(),
      enabledTools: ["rag_search", "fetch"],
      knowledgeBaseIds: [],
      skillIds: [],
      mcpIds: [],
      agentIds: [],
      wakeWords: [],
      roleTemplateId: "",
      personaStyle: "professional",
      boundaryMode: "business_only",
      ttsVoice: "Cherry",
      isHidden: false,
      voiceInterruptionEnabled: true,
      speakerVerificationEnabled: false,
      userVoiceprintId: null
    })
    setDeleteConfirmId(null)
  }, [onEditAgentChange])

  useEffect(() => {
    if (activeTab !== "agents" || createAgentOnOpenSignal <= 0) return
    handleStartCreateAgent()
  }, [activeTab, createAgentOnOpenSignal, handleStartCreateAgent])

  const handleStartEditAgent = (profile: AgentProfile) => {
    setSelectedAgentId(profile.id)
    setIsEditingAgent(true)
    setIsCreatingAgent(false)
    onEditAgentChange?.(profile.id)
    setAgentSkillSearch("")
    setAgentMcpSearch("")
    setAgentRoleSearch("")
    setAgentForm({
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt,
      model: profile.model || "",
      enabledTools: profile.enabledTools,
      knowledgeBaseIds: profile.knowledgeBaseIds || [],
      skillIds: profile.skillIds || [],
      mcpIds: profile.mcpIds || [],
      agentIds: (profile as any).agentIds || [],
      wakeWords: (profile as any).wakeWords || [],
      roleTemplateId: profile.roleTemplateId || "",
      personaStyle: (profile.personaStyle || "professional") as PersonaStyle,
      boundaryMode: (profile.boundaryMode || "business_only") as BoundaryMode,
      ttsVoice: profile.ttsVoice || "Cherry",
      isHidden: profile.isHidden || false,
      voiceInterruptionEnabled: profile.voiceInterruptionEnabled !== false,
      speakerVerificationEnabled: profile.speakerVerificationEnabled || false,
      userVoiceprintId: (profile as any).userVoiceprintId || null
    })
    setDeleteConfirmId(null)
  }

  const handleCopyAgentId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedAgentId(id)
      window.setTimeout(() => setCopiedAgentId(current => current === id ? null : current), 1400)
    } catch (err) {
      console.error("Failed to copy agent ID", err)
    }
  }

  const handleCreateAgentShare = async (id: string) => {
    setSharingAgentId(id)
    try {
      const share = await createAgentShareLink(id, shareOptions)
      if (!share) return
      const url = new URL(window.location.href)
      url.searchParams.set("agentShare", share.token)
      url.searchParams.delete("threadId")
      const nextLink = url.toString()
      setShareLink(nextLink)
      await navigator.clipboard.writeText(nextLink)
    } catch (err) {
      console.error("Failed to create agent share link", err)
    } finally {
      setSharingAgentId(null)
    }
  }

  const toggleShareOption = (key: keyof AgentShareOptions) => {
    setShareOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSaveAgent = () => {
    if (!agentForm.name.trim()) return

    const profileData = {
      name: agentForm.name.trim(),
      description: agentForm.description.trim(),
      systemPrompt: agentForm.systemPrompt,
      model: agentForm.model || null,
      enabledTools: agentForm.enabledTools,
      knowledgeBaseIds: agentForm.knowledgeBaseIds,
      skillIds: agentForm.skillIds,
      mcpIds: agentForm.mcpIds,
      agentIds: agentForm.agentIds,
      wakeWords: agentForm.wakeWords,
      roleTemplateId: agentForm.roleTemplateId || null,
      personaStyle: agentForm.personaStyle,
      boundaryMode: agentForm.boundaryMode,
      ttsVoice: agentForm.ttsVoice,
      isHidden: agentForm.isHidden,
      voiceInterruptionEnabled: agentForm.voiceInterruptionEnabled,
      speakerVerificationEnabled: agentForm.speakerVerificationEnabled,
      userVoiceprintId: agentForm.userVoiceprintId
    }

    if (isCreatingAgent) {
      createAgentProfile(profileData as any).then(created => {
        if (created) {
          setSelectedAgentId(created.id)
          // Mark saving so the useEffect won't re-enter edit mode
          isSavingRef.current = true
          if (!created.isHidden) {
            // Automatically set visible newly created agents as active and return to chat
            setSelectedAgentProfileId(created.id)
          }
        }
        setIsCreatingAgent(false)
        onEditAgentChange?.(null)
        onBackToChat()
      })
    } else if (isEditingAgent && activeEditingAgentId) {
      updateAgentProfile(activeEditingAgentId, profileData)
      // Mark saving so the useEffect won't re-enter edit mode
      isSavingRef.current = true
      // Keep hidden roles out of the chat switcher and active chat selection
      setSelectedAgentProfileId(agentForm.isHidden ? null : activeEditingAgentId)
      setIsEditingAgent(false)
      onEditAgentChange?.(null)
      onBackToChat()
    }
  }

  const handleDeleteAgent = (id: string) => {
    deleteAgentProfile(id)
    setDeleteConfirmId(null)
    setSelectedAgentId(null)
    onEditAgentChange?.(null)
  }

  const handleCancelAgentForm = () => {
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
    onEditAgentChange?.(null)
  }

  const handleRestoreAgentVersion = async (versionId: string) => {
    if (!selectedAgentId) return

    setRestoringVersionId(versionId)
    try {
      const restored = await restoreAgentProfileVersion(selectedAgentId, versionId)
      if (restored) {
        setSelectedAgentId(restored.id)
        setSelectedAgentProfileId(restored.id)
        const versions = await fetchAgentProfileVersions(restored.id)
        setAgentVersions(versions)
      }
    } finally {
      setRestoringVersionId(null)
    }
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

  const handleApplyRoleTemplate = (templateId: string) => {
    const template = ROLE_TEMPLATES.find(item => item.id === templateId)
    if (!template) {
      setAgentForm(prev => ({ ...prev, roleTemplateId: "" }))
      return
    }

    const lowerSkillNames = template.defaultSkillNames.map(name => name.toLowerCase())
    const matchedSkillIds = skills
      .filter(skill => lowerSkillNames.some(name => skill.name.toLowerCase().includes(name)))
      .map(skill => skill.id)

    setAgentForm(prev => ({
      ...prev,
      roleTemplateId: template.id,
      name: locale === "zh" ? template.defaultNameZh : template.defaultNameEn,
      description: locale === "zh" ? template.defaultDescriptionZh : template.defaultDescriptionEn,
      systemPrompt: template.systemPrompt,
      enabledTools: template.enabledTools,
      skillIds: Array.from(new Set([...prev.skillIds, ...matchedSkillIds])),
      personaStyle: template.personaStyle,
      boundaryMode: template.boundaryMode,
      ttsVoice: template.ttsVoice,
    }))
  }

  // ---------------------------------------------------------------------------
  // MCP Actions
  // ---------------------------------------------------------------------------
  const handleSelectMcp = (id: string) => {
    setSelectedMcpId(id)
    setIsEditingMcp(false)
    setIsCreatingMcp(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateMcp = () => {
    setIsCreatingMcp(true)
    setIsEditingMcp(false)
    setMcpForm({
      name: "",
      type: "streamable_http",
      url: "http://localhost:8000/mcp",
      headers: "{\n  \"Authorization\": \"Bearer token\"\n}"
    })
    setDeleteConfirmId(null)
  }

  const handleStartEditMcp = (mcp: McpServer) => {
    setSelectedMcpId(mcp.id)
    setIsEditingMcp(true)
    setIsCreatingMcp(false)
    setMcpForm({
      name: mcp.name,
      type: normalizeMcpTransport(mcp.type),
      url: mcp.url || "",
      headers: JSON.stringify(mcp.headers || {}, null, 2)
    })
    setDeleteConfirmId(null)
  }

  const handleSaveMcp = async () => {
    if (!mcpForm.name.trim() || !LANGGRAPH_API_URL || !authHeaders) return

    // Parse headers
    let parsedHeaders = {}
    try {
      if (mcpForm.headers.trim()) {
        parsedHeaders = JSON.parse(mcpForm.headers)
      }
    } catch (e) {
      alert("Invalid JSON format for Custom Headers")
      return
    }

    const now = new Date().toISOString()

    if (isCreatingMcp) {
      const newMcp: Omit<McpServer, "createdAt" | "updatedAt"> = {
        id: generateUUID(),
        name: mcpForm.name.trim(),
        type: mcpForm.type,
        url: mcpForm.url.trim() || undefined,
        headers: parsedHeaders
      }

      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/mcp-servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            ...newMcp,
            createdAt: now,
            updatedAt: now
          })
        })
        if (resp.ok) {
          const saved = await resp.json()
          setMcpServers(prev => [...prev, saved])
          setSelectedMcpId(saved.id)
          setIsCreatingMcp(false)
        }
      } catch (err) {
        console.error("Failed to create MCP server in database", err)
      }
    } else if (isEditingMcp && selectedMcpId) {
      const target = mcpServers.find(m => m.id === selectedMcpId)
      if (!target) return

      const updatedMcp = {
        ...target,
        name: mcpForm.name.trim(),
        type: mcpForm.type,
        url: mcpForm.url.trim() || undefined,
        headers: parsedHeaders,
        updatedAt: now
      }

      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/mcp-servers/${selectedMcpId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedMcp)
        })
        if (resp.ok) {
          const saved = await resp.json()
          setMcpServers(prev => prev.map(m => m.id === selectedMcpId ? saved : m))
          setIsEditingMcp(false)
        }
      } catch (err) {
        console.error("Failed to update MCP server in database", err)
      }
    }
  }

  const handleDeleteMcp = async (id: string) => {
    if (!LANGGRAPH_API_URL || !authHeaders) return
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/mcp-servers/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        setMcpServers(prev => {
          const updated = prev.filter(m => m.id !== id)
          if (updated.length > 0) {
            setSelectedMcpId(updated[0].id)
          } else {
            setSelectedMcpId(null)
          }
          return updated
        })
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error("Failed to delete MCP server from database", err)
    }
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
    if (kb.isSystem) return
    setSelectedKBId(kb.id)
    setIsEditingKB(true)
    setIsCreatingKB(false)
    setKbForm({ name: kb.name, description: kb.description })
    setDeleteConfirmId(null)
  }

  const handleSaveKB = async () => {
    if (!kbForm.name.trim() || !LANGGRAPH_API_URL || !authHeaders) return

    const now = new Date().toISOString()
    if (isCreatingKB) {
      const newKB: KnowledgeBase = {
        id: generateUUID(),
        name: kbForm.name.trim(),
        description: kbForm.description.trim(),
        files: [],
        createdAt: now,
        updatedAt: now
      }
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(newKB),
        })
        if (resp.ok) {
          const saved = await resp.json()
          setKnowledgeBases(prev => [...prev, saved])
          setSelectedKBId(saved.id)
          setIsCreatingKB(false)
        }
      } catch (err) {
        console.error("Failed to create knowledge base in database", err)
      }
    } else if (isEditingKB && selectedKBId) {
      const target = knowledgeBases.find(kb => kb.id === selectedKBId)
      if (!target) return

      const updatedKB: KnowledgeBase = {
        ...target,
        name: kbForm.name.trim(),
        description: kbForm.description.trim(),
        updatedAt: now
      }
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases/${selectedKBId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedKB),
        })
        if (resp.ok) {
          const saved = await resp.json()
          setKnowledgeBases(prev => prev.map(kb => kb.id === selectedKBId ? saved : kb))
          setIsEditingKB(false)
        }
      } catch (err) {
        console.error("Failed to update knowledge base in database", err)
      }
    }
  }

  const handleDeleteKB = async (id: string) => {
    if (!LANGGRAPH_API_URL || !authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === id)
    if (target?.isSystem) return
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        setKnowledgeBases(prev => {
          const updated = prev.filter(kb => kb.id !== id)
          if (updated.length > 0) {
            setSelectedKBId(updated[0].id)
          } else {
            setSelectedKBId(null)
          }
          return updated
        })
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error("Failed to delete knowledge base from database", err)
    }
  }

  const handleTriggerUpload = () => {
    if (selectedKB?.isSystem) return
    fileInputRef.current?.click()
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedKBId || !LANGGRAPH_API_URL || !authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === selectedKBId)
    if (target?.isSystem) return

    setUploadingFile(true)
    const form = new FormData()
    form.append("file", file)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases/${selectedKBId}/upload`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      })
      if (resp.ok) {
        const data = await resp.json()
        const updatedKB = data.knowledge_base
        setKnowledgeBases(prev => prev.map(kb => kb.id === selectedKBId ? updatedKB : kb))
      } else {
        const errText = await resp.text()
        console.error("File upload failed:", errText)
      }
    } catch (err) {
      console.error("Failed to upload document", err)
    } finally {
      setUploadingFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleDeleteKBFile = async (fileName: string) => {
    if (!selectedKBId || !LANGGRAPH_API_URL || !authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === selectedKBId)
    if (target?.isSystem) return
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/knowledge-bases/${selectedKBId}/files/${encodeURIComponent(fileName)}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        const data = await resp.json()
        const updatedKB = data.knowledge_base
        setKnowledgeBases(prev => prev.map(kb => kb.id === selectedKBId ? updatedKB : kb))
      } else {
        const errText = await resp.text()
        console.error("File deletion failed:", errText)
      }
    } catch (err) {
      console.error("Failed to delete document", err)
    }
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

  const formatDateTime = (value?: string | null) => {
    if (!value) return locale === "zh" ? "未知时间" : "Unknown time"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  // Current Selections
  const selectedSkill = skills.find(sk => sk.id === selectedSkillId) || null
  const selectedAgent = selectedAgentId
    ? agentProfiles.find(p => p.id === selectedAgentId) || null
    : null
  const selectedKB = knowledgeBases.find(kb => kb.id === selectedKBId) || null
  const selectedMcp = mcpServers.find(m => m.id === selectedMcpId) || null
  const filteredAgentSkills = skills.filter(skill => {
    const query = agentSkillSearch.trim().toLowerCase()
    if (!query) return true
    return [skill.name, skill.description, skill.id].some(value => value.toLowerCase().includes(query))
  })
  const filteredAgentMcpServers = mcpServers.filter(mcp => {
    const query = agentMcpSearch.trim().toLowerCase()
    if (!query) return true
    return [mcp.name, mcp.url || "", mcp.id].some(value => value.toLowerCase().includes(query))
  })
  const linkableAgentProfiles = agentProfiles.filter(p => p.id !== activeEditingAgentId)
  const filteredLinkableAgentProfiles = linkableAgentProfiles.filter(profile => {
    const query = agentRoleSearch.trim().toLowerCase()
    if (!query) return true
    return [profile.name, profile.description, profile.id].some(value => value.toLowerCase().includes(query))
  })
  return (
    <div className="flex h-screen w-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* 1. Header Area */}
      <header className="h-16 px-6 border-b border-border/60 bg-background/95 backdrop-blur flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide flex items-center gap-1.5 font-display">
              {t.management}
            </h1>
            <p className="text-[11px] text-muted-foreground/80 leading-none">
              {t.mcpConfigureDesc}
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Content Detail View */}
        <main className="flex min-h-0 flex-1 overflow-hidden bg-background">
          {/* ========================================== */}
          {/* MCP TAB PANEL                              */}
          {/* ========================================== */}
          {activeTab === "mcp" && (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left MCP Server List */}
              <div className="w-[300px] min-h-0 border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.mcpServers}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleStartCreateMcp}
                    className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none cursor-pointer"
                    title={t.addMcpServer}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
                  {mcpServers.map(mcp => (
                    <div
                      key={mcp.id}
                      onClick={() => handleSelectMcp(mcp.id)}
                      className={`group relative flex items-center gap-3 p-3 pr-20 rounded-lg border transition-all duration-200 cursor-pointer ${
                        selectedMcpId === mcp.id
                          ? "border-primary/30 bg-primary/10 text-foreground animate-pulse-subtle"
                          : "border-transparent hover:bg-muted/30 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{mcp.name}</div>
                        <div className="text-xs text-muted-foreground/80 mt-0.5 uppercase tracking-wider font-mono">
                          Streamable HTTP
                        </div>
                      </div>

                      <div
                        className={`absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 transition-all duration-200 ${
                          deleteConfirmId === mcp.id
                            ? "opacity-100 pointer-events-auto"
                            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                        }`}
                        onClick={e => e.stopPropagation()}
                      >
                        {deleteConfirmId === mcp.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteMcp(mcp.id)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10"
                              title={t.confirmDelete}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="p-1 rounded text-muted-foreground hover:bg-muted"
                              title={t.cancel}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEditMcp(mcp)}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                      title={t.editAgent.replace(t.agent, "").trim()}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(mcp.id)}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title={t.delete}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {mcpServers.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground italic">
                      {t.noMcpServers}
                    </div>
                  )}
                </div>
              </div>

              {/* Right MCP Details / Form */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
                {isCreatingMcp || isEditingMcp ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-primary" />
                        {isCreatingMcp ? t.addMcpServer : t.editMcpServer}
                      </h2>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={handleSaveMcp}
                          disabled={!mcpForm.name.trim()}
                          className="bg-primary hover:bg-primary-active text-primary-foreground rounded-lg cursor-pointer"
                        >
                          {t.save}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setIsEditingMcp(false)
                            setIsCreatingMcp(false)
                          }}
                          className="rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer"
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="mcp-name">{t.name}</Label>
                          <Input
                            id="mcp-name"
                            value={mcpForm.name}
                            onChange={e => setMcpForm({ ...mcpForm, name: e.target.value })}
                            placeholder={t.mcpNamePlaceholder}
                            className="bg-background border-border/80 rounded-lg"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-url">{t.sseServerUrl}</Label>
                        <Input
                          id="mcp-url"
                          value={mcpForm.url}
                          onChange={e => setMcpForm({ ...mcpForm, url: e.target.value })}
                          placeholder={t.mcpUrlPlaceholder}
                          className="bg-background border-border/80 rounded-lg font-mono text-xs"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="mcp-headers">{t.customHeadersJson}</Label>
                        <Textarea
                          id="mcp-headers"
                          value={mcpForm.headers}
                          onChange={e => setMcpForm({ ...mcpForm, headers: e.target.value })}
                          placeholder={t.mcpHeadersPlaceholder}
                          rows={6}
                          className="resize-none bg-background border-border/80 rounded-lg text-xs font-mono"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          {t.mcpServerDescription}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : selectedMcpId !== null && selectedMcp ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-border/40">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Cpu className="w-6 h-6 text-primary" />
                          {selectedMcp.name}
                        </h2>
                        <div className="text-xs font-mono uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded w-max mt-2">
                          {t.streamableHttpTransport}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEditMcp(selectedMcp)}
                          className="gap-1.5 rounded-lg border border-border/60 hover:bg-primary/10 hover:text-primary transition-all cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          {t.editServer}
                        </Button>
                      </div>
                    </div>

                    <div className="border border-border/50 rounded-xl p-4 bg-background/50 space-y-4">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground font-semibold">{t.sseServerUrl}</div>
                        <div className="text-sm font-mono bg-muted/30 p-2.5 rounded-lg border border-border/40 break-all select-all">
                          {selectedMcp.url}
                        </div>
                      </div>

                      {Object.keys(selectedMcp.headers || {}).length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground font-semibold">{t.customHeaders}</div>
                          <pre className="text-xs font-mono bg-muted/30 p-2.5 rounded-lg border border-border/40 overflow-x-auto">
                            {JSON.stringify(selectedMcp.headers, null, 2)}
                          </pre>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground font-semibold">{t.customHeaders}</div>
                          <div className="text-xs italic text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/40">
                            {t.noCustomHeaders}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                    {t.selectOrCreateMcpToStart}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* SKILLS TAB PANEL                           */}
          {/* ========================================== */}
          {activeTab === "skills" && (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left Skill List */}
              <div className="w-[300px] min-h-0 border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
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

                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
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
                        className={`group relative p-3 pr-20 rounded-lg border transition-all duration-200 cursor-pointer ${
                          selectedSkillId === skill.id
                            ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                            : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                        }`}
                      >
                        <div className="font-semibold text-sm truncate">{skill.name}</div>
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {skill.description || t.noDescriptionProvided}
                        </div>

                        {/* List Actions */}
                        <div
                          className={`absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 transition-all duration-200 ${
                            deleteConfirmId === skill.id
                              ? "opacity-100 pointer-events-auto"
                              : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                          }`}
                          onClick={e => e.stopPropagation()}
                        >
                          {deleteConfirmId === skill.id ? (
                            <>
                              <button
                                onClick={() => handleDeleteSkill(skill.id)}
                                className="p-1 rounded text-destructive hover:bg-destructive/10"
                                title={t.confirmDeleteTitle}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="p-1 rounded text-muted-foreground hover:bg-muted"
                                title={t.cancelTitle}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartEditSkill(skill)}
                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                title={t.editTitle}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(skill.id)}
                                className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                title={t.deleteTitle}
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
              <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent flex flex-col">
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
                          disabled={!skillForm.content.trim()}
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

                    <div className="p-3.5 bg-primary/5 rounded-lg border border-primary/10 text-xs text-primary/80 leading-relaxed">
                      💡 <strong>提示</strong>：技能名称与描述已实现<strong>零冗余设计</strong>。您只需在下方技能内容的 YAML Frontmatter（<code>name</code> 与 <code>description</code>）中进行定义，系统在保存时会自动提取。
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
                        placeholder={t.skillContentPlaceholder}
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
                          {selectedSkill.description || t.noDescriptionProvided}
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
                          {t.skillTextMarkdown}
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
                      <p className="text-sm font-medium text-muted-foreground">{t.selectSkillToViewOrCreate}</p>
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
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left Role List */}
              <div className="w-[300px] min-h-0 border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
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

                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
                  {agentProfiles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                      {t.createAgentPrompt}
                    </div>
                  )}

                  {agentProfiles.map(profile => (
                    <div
                      key={profile.id}
                      onClick={() => handleSelectAgent(profile.id)}
                      className={`group relative p-3 pr-20 rounded-lg border transition-all duration-200 cursor-pointer ${
                        selectedAgentId === profile.id
                          ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                          : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                      }`}
                    >
                      <div className="font-semibold text-sm flex items-center gap-1.5 truncate">
                        {profile.isHidden ? (
                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        {profile.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {profile.description || t.noDescriptionProvided}
                      </div>

                      {/* Visual indicators for resources */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {profile.isHidden && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground border border-border flex items-center gap-0.5">
                            <EyeOff className="w-2.5 h-2.5" />
                            {locale === "zh" ? "已隐藏" : "Hidden"}
                          </span>
                        )}
                        {profile.enabledTools && profile.enabledTools.length > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15 flex items-center gap-0.5" title={profile.enabledTools.join(", ")}>
                            <Wrench className="w-2.5 h-2.5" />
                            {profile.enabledTools.length} {locale === "zh" ? "工具" : "Tools"}
                          </span>
                        )}
                        {profile.knowledgeBaseIds && profile.knowledgeBaseIds.length > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-primary/10 text-primary border border-primary/15 flex items-center gap-0.5">
                            <BookOpen className="w-2.5 h-2.5" />
                            {profile.knowledgeBaseIds.length} {locale === "zh" ? "知识库" : "KBs"}
                          </span>
                        )}
                        {profile.skillIds && profile.skillIds.length > 0 && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-purple-500/10 text-purple-500 dark:text-purple-400 border border-purple-500/15 flex items-center gap-0.5">
                            <Cpu className="w-2.5 h-2.5" />
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
                            {(profile as any).agentIds.length} {locale === "zh" ? "协同" : "Roles"}
                          </span>
                        )}
                      </div>

                      {/* List Actions */}
                      <div
                        className={`absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 transition-all duration-200 ${
                          deleteConfirmId === profile.id
                            ? "opacity-100 pointer-events-auto"
                            : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                        }`}
                        onClick={e => e.stopPropagation()}
                      >
                        {deleteConfirmId === profile.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteAgent(profile.id)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10"
                              title={t.confirmDeleteTitle}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="p-1 rounded text-muted-foreground hover:bg-muted"
                              title={t.cancelTitle}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStartEditAgent(profile)}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                              title={t.editTitle}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(profile.id)}
                              className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title={t.deleteTitle}
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

              {/* Right Role Form / Details */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
                {isCreatingAgent || isEditingAgent ? (
                  <div className="max-w-none space-y-4">
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
                          onClick={handleCancelAgentForm}
                          className="rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer"
                        >
                          {t.cancel}
                        </Button>
                      </div>
                    </div>

                    {isEditingAgent && activeEditingAgentId && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {locale === "zh" ? "角色 ID" : "Role ID"}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-foreground">
                            {activeEditingAgentId}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyAgentId(activeEditingAgentId)}
                          className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                          title={locale === "zh" ? "复制角色 ID" : "Copy role ID"}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedAgentId === activeEditingAgentId
                            ? (locale === "zh" ? "已复制" : "Copied")
                            : (locale === "zh" ? "复制" : "Copy")}
                        </Button>
                      </div>
                    )}

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,42rem)_minmax(26rem,1fr)] xl:items-start">
                      <div className="min-w-0 space-y-4">
                    <div className="space-y-3 border border-border/50 rounded-xl p-4 bg-background/50">
                      <div className="space-y-1.5">
                        <Label>{locale === "zh" ? "角色模板" : "Role Template"}</Label>
                        <Select
                          value={agentForm.roleTemplateId || "custom"}
                          onValueChange={(value) => handleApplyRoleTemplate(value === "custom" ? "" : value)}
                        >
                          <SelectTrigger className="bg-background border-border/80 rounded-lg">
                            <SelectValue placeholder={locale === "zh" ? "选择角色模板" : "Select role template"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="custom">{locale === "zh" ? "自定义角色" : "Custom role"}</SelectItem>
                            {ROLE_TEMPLATES.map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {locale === "zh" ? template.nameZh : template.nameEn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {agentForm.roleTemplateId && (
                          <p className="text-xs text-muted-foreground">
                            {(() => {
                              const template = ROLE_TEMPLATES.find((item) => item.id === agentForm.roleTemplateId)
                              return template ? (locale === "zh" ? template.descriptionZh : template.descriptionEn) : null
                            })()}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <Label>{locale === "zh" ? "人物形象" : "Persona"}</Label>
                          <Select
                            value={agentForm.personaStyle}
                            onValueChange={(value) => setAgentForm(prev => ({ ...prev, personaStyle: value as PersonaStyle }))}
                          >
                            <SelectTrigger className="w-full min-w-0 bg-background border-border/80 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(PERSONA_STYLE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {locale === "zh" ? label.zh : label.en}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                          <Label>{locale === "zh" ? "客服边界" : "Support Boundary"}</Label>
                          <Select
                            value={agentForm.boundaryMode}
                            onValueChange={(value) => setAgentForm(prev => ({ ...prev, boundaryMode: value as BoundaryMode }))}
                          >
                            <SelectTrigger className="w-full min-w-0 bg-background border-border/80 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(BOUNDARY_MODE_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {locale === "zh" ? label.zh : label.en}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                          <Label>{locale === "zh" ? "语音风格" : "Voice Style"}</Label>
                          <Select
                            value={agentForm.ttsVoice}
                            onValueChange={(value) => setAgentForm(prev => ({ ...prev, ttsVoice: value }))}
                          >
                            <SelectTrigger className="w-full min-w-0 bg-background border-border/80 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TTS_VOICES.map((voice) => (
                                <SelectItem key={voice.voice} value={voice.voice}>
                                  {voice.nameZh} · {voice.voice}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {(() => {
                              const voice = TTS_VOICES.find(item => item.voice === agentForm.ttsVoice)
                              if (!voice) return null
                              return locale === "zh" ? voice.descriptionZh : voice.descriptionEn
                            })()}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-name">{locale === "zh" ? "角色名称" : "Role Name"}</Label>
                        <Input
                          id="agent-name"
                          value={agentForm.name}
                          onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                          placeholder={t.agentNamePlaceholder}
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{locale === "zh" ? "模型" : "Model"}</Label>
                        {modelsLoading ? (
                          <ComboboxSkeleton
                            label={locale === "zh" ? "加载模型中" : "Loading models"}
                            className="w-full rounded-lg"
                          />
                        ) : (
                          <Combobox
                            options={[
                              {
                                value: "__global__",
                                label: locale === "zh"
                                  ? "使用全局聊天模型"
                                  : "Use global chat model",
                              },
                              ...availableModels.map((modelId) => ({
                                value: modelId,
                                label: getModelDisplayName(modelId),
                              })),
                            ]}
                            value={agentForm.model || "__global__"}
                            onValueChange={(value) => setAgentForm(prev => ({
                              ...prev,
                              model: value === "__global__" ? "" : value,
                            }))}
                            placeholder={locale === "zh" ? "选择模型" : "Select model"}
                            searchPlaceholder={locale === "zh" ? "搜索模型..." : "Search model..."}
                            emptyText={locale === "zh" ? "未找到该模型" : "No model found."}
                            className="w-full"
                            triggerClassName="w-full h-10 rounded-lg bg-background border-border/80 hover:bg-muted/30"
                            menuClassName="w-full max-w-none"
                          />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-desc">{locale === "zh" ? "角色描述" : "Role Description"}</Label>
                        <Input
                          id="agent-desc"
                          value={agentForm.description}
                          onChange={e => setAgentForm({ ...agentForm, description: e.target.value })}
                          placeholder={t.agentDescPlaceholder}
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 border border-border/50 rounded-xl p-4 bg-background/50">
                      <div
                        className="flex items-start gap-3 cursor-pointer group"
                        onClick={() => setAgentForm(prev => ({
                          ...prev,
                          isHidden: !prev.isHidden,
                        }))}
                      >
                        <span
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                            agentForm.isHidden
                              ? "bg-primary border-primary"
                              : "border-muted-foreground/40 group-hover:border-primary/50"
                          }`}
                        >
                          {agentForm.isHidden && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-1.5">
                            <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                            {locale === "zh" ? "在对话切换中隐藏" : "Hide from chat switcher"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {locale === "zh"
                              ? "开启后，该角色仍可在角色管理中维护，但不会出现在对话页顶部的角色切换选项中。"
                              : "When enabled, this role stays manageable here but is removed from the chat page role switcher."}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border border-border/50 rounded-xl p-4 bg-background/50">
                      <div
                        className="flex items-start gap-3 cursor-pointer group"
                        onClick={() => setAgentForm(prev => ({
                          ...prev,
                          voiceInterruptionEnabled: !prev.voiceInterruptionEnabled,
                        }))}
                      >
                        <span
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                            agentForm.voiceInterruptionEnabled
                              ? "bg-primary border-primary"
                              : "border-muted-foreground/40 group-hover:border-primary/50"
                          }`}
                        >
                          {agentForm.voiceInterruptionEnabled && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {locale === "zh" ? "启用语音打断" : "Enable voice interruption"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {locale === "zh"
                              ? "开启后，语音模式下用户说话可中断当前回复并开始新一轮对话。"
                              : "When enabled, speaking in voice mode interrupts the current reply and starts a new turn."}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border border-border/50 rounded-xl p-4 bg-background/50">
                      <div
                        className="flex items-start gap-3 cursor-pointer group"
                        onClick={() => setAgentForm(prev => ({
                          ...prev,
                          speakerVerificationEnabled: !prev.speakerVerificationEnabled,
                        }))}
                      >
                        <span
                          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
                            agentForm.speakerVerificationEnabled
                              ? "bg-primary border-primary"
                              : "border-muted-foreground/40 group-hover:border-primary/50"
                          }`}
                        >
                          {agentForm.speakerVerificationEnabled && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {locale === "zh" ? "启用声纹验证" : "Enable voiceprint verification"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {locale === "zh"
                              ? "开启后，语音对话会先用已绑定声纹做相似度判断，通过后才转写。"
                              : "When enabled, voice turns must match the bound speaker before ASR runs."}
                          </div>
                        </div>
                      </div>

                      {agentForm.speakerVerificationEnabled && (
                        <div className="space-y-2 pt-2 border-t border-border/40">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {locale === "zh" ? "选择声纹" : "Select Voiceprint"}
                          </Label>
                          {userVoiceprints.length > 0 ? (
                            <Select
                              value={agentForm.userVoiceprintId || ""}
                              onValueChange={(value) => setAgentForm(prev => ({ ...prev, userVoiceprintId: value || null }))}
                            >
                              <SelectTrigger className="bg-background border-border/80 rounded-lg">
                                <SelectValue placeholder={locale === "zh" ? "选择一个声纹" : "Select a voiceprint"} />
                              </SelectTrigger>
                              <SelectContent>
                                {userVoiceprints.map((vp) => (
                                  <SelectItem key={vp.id} value={vp.id}>
                                    {vp.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {locale === "zh"
                                ? "还没有声纹，请到用户设置中注册。"
                                : "No voiceprints registered yet. Please register one in User Settings."}
                            </p>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onNavigateToUserSettings}
                            className="gap-1.5 rounded-lg"
                          >
                            <Settings className="w-3.5 h-3.5" />
                            {locale === "zh" ? "前往用户设置注册声纹" : "Go to User Settings to register"}
                          </Button>
                        </div>
                      )}
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

                    {/* Wake Words (KWS) */}
                    <div className="space-y-2 pt-2 border-t border-border/40">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {locale === "zh" ? "唤醒词 (语音唤醒)" : "Wake Words (Voice Activation)"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {locale === "zh"
                          ? "说出唤醒词即可开始语音对话，无需点击麦克风按钮。"
                          : "Say a wake word to start voice mode without clicking the mic button."}
                      </p>
                      {agentForm.wakeWords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {agentForm.wakeWords.map((word, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs border border-primary/20"
                            >
                              {word}
                              <button
                                type="button"
                                onClick={() => setAgentForm(prev => ({
                                  ...prev,
                                  wakeWords: prev.wakeWords.filter((_, i) => i !== idx)
                                }))}
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
                          value={newWakeWord}
                          onChange={e => setNewWakeWord(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              const trimmed = newWakeWord.trim()
                              if (trimmed && !agentForm.wakeWords.includes(trimmed)) {
                                setAgentForm(prev => ({ ...prev, wakeWords: [...prev.wakeWords, trimmed] }))
                                setNewWakeWord("")
                              }
                            }
                          }}
                          placeholder={locale === "zh" ? "输入唤醒词，如：小梯小梯" : "Enter wake word, e.g. hey assistant"}
                          className="text-sm flex-1 bg-background border-border/80 rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const trimmed = newWakeWord.trim()
                            if (trimmed && !agentForm.wakeWords.includes(trimmed)) {
                              setAgentForm(prev => ({ ...prev, wakeWords: [...prev.wakeWords, trimmed] }))
                              setNewWakeWord("")
                            }
                          }}
                          disabled={!newWakeWord.trim()}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    {agentForm.enabledTools.includes("rag_search") && knowledgeBases.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkedSharedKnowledgeBases}</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto p-1 border border-border/40 rounded-xl bg-background/50">
                          {knowledgeBases.map((kb) => {
                            const linked = agentForm.knowledgeBaseIds.includes(kb.id)
                            return (
                              <div
                                key={kb.id}
                                className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent/40 cursor-pointer transition-colors"
                                onClick={() => {
                                  const nextIds = linked
                                    ? agentForm.knowledgeBaseIds.filter(id => id !== kb.id)
                                    : [...agentForm.knowledgeBaseIds, kb.id]
                                  setAgentForm({ ...agentForm, knowledgeBaseIds: nextIds })
                                }}
                              >
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                                }`}>
                                  {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-medium truncate">{kb.name}</div>
                                  <div className="text-[10px] text-muted-foreground truncate">{kb.files?.length || 0} {kb.files?.length === 1 ? t.file.toLowerCase() : t.filesLabel}</div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {skills.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkCustomSkills}</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {agentForm.skillIds.length}/{skills.length}
                          </span>
                        </div>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={agentSkillSearch}
                            onChange={e => setAgentSkillSearch(e.target.value)}
                            placeholder={locale === "zh" ? "搜索技能名称、描述或 ID" : "Search skills by name, description, or ID"}
                            className="h-8 rounded-lg border-border/80 bg-background pl-8 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1 border border-border/40 rounded-xl bg-background/50">
                          {filteredAgentSkills.length > 0 ? filteredAgentSkills.map((sk) => {
                            const linked = agentForm.skillIds.includes(sk.id)
                            return (
                              <div
                                key={sk.id}
                                className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent/40 cursor-pointer transition-colors"
                                onClick={() => {
                                  const nextIds = linked
                                    ? agentForm.skillIds.filter(id => id !== sk.id)
                                    : [...agentForm.skillIds, sk.id]
                                  setAgentForm({ ...agentForm, skillIds: nextIds })
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
                              </div>
                            )
                          }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的技能" : "No matching skills found."}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {mcpServers.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkMcpServers}</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {agentForm.mcpIds.length}/{mcpServers.length}
                          </span>
                        </div>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={agentMcpSearch}
                            onChange={e => setAgentMcpSearch(e.target.value)}
                            placeholder={locale === "zh" ? "搜索 MCP 名称、URL 或 ID" : "Search MCP by name, URL, or ID"}
                            className="h-8 rounded-lg border-border/80 bg-background pl-8 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1 border border-border/40 rounded-xl bg-background/50">
                          {filteredAgentMcpServers.length > 0 ? filteredAgentMcpServers.map((mcp) => {
                            const linked = agentForm.mcpIds.includes(mcp.id)
                            return (
                              <div
                                key={mcp.id}
                                className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent/40 cursor-pointer transition-colors"
                                onClick={() => {
                                  const nextIds = linked
                                    ? agentForm.mcpIds.filter(id => id !== mcp.id)
                                    : [...agentForm.mcpIds, mcp.id]
                                  setAgentForm({ ...agentForm, mcpIds: nextIds })
                                }}
                              >
                                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                  linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                                }`}>
                                  {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-medium truncate">{mcp.name}</div>
                                  <div className="text-[10px] text-muted-foreground truncate">Streamable HTTP | {mcp.url}</div>
                                </div>
                              </div>
                            )
                          }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的 MCP" : "No matching MCP servers found."}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {linkableAgentProfiles.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {locale === "zh" ? "关联其他角色 (多角色协同)" : "Link Other Roles (Multi-Role)"}
                          </Label>
                          <span className="text-[10px] text-muted-foreground">
                            {(agentForm.agentIds || []).length}/{linkableAgentProfiles.length}
                          </span>
                        </div>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={agentRoleSearch}
                            onChange={e => setAgentRoleSearch(e.target.value)}
                            placeholder={locale === "zh" ? "搜索角色名称、描述或 ID" : "Search roles by name, description, or ID"}
                            className="h-8 rounded-lg border-border/80 bg-background pl-8 text-xs"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto p-1 border border-border/40 rounded-xl bg-background/50">
                          {filteredLinkableAgentProfiles.length > 0 ? filteredLinkableAgentProfiles.map((agent) => {
                              const linked = agentForm.agentIds?.includes(agent.id)
                              return (
                                <div
                                  key={agent.id}
                                  className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-accent/40 cursor-pointer transition-colors"
                                  onClick={() => {
                                    const nextIds = linked
                                      ? (agentForm.agentIds || []).filter(id => id !== agent.id)
                                      : [...(agentForm.agentIds || []), agent.id]
                                    setAgentForm({ ...agentForm, agentIds: nextIds })
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
                                </div>
                              )
                            }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的角色" : "No matching roles found."}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                      </div>

                      <div className="min-w-0 space-y-1.5">
                        <Label htmlFor="agent-prompt">{t.systemPrompt}</Label>
                        <div className="agent-prompt-editor">
                          <PromptMarkdownEditor
                            id="agent-prompt"
                            value={agentForm.systemPrompt}
                            onChange={systemPrompt => setAgentForm({ ...agentForm, systemPrompt })}
                            placeholder={t.agentPromptPlaceholder}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : selectedAgent ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Bot className="w-6 h-6 text-primary" />
                          {selectedAgent.name}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedAgent.description || t.noDescriptionProvided}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
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

                    <div className="space-y-6 mt-6">
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/50 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {locale === "zh" ? "角色 ID" : "Role ID"}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-foreground">
                            {selectedAgent.id}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyAgentId(selectedAgent.id)}
                          className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                          title={locale === "zh" ? "复制角色 ID" : "Copy role ID"}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedAgentId === selectedAgent.id
                            ? (locale === "zh" ? "已复制" : "Copied")
                            : (locale === "zh" ? "复制" : "Copy")}
                        </Button>
                      </div>

                      <div className="space-y-3 rounded-lg border border-border/50 bg-background/50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <Share2 className="h-4 w-4 text-primary" />
                              {locale === "zh" ? "分享角色配置" : "Share Agent Config"}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {locale === "zh"
                                ? "生成带 agentShare 参数的链接，其他账号打开后可直接导入该角色。"
                                : "Create a link with an agentShare parameter so another account can import this agent."}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCreateAgentShare(selectedAgent.id)}
                            disabled={sharingAgentId === selectedAgent.id}
                            className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            {sharingAgentId === selectedAgent.id
                              ? (locale === "zh" ? "生成中" : "Creating")
                              : (locale === "zh" ? "生成并复制" : "Create & Copy")}
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {([
                            ["knowledgeBases", locale === "zh" ? "知识库" : "KBs"],
                            ["skills", locale === "zh" ? "Skills" : "Skills"],
                            ["mcpServers", "MCP"],
                            ["agents", locale === "zh" ? "多角色" : "Roles"],
                          ] as [keyof AgentShareOptions, string][]).map(([key, label]) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggleShareOption(key)}
                              className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-2 text-left text-xs hover:bg-muted/30"
                            >
                              <span className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border ${
                                shareOptions[key] ? "border-primary bg-primary" : "border-muted-foreground/40"
                              }`}>
                                {shareOptions[key] && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </span>
                              <span className="truncate">{label}</span>
                            </button>
                          ))}
                        </div>

                        {shareLink && (
                          <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 font-mono text-[11px] text-muted-foreground break-all">
                            {shareLink}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "角色模板" : "Role Template"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {(() => {
                              const template = ROLE_TEMPLATES.find(item => item.id === selectedAgent.roleTemplateId)
                              if (!template) return locale === "zh" ? "自定义角色" : "Custom role"
                              return locale === "zh" ? template.nameZh : template.nameEn
                            })()}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "人物/边界" : "Persona / Boundary"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {locale === "zh"
                              ? `${PERSONA_STYLE_LABELS[(selectedAgent.personaStyle || "professional") as PersonaStyle]?.zh || "专业"} · ${BOUNDARY_MODE_LABELS[(selectedAgent.boundaryMode || "business_only") as BoundaryMode]?.zh || "只执行业务流程"}`
                              : `${PERSONA_STYLE_LABELS[(selectedAgent.personaStyle || "professional") as PersonaStyle]?.en || "Professional"} · ${BOUNDARY_MODE_LABELS[(selectedAgent.boundaryMode || "business_only") as BoundaryMode]?.en || "Business only"}`}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "语音风格" : "Voice Style"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {(() => {
                              const voice = TTS_VOICES.find(item => item.voice === selectedAgent.ttsVoice)
                              return voice ? `${voice.nameZh} · ${voice.voice}` : selectedAgent.ttsVoice || "Cherry"
                            })()}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "语音控制" : "Voice Control"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {(selectedAgent.voiceInterruptionEnabled !== false)
                              ? (locale === "zh" ? "打断已启用" : "Interruption enabled")
                              : (locale === "zh" ? "打断已关闭" : "Interruption disabled")}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "模型" : "Model"}
                          </div>
                          <div className="text-xs font-semibold mt-1 truncate">
                            {selectedAgent.model
                              ? getModelDisplayName(selectedAgent.model)
                              : (locale === "zh" ? "使用全局聊天模型" : "Global chat model")}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "对话切换" : "Chat Switcher"}
                          </div>
                          <div className="text-xs font-semibold mt-1 flex items-center gap-1.5">
                            {selectedAgent.isHidden && <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                            {selectedAgent.isHidden
                              ? (locale === "zh" ? "已隐藏" : "Hidden")
                              : (locale === "zh" ? "可见" : "Visible")}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "声纹验证" : "Voiceprint"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {selectedAgent.speakerVerificationEnabled
                              ? (selectedAgent.speakerVerificationBound
                                ? (locale === "zh" ? "已启用 · 已绑定" : "Enabled · Bound")
                                : (locale === "zh" ? "已启用 · 未绑定" : "Enabled · Not bound"))
                              : (locale === "zh" ? "未启用" : "Disabled")}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "添加时间" : "Added"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {formatDateTime(selectedAgent.createdAt)}
                          </div>
                        </div>
                        <div className="p-3 border border-border/60 rounded-xl bg-background/50">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {locale === "zh" ? "修改时间" : "Modified"}
                          </div>
                          <div className="text-xs font-semibold mt-1">
                            {formatDateTime(selectedAgent.updatedAt)}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <History className="h-4 w-4 text-primary" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "配置版本" : "Configuration Versions"}
                            </h3>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {agentVersionsLoading
                              ? (locale === "zh" ? "加载中" : "Loading")
                              : `${agentVersions.length} ${locale === "zh" ? "个版本" : "versions"}`}
                          </span>
                        </div>

                        {agentVersions.length === 0 && !agentVersionsLoading ? (
                          <p className="text-xs text-muted-foreground">
                            {locale === "zh"
                              ? "暂无历史版本。保存角色配置后会自动记录版本。"
                              : "No saved versions yet. Versions are recorded when this role is saved."}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {agentVersions.map((version, index) => {
                              const isLatest = index === 0
                              const modelName = version.snapshot.model
                                ? getModelDisplayName(version.snapshot.model)
                                : (locale === "zh" ? "使用全局聊天模型" : "Global chat model")
                              return (
                                <div
                                  key={version.id}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold">
                                        v{version.version}
                                      </span>
                                      {isLatest && (
                                        <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                          {locale === "zh" ? "当前" : "Current"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                      {formatDateTime(version.createdAt)} · {modelName}
                                    </div>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isLatest || restoringVersionId === version.id}
                                    onClick={() => handleRestoreAgentVersion(version.id)}
                                    className="h-8 shrink-0 gap-1.5 rounded-lg border-border bg-background px-2.5"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                    {restoringVersionId === version.id
                                      ? (locale === "zh" ? "恢复中" : "Restoring")
                                      : (locale === "zh" ? "恢复" : "Restore")}
                                  </Button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      <div className="border border-border/40 rounded-xl bg-background/50 overflow-hidden">
                        <div className="px-4 py-2 border-b border-border/30 bg-muted/20">
                          <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase font-mono">
                            {t.systemInstructions}
                          </span>
                        </div>
                        <div className="p-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                          {selectedAgent.systemPrompt}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          {t.enabledToolsTitle}
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
                                  {isEnabled ? t.enabled : t.disabled}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Linked Resources Grid */}
                      <div className="space-y-4 pt-4 border-t border-border/40">
                        {/* Linked Knowledge Bases */}
                        {selectedAgent.knowledgeBaseIds && selectedAgent.knowledgeBaseIds.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-primary" />
                              {locale === "zh" ? "已关联的知识库" : "Linked Knowledge Bases"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {knowledgeBases
                                .filter(kb => selectedAgent.knowledgeBaseIds?.includes(kb.id))
                                .map(kb => (
                                  <div key={kb.id} className="p-2.5 border border-primary/20 bg-primary/5 rounded-xl flex items-center gap-2.5">
                                    <BookOpen className="w-4 h-4 text-primary flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate">{kb.name}</div>
                                      <div className="text-[10px] text-muted-foreground truncate">{kb.files?.length || 0} {t.filesLabel}</div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Linked Custom Skills */}
                        {selectedAgent.skillIds && selectedAgent.skillIds.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Cpu className="w-3.5 h-3.5 text-purple-500" />
                              {locale === "zh" ? "已关联的自定义技能" : "Linked Custom Skills"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {skills
                                .filter(sk => selectedAgent.skillIds?.includes(sk.id))
                                .map(sk => (
                                  <div key={sk.id} className="p-2.5 border border-purple-500/20 bg-purple-500/5 rounded-xl flex items-center gap-2.5">
                                    <Cpu className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate">{sk.name}</div>
                                      <div className="text-[10px] text-muted-foreground truncate">{sk.description || (locale === "zh" ? "无描述" : "No description")}</div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Linked MCP Servers */}
                        {selectedAgent.mcpIds && selectedAgent.mcpIds.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Wrench className="w-3.5 h-3.5 text-emerald-500" />
                              {locale === "zh" ? "已关联的 MCP 服务" : "Linked MCP Servers"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {mcpServers
                                .filter(mcp => selectedAgent.mcpIds?.includes(mcp.id))
                                .map(mcp => (
                                  <div key={mcp.id} className="p-2.5 border border-emerald-500/20 bg-emerald-500/5 rounded-xl flex items-center gap-2.5">
                                    <Wrench className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate">{mcp.name}</div>
                                      <div className="text-[10px] text-muted-foreground truncate">Streamable HTTP | {mcp.url}</div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Linked Other Agents */}
                        {selectedAgent.agentIds && selectedAgent.agentIds.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-rose-500" />
                              {locale === "zh" ? "已关联的协同角色" : "Linked Collaborative Roles"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {agentProfiles
                                .filter(p => selectedAgent.agentIds?.includes(p.id))
                                .map(p => (
                                  <div key={p.id} className="p-2.5 border border-rose-500/20 bg-rose-500/5 rounded-xl flex items-center gap-2.5">
                                    <Bot className="w-4 h-4 text-rose-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate">{p.name}</div>
                                      <div className="text-[10px] text-muted-foreground truncate">{p.description || (locale === "zh" ? "无描述" : "No description")}</div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Bot className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">{t.selectAgentToViewOrCreate}</p>
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
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Left KB List */}
              <div className="w-[300px] min-h-0 border-r border-border/40 flex flex-col flex-shrink-0 bg-background/30">
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

                <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
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
                        className={`group relative p-3 pr-20 rounded-lg border transition-all duration-200 cursor-pointer ${
                          selectedKBId === kb.id
                            ? "border-primary/60 bg-primary/5 shadow-depth-xs"
                            : "border-border/60 hover:border-primary/30 hover:bg-muted/20"
                        }`}
                      >
                        <div className="font-semibold text-sm truncate flex items-center gap-2">
                          <span className="truncate">{kb.name}</span>
                          {kb.isSystem && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-primary/10 text-primary border border-primary/15 flex-shrink-0">
                              {locale === "zh" ? "系统" : "System"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 truncate flex items-center gap-1">
                          <FileText className="w-3 h-3 flex-shrink-0 text-muted-foreground/75" />
                          {kb.files.length} {kb.files.length === 1 ? t.file.toLowerCase() : t.filesLabel}
                        </div>

                        {/* List Actions */}
                        {!kb.isSystem && (
                          <div
                            className={`absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center gap-1 transition-all duration-200 ${
                              deleteConfirmId === kb.id
                                ? "opacity-100 pointer-events-auto"
                                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
                            }`}
                            onClick={e => e.stopPropagation()}
                          >
                            {deleteConfirmId === kb.id ? (
                              <>
                                <button
                                  onClick={() => handleDeleteKB(kb.id)}
                                  className="p-1 rounded text-destructive hover:bg-destructive/10"
                                  title={t.confirmDeleteTitle}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="p-1 rounded text-muted-foreground hover:bg-muted"
                                  title={t.cancelTitle}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleStartEditKB(kb)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                  title={t.editTitle}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(kb.id)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  title={t.deleteTitle}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right KB Edit Form / Details */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
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
                          placeholder={t.kbNamePlaceholder}
                          className="bg-background border-border/80 rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="kb-desc">{t.kbDesc}</Label>
                        <Input
                          id="kb-desc"
                          value={kbForm.description}
                          onChange={e => setKbForm({ ...kbForm, description: e.target.value })}
                          placeholder={t.kbDescPlaceholder}
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
                          {selectedKB.description || t.noDescriptionProvided}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!selectedKB.isSystem && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStartEditKB(selectedKB)}
                            className="gap-1.5 border-border hover:bg-primary/10 hover:text-primary rounded-lg"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {t.editKB}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* KB File Management */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold tracking-wide flex items-center gap-1.5">
                          <FileText className="w-4 h-4 text-primary" />
                          {t.kbFiles}
                        </h3>

                        {!selectedKB.isSystem && (
                        <div>
                          <Button
                            size="sm"
                            onClick={handleTriggerUpload}
                            disabled={uploadingFile}
                            className="bg-primary hover:bg-primary-active text-primary-foreground gap-1.5 rounded-lg border-none"
                          >
                            <Upload className="w-4 h-4" />
                            {uploadingFile ? t.uploading : t.uploadDoc}
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.txt,.md,.markdown,.csv"
                            className="hidden"
                            onChange={handleFileUpload}
                          />
                        </div>
                        )}
                      </div>

                      {/* File List */}
                      <div className="space-y-2 mt-4">
                        {selectedKB.files.length === 0 ? (
                          <div className="text-center py-8 text-xs text-muted-foreground/80 border border-dashed border-border/80 rounded-xl">
                            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30 opacity-70" />
                            {t.noDocumentsLinked}
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
                                {!selectedKB.isSystem && (
                                  <button
                                    onClick={() => handleDeleteKBFile(file.name)}
                                    className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    title={t.deleteDocumentTitle}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
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
                      <p className="text-sm font-medium text-muted-foreground">{t.selectKbToViewOrCreate}</p>
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
