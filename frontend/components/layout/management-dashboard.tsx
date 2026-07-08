"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Link from "next/link"
import { backendFetch } from "@/lib/api/backend-fetch"
import {
  Wrench,
  Bot,
  Database,
  ArrowLeft,
  Home,
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
  TableProperties,
  Download,
  LoaderCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NavActionButton } from "@/components/ui/nav-action-button"
import { Input } from "@/components/ui/input"
import { InputField } from "@/components/ui/input-field"
import { FormField } from "@/components/ui/form-field"
import { Label } from "@/components/ui/label"
import { ListItem } from "@/components/ui/list-item"
import { ListPanel } from "@/components/ui/list-panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Combobox } from "@/components/ui/combobox"
import { ComboboxSkeleton } from "@/components/ui/loading-placeholder"
import { PromptMarkdownEditor } from "@/components/layout/prompt-markdown-editor"
import { useT, useI18n } from "@/lib/i18n"
import type { AgentProfile, AgentProfileVersion, AgentShareFaqItem, AgentShareLink, AgentShareOptions, BuiltinToolId, CustomFunction, FormRecordPermission } from "@/lib/types/agent-profiles"
import { BUILTIN_TOOLS, isSystemAgentProfile } from "@/lib/types/agent-profiles"
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
import { cn, generateUUID } from "@/lib/utils"
import { useAuth } from "@/components/providers/auth-provider"
import {
  DEFAULT_SKILL_TEMPLATE,
  SkillStructuredView,
  parseSkillForView,
  parseSkillFrontmatter,
  type Skill,
} from "@/components/layout/management-dashboard/skill-view"
import {
  DRAFT_FORM_RECORD_ID_PREFIX,
  FormFieldDesigner,
  FormRecordsTable,
  SYSTEM_FORM_FIELDS,
  SYSTEM_FORM_FIELD_IDS,
  normalizeFieldValue,
  validateFormRecordData,
  type CustomForm,
  type CustomFormField,
  type CustomFormHook,
  type CustomFormHookCondition,
  type CustomFormRecord,
  type FormDefinitionState,
} from "@/components/layout/management-dashboard/forms"
import {
  normalizeMcpTransport,
  type KnowledgeBase,
  type McpServer,
  type McpTransport,
} from "@/components/layout/management-dashboard/types"
import { ConfigBundleDialog } from "@/components/layout/management-dashboard/config-bundle-dialog"

// ---------------------------------------------------------------------------
// Properties Interface
// ---------------------------------------------------------------------------
interface ManagementDashboardProps {
  initialTab: "skills" | "agents" | "knowledge" | "forms" | "mcp"
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
  createAgentShareLink: (
    id: string,
    include: AgentShareOptions,
    options?: {
      customSlug?: string | null
      priceCents?: number
      currency?: string
      trialDurationMinutes?: number
      introductionText?: string | null
      faqItems?: AgentShareFaqItem[]
    },
  ) => Promise<AgentShareLink | null>
  listAgentShareLinks: (id: string) => Promise<AgentShareLink[]>
  updateAgentShareLink: (
    token: string,
    include: AgentShareOptions,
    options?: {
      customSlug?: string | null
      priceCents?: number
      currency?: string
      trialDurationMinutes?: number
      introductionText?: string | null
      faqItems?: AgentShareFaqItem[]
    },
  ) => Promise<AgentShareLink | null>
  deleteAgentShareLink: (token: string) => Promise<boolean>
  editAgentIdOnOpen?: string | null
  onEditAgentChange?: (id: string | null) => void
  createOnOpen?: boolean
  onCreateChange?: (creating: boolean) => void
  scopedAgentProfileId?: string | null
  // User voiceprints
  userVoiceprints: { id: string; name: string; sampleText: string | null; enrolledAt: string | null; createdAt: string }[]
  onNavigateToUserSettings: () => void
}

type SkillCategoryGroup = {
  key: string
  label: string
  skills: Skill[]
}

type FormCategoryGroup = {
  key: string
  label: string
  forms: CustomForm[]
}

type AgentLinkedResourceCreateContext = {
  type: "skill" | "form"
  agentMode: "create" | "edit"
  agentId: string | null
}

type PendingChangeResponse = {
  status: "pending"
  targetType: string
  id: string
}

const UNCATEGORIZED_SKILL_CATEGORY = "__uncategorized__"
const UNCATEGORIZED_FORM_CATEGORY = "__uncategorized_form__"

function getCategoryValueForCreate(key: string, label: string, uncategorizedKey: string) {
  return key === uncategorizedKey ? "" : label
}

function getSkillTemplateForCategory(category: string) {
  if (!category.trim()) return DEFAULT_SKILL_TEMPLATE
  return DEFAULT_SKILL_TEMPLATE.replace(
    /(\n\s*category:\s*)[^\n]*/,
    `$1${category.trim()}`
  )
}

function shareSlugUserPrefix(value: string | null | undefined) {
  const prefix = (value || "user")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")
  return prefix || "user"
}

function isPendingChangeResponse(value: unknown): value is PendingChangeResponse {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { status?: unknown }).status === "pending" &&
    typeof (value as { targetType?: unknown }).targetType === "string"
  )
}

function getSkillCategory(skill: Skill, uncategorizedLabel: string) {
  const parsed = parseSkillForView(skill.content)
  const rawCategory = parsed.metadata.category || parsed.frontmatter.category || ""
  const category = rawCategory.trim()

  return {
    key: category ? category.toLowerCase() : UNCATEGORIZED_SKILL_CATEGORY,
    label: category || uncategorizedLabel,
  }
}

function groupSkillsByCategory(skills: Skill[], uncategorizedLabel: string): SkillCategoryGroup[] {
  const groups = new Map<string, SkillCategoryGroup>()

  for (const skill of skills) {
    const category = getSkillCategory(skill, uncategorizedLabel)
    const existing = groups.get(category.key)
    if (existing) {
      existing.skills.push(skill)
    } else {
      groups.set(category.key, {
        key: category.key,
        label: category.label,
        skills: [skill],
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === UNCATEGORIZED_SKILL_CATEGORY) return 1
    if (b.key === UNCATEGORIZED_SKILL_CATEGORY) return -1
    return a.label.localeCompare(b.label)
  })
}

function groupFormsByCategory(forms: CustomForm[], uncategorizedLabel: string): FormCategoryGroup[] {
  const groups = new Map<string, FormCategoryGroup>()

  for (const form of forms) {
    const category = (form.category || "").trim()
    const key = getFormCategoryKey(form)
    const existing = groups.get(key)
    if (existing) {
      existing.forms.push(form)
    } else {
      groups.set(key, {
        key,
        label: category || uncategorizedLabel,
        forms: [form],
      })
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === UNCATEGORIZED_FORM_CATEGORY) return 1
    if (b.key === UNCATEGORIZED_FORM_CATEGORY) return -1
    return a.label.localeCompare(b.label)
  })
}

function getFormCategoryKey(form: Pick<CustomForm, "category">) {
  const category = (form.category || "").trim()
  return category ? category.toLowerCase() : UNCATEGORIZED_FORM_CATEGORY
}

function getLinkedFormsForAgent(agent: AgentProfile | null, allForms: CustomForm[]) {
  if (!agent) return []

  const explicitFormIds = new Set(agent.formIds || [])
  const categoryIds = new Set(agent.formCategoryIds || [])

  return allForms.filter(form => explicitFormIds.has(form.id) || categoryIds.has(getFormCategoryKey(form)))
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
  listAgentShareLinks,
  updateAgentShareLink,
  deleteAgentShareLink,
  editAgentIdOnOpen,
  onEditAgentChange,
  createOnOpen = false,
  onCreateChange,
  scopedAgentProfileId = null,
  userVoiceprints,
  onNavigateToUserSettings,
}: ManagementDashboardProps) {
  const t = useT()
  const { locale } = useI18n()
  const { user, activeWorkspace, canManageWorkspace, workspaceHeaders, authHeaders: sessionHeaders } = useAuth()
  const [configBundleMode, setConfigBundleMode] = useState<"import" | "export" | null>(null)
  const [configBundleInitialSelection, setConfigBundleInitialSelection] = useState<{
    agents?: string[]
    skills?: string[]
    knowledgeBases?: string[]
    mcpServers?: string[]
    forms?: string[]
  }>()

  const authHeaders = useMemo(
    () => user ? { ...sessionHeaders, ...workspaceHeaders } : undefined,
    [sessionHeaders, user, workspaceHeaders],
  )
  const apiFetch = useCallback((path: string, init: RequestInit = {}) => {
    return backendFetch(path, {
      authHeaders,
      ...init,
    })
  }, [authHeaders])
  const [activeTab, setActiveTab] = useState<"skills" | "agents" | "knowledge" | "forms" | "mcp">(initialTab)

  // ---------------------------------------------------------------------------
  // Local States
  // ---------------------------------------------------------------------------
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [isEditingSkill, setIsEditingSkill] = useState(false)
  const [isCreatingSkill, setIsCreatingSkill] = useState(false)
  const [skillForm, setSkillForm] = useState({ name: "", description: "", content: "" })
  const [collapsedSkillCategories, setCollapsedSkillCategories] = useState<Set<string>>(new Set())
  const [collapsedAgentSkillCategories, setCollapsedAgentSkillCategories] = useState<Set<string>>(new Set())
  const [collapsedFormCategories, setCollapsedFormCategories] = useState<Set<string>>(new Set())
  const [collapsedAgentFormCategories, setCollapsedAgentFormCategories] = useState<Set<string>>(new Set())

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [selectedKBId, setSelectedKBId] = useState<string | null>(null)
  const [isEditingKB, setIsEditingKB] = useState(false)
  const [isCreatingKB, setIsCreatingKB] = useState(false)
  const [kbForm, setKbForm] = useState({ name: "", description: "" })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingFile, setUploadingFile] = useState(false)

  const [forms, setForms] = useState<CustomForm[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [formRecords, setFormRecords] = useState<CustomFormRecord[]>([])
  const [formRecordTotal, setFormRecordTotal] = useState(0)
  const [isEditingForm, setIsEditingForm] = useState(false)
  const [isCreatingForm, setIsCreatingForm] = useState(false)
  const [formDefinition, setFormDefinition] = useState<FormDefinitionState>({ name: "", description: "", category: "", fields: [], hooks: [] })
  const [selectedFormFieldId, setSelectedFormFieldId] = useState<string | null>(null)
  const [recordQuery, setRecordQuery] = useState("")
  const [recordPage, setRecordPage] = useState(1)
  const [dirtyFormRecordIds, setDirtyFormRecordIds] = useState<Set<string>>(new Set())
  const [formRecordValidationErrors, setFormRecordValidationErrors] = useState<Record<string, Record<string, string>>>({})
  const localCreateHandledRef = useRef(false)

  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [selectedMcpId, setSelectedMcpId] = useState<string | null>(null)
  const [isEditingMcp, setIsEditingMcp] = useState(false)
  const [isCreatingMcp, setIsCreatingMcp] = useState(false)
  const [isSavingMcp, setIsSavingMcp] = useState(false)
  const [mcpSaveError, setMcpSaveError] = useState("")
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
    modelTemperature: string
    enabledTools: BuiltinToolId[]
    knowledgeBaseIds: string[]
    skillIds: string[]
    skillCategoryIds: string[]
    mcpIds: string[]
    agentIds: string[]
    formIds: string[]
    formCategoryIds: string[]
    formPermissions: Record<string, FormRecordPermission[]>
    customFunctions: CustomFunction[]
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
    modelTemperature: "",
    enabledTools: [],
    knowledgeBaseIds: [],
    skillIds: [],
    skillCategoryIds: [],
    mcpIds: [],
    agentIds: [],
    formIds: [],
    formCategoryIds: [],
    formPermissions: {},
    customFunctions: [],
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
  const [agentKbSearch, setAgentKbSearch] = useState("")
  const [agentSkillSearch, setAgentSkillSearch] = useState("")
  const [agentMcpSearch, setAgentMcpSearch] = useState("")
  const [agentRoleSearch, setAgentRoleSearch] = useState("")
  const [agentLinkedResourceCreateContext, setAgentLinkedResourceCreateContext] = useState<AgentLinkedResourceCreateContext | null>(null)
  // Guard: prevents the selectedAgentProfileId useEffect from re-entering edit mode right after a save
  const isSavingRef = useRef(false)
  const skipNextEditAgentOpenRef = useRef<string | null>(null)
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
    forms: true,
  })
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [agentShareLinks, setAgentShareLinks] = useState<AgentShareLink[]>([])
  const [agentShareLinksLoading, setAgentShareLinksLoading] = useState(false)
  const [editingShareToken, setEditingShareToken] = useState<string | null>(null)
  const [deletingShareToken, setDeletingShareToken] = useState<string | null>(null)
  const [shareSlug, setShareSlug] = useState("")
  const [sharePrice, setSharePrice] = useState("")
  const [shareTrialMinutes, setShareTrialMinutes] = useState("")
  const [shareIntroduction, setShareIntroduction] = useState("")
  const [shareFaqItems, setShareFaqItems] = useState<AgentShareFaqItem[]>([
    { question: "", answer: "" },
  ])
  const [sharingAgentId, setSharingAgentId] = useState<string | null>(null)
  const isScopedAgentConfig = !!scopedAgentProfileId

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [newWakeWord, setNewWakeWord] = useState("")
  const activeEditingAgentId = selectedAgentId
  const submitConfigLabel = canManageWorkspace
    ? t.save
    : (locale === "zh" ? "提交审批" : "Submit for approval")

  const handlePendingChangeResponse = useCallback(() => {
    window.alert(locale === "zh" ? "已提交审批，审批通过后生效。" : "Submitted for approval. Changes apply after approval.")
    setIsEditingSkill(false)
    setIsCreatingSkill(false)
    setIsEditingKB(false)
    setIsCreatingKB(false)
    setIsEditingForm(false)
    setIsCreatingForm(false)
    setIsEditingMcp(false)
    setIsCreatingMcp(false)
    setDeleteConfirmId(null)
    onCreateChange?.(false)
  }, [locale, onCreateChange])

  // ---------------------------------------------------------------------------
  // Load local data on Mount via Backend API
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!authHeaders) return

    async function loadData() {
      // 1. Fetch Skills
      try {
        const resp = await apiFetch("/api/skills")
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
        const resp = await apiFetch("/api/knowledge-bases")
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
        const resp = await apiFetch("/api/mcp-servers")
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

      // 4. Fetch Forms
      try {
        const resp = await apiFetch("/api/forms")
        if (resp.ok) {
          const data = await resp.json()
          setForms(data)
          if (data.length > 0) setSelectedFormId(data[0].id)
        }
      } catch (err) {
        console.error("Failed to load forms from database", err)
      }
    }

    loadData()
  }, [apiFetch, authHeaders])

  useEffect(() => {
    if (!authHeaders || !knowledgeBases.some(kb => kb.importStatus === "importing")) {
      return
    }
    const timer = window.setInterval(async () => {
      try {
        const response = await apiFetch("/api/knowledge-bases")
        if (response.ok) setKnowledgeBases(await response.json())
      } catch (err) {
        console.error("Failed to refresh knowledge base import status", err)
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [apiFetch, authHeaders, knowledgeBases])

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

  useEffect(() => {
    if (!scopedAgentProfileId || activeTab !== "agents") return
    if (selectedAgentId === scopedAgentProfileId || isEditingAgent || isCreatingAgent) return

    const scopedProfile = agentProfiles.find(profile => profile.id === scopedAgentProfileId && !isSystemAgentProfile(profile))
    if (scopedProfile) {
      setSelectedAgentId(scopedProfile.id)
      setIsEditingAgent(false)
      setIsCreatingAgent(false)
      onEditAgentChange?.(null)
    }
  }, [
    activeTab,
    agentProfiles,
    isCreatingAgent,
    isEditingAgent,
    onEditAgentChange,
    scopedAgentProfileId,
    selectedAgentId,
  ])

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

    const selectedProfile = agentProfiles.find(profile => profile.id === selectedAgentProfileId)
    setSelectedAgentId(selectedProfile && !isSystemAgentProfile(selectedProfile) ? selectedProfile.id : null)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
  }, [selectedAgentProfileId, activeTab, agentProfiles])

  useEffect(() => {
    if (activeTab !== "agents" || !editAgentIdOnOpen) return
    if (skipNextEditAgentOpenRef.current === editAgentIdOnOpen) {
      skipNextEditAgentOpenRef.current = null
      return
    }

    const profile = agentProfiles.find(p => p.id === editAgentIdOnOpen && !isSystemAgentProfile(p))
    if (profile) {
      handleStartEditAgent(profile)
    }
  }, [activeTab, editAgentIdOnOpen, agentProfiles])

  useEffect(() => {
    if (!authHeaders || activeTab !== "forms" || !selectedFormId) {
      setFormRecords([])
      setFormRecordTotal(0)
      setDirtyFormRecordIds(new Set())
      setFormRecordValidationErrors({})
      return
    }

    const params = new URLSearchParams({
      page: String(recordPage),
      pageSize: "25",
    })
    if (recordQuery.trim()) params.set("q", recordQuery.trim())
    apiFetch(`/api/forms/${selectedFormId}/records?${params.toString()}`)
      .then(resp => resp.ok ? resp.json() : { records: [], total: 0 })
      .then(data => {
        setFormRecords(data.records || [])
        setFormRecordTotal(data.total || 0)
        setDirtyFormRecordIds(new Set())
        setFormRecordValidationErrors({})
      })
      .catch(() => {
        setFormRecords([])
        setFormRecordTotal(0)
        setDirtyFormRecordIds(new Set())
        setFormRecordValidationErrors({})
      })
  }, [activeTab, apiFetch, authHeaders, selectedFormId, recordPage, recordQuery])

  // ---------------------------------------------------------------------------
  // Skills Actions
  // ---------------------------------------------------------------------------
  const handleSelectSkill = (id: string) => {
    onCreateChange?.(false)
    setSelectedSkillId(id)
    setIsEditingSkill(false)
    setIsCreatingSkill(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateSkill = (category = "") => {
    localCreateHandledRef.current = true
    onCreateChange?.(true)
    setSelectedSkillId(null)
    setIsCreatingSkill(true)
    setIsEditingSkill(false)
    setSkillForm({
      name: "",
      description: "",
      content: getSkillTemplateForCategory(category)
    })
    setDeleteConfirmId(null)
  }

  const returnToAgentEditorAfterLinkedResourceCreate = (
    context: AgentLinkedResourceCreateContext,
    resourceId: string,
  ) => {
    setAgentForm(prev => {
      if (context.type === "skill") {
        return {
          ...prev,
          skillIds: prev.skillIds.includes(resourceId) ? prev.skillIds : [...prev.skillIds, resourceId],
        }
      }

      const formIds = prev.formIds.includes(resourceId) ? prev.formIds : [...prev.formIds, resourceId]
      return {
        ...prev,
        formIds,
        formPermissions: {
          ...prev.formPermissions,
          [resourceId]: prev.formPermissions[resourceId] || ["read"],
        },
        enabledTools: formIds.length > 0
          ? [...new Set([...prev.enabledTools, "query_form_data" as BuiltinToolId])]
          : prev.enabledTools,
      }
    })
    setAgentLinkedResourceCreateContext(null)
    setActiveTab("agents")
    setSelectedAgentId(context.agentId)
    setIsCreatingAgent(context.agentMode === "create")
    setIsEditingAgent(context.agentMode === "edit")
    onCreateChange?.(context.agentMode === "create")
    if (context.agentMode === "edit") {
      skipNextEditAgentOpenRef.current = context.agentId
    }
    onEditAgentChange?.(context.agentMode === "edit" ? context.agentId : null)
  }

  const returnToAgentEditorFromLinkedResourceCreate = () => {
    const context = agentLinkedResourceCreateContext
    if (!context) return
    setAgentLinkedResourceCreateContext(null)
    setActiveTab("agents")
    setSelectedAgentId(context.agentId)
    setIsCreatingAgent(context.agentMode === "create")
    setIsEditingAgent(context.agentMode === "edit")
    onCreateChange?.(context.agentMode === "create")
    if (context.agentMode === "edit") {
      skipNextEditAgentOpenRef.current = context.agentId
    }
    onEditAgentChange?.(context.agentMode === "edit" ? context.agentId : null)
  }

  const handleStartCreateAgentLinkedSkill = (category = "") => {
    setAgentLinkedResourceCreateContext({
      type: "skill",
      agentMode: isCreatingAgent ? "create" : "edit",
      agentId: selectedAgentId,
    })
    setActiveTab("skills")
    handleStartCreateSkill(category)
  }

  const handleStartEditSkill = (skill: Skill) => {
    onCreateChange?.(false)
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
    if (!authHeaders) return

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
        const resp = await apiFetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(newSkill),
        })
        if (resp.ok) {
          const saved = await resp.json()
          if (isPendingChangeResponse(saved)) {
            handlePendingChangeResponse()
            return
          }
          setSkills(prev => [...prev, saved])
          setSelectedSkillId(saved.id)
          setIsCreatingSkill(false)
          onCreateChange?.(false)
          if (agentLinkedResourceCreateContext?.type === "skill") {
            returnToAgentEditorAfterLinkedResourceCreate(agentLinkedResourceCreateContext, saved.id)
          }
        } else {
          const errorData = await resp.json().catch(() => null)
          const errorMessage = errorData?.detail || resp.statusText
          console.error("Failed to persist skill to database", errorMessage)
          window.alert(locale === "zh"
            ? `技能保存失败：${errorMessage}`
            : `Failed to save skill: ${errorMessage}`)
        }
      } catch (err) {
        console.error("Failed to persist skill to database", err)
        window.alert(locale === "zh"
          ? "技能保存失败，请稍后重试。"
          : "Failed to save skill. Please try again.")
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
        const resp = await apiFetch(`/api/skills/${selectedSkillId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedSkill),
        })
        if (resp.ok) {
          const saved = await resp.json()
          if (isPendingChangeResponse(saved)) {
            handlePendingChangeResponse()
            return
          }
          setSkills(prev => prev.map(sk => sk.id === selectedSkillId ? saved : sk))
          setIsEditingSkill(false)
        } else {
          const errorData = await resp.json().catch(() => null)
          const errorMessage = errorData?.detail || resp.statusText
          console.error("Failed to update skill in database", errorMessage)
          window.alert(locale === "zh"
            ? `技能保存失败：${errorMessage}`
            : `Failed to save skill: ${errorMessage}`)
        }
      } catch (err) {
        console.error("Failed to update skill in database", err)
        window.alert(locale === "zh"
          ? "技能保存失败，请稍后重试。"
          : "Failed to save skill. Please try again.")
      }
    }
  }

  const handleDeleteSkill = async (id: string) => {
    if (!authHeaders) return
    try {
      const resp = await apiFetch(`/api/skills/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        const saved = await resp.json().catch(() => null)
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
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
    onCreateChange?.(false)
    setSelectedAgentId(id)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
    onEditAgentChange?.(null)
    setDeleteConfirmId(null)
    setShareLink(null)
  }

  const handleStartCreateAgent = useCallback(() => {
    if (isScopedAgentConfig) return
    onCreateChange?.(true)
    setSelectedAgentId(null)
    setIsCreatingAgent(true)
    setIsEditingAgent(false)
    onEditAgentChange?.(null)
    setAgentKbSearch("")
    setAgentSkillSearch("")
    setAgentMcpSearch("")
    setAgentRoleSearch("")
    setAgentForm({
      name: "",
      description: "",
      systemPrompt: "You are a helpful assistant.",
      model: getDefaultModel(),
      modelTemperature: "1",
      enabledTools: ["fetch"],
      knowledgeBaseIds: [],
      skillIds: [],
      skillCategoryIds: [],
      mcpIds: [],
      agentIds: [],
      formIds: [],
      formCategoryIds: [],
      formPermissions: {},
      customFunctions: [],
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
  }, [isScopedAgentConfig, onCreateChange, onEditAgentChange])

  const handleStartEditAgent = (profile: AgentProfile) => {
    onCreateChange?.(false)
    setSelectedAgentId(profile.id)
    setIsEditingAgent(true)
    setIsCreatingAgent(false)
    onEditAgentChange?.(profile.id)
    setAgentKbSearch("")
    setAgentSkillSearch("")
    setAgentMcpSearch("")
    setAgentRoleSearch("")
    setAgentForm({
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt,
      model: profile.model || "",
      modelTemperature: typeof profile.modelTemperature === "number" ? String(profile.modelTemperature) : "",
      enabledTools: profile.enabledTools,
      knowledgeBaseIds: profile.knowledgeBaseIds || [],
      skillIds: profile.skillIds || [],
      skillCategoryIds: profile.skillCategoryIds || [],
      mcpIds: profile.mcpIds || [],
      agentIds: (profile as any).agentIds || [],
      formIds: profile.formIds || [],
      formCategoryIds: profile.formCategoryIds || [],
      formPermissions: Object.fromEntries(
        (profile.formIds || []).map(formId => [
          formId,
          profile.formPermissions?.[formId] || ["read"],
        ]),
      ),
      customFunctions: profile.customFunctions || [],
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

  useEffect(() => {
    setAgentShareLinks([])
    setShareLink(null)
    setEditingShareToken(null)
    if (!selectedAgentId || !canManageWorkspace) return

    let cancelled = false
    setAgentShareLinksLoading(true)
    void listAgentShareLinks(selectedAgentId)
      .then((shares) => {
        if (!cancelled) setAgentShareLinks(shares)
      })
      .finally(() => {
        if (!cancelled) setAgentShareLinksLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [canManageWorkspace, listAgentShareLinks, selectedAgentId])

  const buildAgentShareUrl = useCallback((share: AgentShareLink) => {
    const url = new URL(window.location.origin)
    url.pathname = "/share/"
    url.search = ""
    url.searchParams.set("agentShare", share.customSlug || share.token)
    url.searchParams.delete("threadId")
    return url.toString()
  }, [])

  const resetShareForm = useCallback(() => {
    setEditingShareToken(null)
    setShareLink(null)
    setShareSlug("")
    setSharePrice("")
    setShareTrialMinutes("")
    setShareIntroduction("")
    setShareFaqItems([{ question: "", answer: "" }])
    setShareOptions({
      knowledgeBases: true,
      skills: true,
      mcpServers: true,
      agents: true,
      forms: true,
    })
  }, [])

  const startEditShare = useCallback((share: AgentShareLink) => {
    setEditingShareToken(share.token)
    setShareLink(buildAgentShareUrl(share))
    setShareSlug(share.customSlug || "")
    setSharePrice(share.priceCents > 0 ? String(share.priceCents / 100) : "")
    setShareTrialMinutes(share.trialDurationMinutes > 0 ? String(share.trialDurationMinutes) : "")
    setShareIntroduction(share.introductionText || "")
    setShareFaqItems(share.faqItems && share.faqItems.length > 0 ? share.faqItems : [{ question: "", answer: "" }])
    setShareOptions(share.include)
  }, [buildAgentShareUrl])

  const handleCopyAgentShareLink = async (share: AgentShareLink) => {
    const nextLink = buildAgentShareUrl(share)
    setShareLink(nextLink)
    try {
      await navigator.clipboard.writeText(nextLink)
    } catch (err) {
      console.error("Failed to copy agent share link", err)
    }
  }

  const updateShareFaqItem = (index: number, field: keyof AgentShareFaqItem, value: string) => {
    setShareFaqItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  const addShareFaqItem = () => {
    setShareFaqItems((current) => [
      ...current,
      { question: "", answer: "" },
    ])
  }

  const removeShareFaqItem = (index: number) => {
    setShareFaqItems((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length > 0 ? next : [{ question: "", answer: "" }]
    })
  }

  const handleSaveAgentShare = async (id: string) => {
    if (!canManageWorkspace) return
    const priceYuan = sharePrice.trim() === "" ? 0 : Number(sharePrice)
    if (!Number.isFinite(priceYuan) || priceYuan < 0) {
      window.alert(locale === "zh" ? "价格必须是大于等于 0 的数字。" : "Price must be a number greater than or equal to 0.")
      return
    }
    const trialMinutes = shareTrialMinutes.trim() === "" ? 0 : Number(shareTrialMinutes)
    if (!Number.isInteger(trialMinutes) || trialMinutes < 0) {
      window.alert(locale === "zh" ? "试用时间必须是大于等于 0 的整数分钟。" : "Trial time must be an integer number of minutes greater than or equal to 0.")
      return
    }
    setSharingAgentId(id)
    try {
      const payload = {
        customSlug: shareSlug.trim() || null,
        priceCents: Math.round(priceYuan * 100),
        currency: "CNY",
        trialDurationMinutes: priceYuan > 0 ? trialMinutes : 0,
        introductionText: shareIntroduction.trim() || null,
        faqItems: shareFaqItems
          .map((item) => ({
            question: item.question.trim(),
            answer: item.answer.trim(),
          }))
          .filter((item) => item.question && item.answer),
      }
      const share = editingShareToken
        ? await updateAgentShareLink(editingShareToken, shareOptions, payload)
        : await createAgentShareLink(id, shareOptions, payload)
      if (!share) return
      const nextLink = buildAgentShareUrl(share)
      setShareLink(nextLink)
      setEditingShareToken(share.token)
      setAgentShareLinks(prev => {
        const exists = prev.some(item => item.token === share.token)
        return exists
          ? prev.map(item => item.token === share.token ? share : item)
          : [share, ...prev]
      })
      await navigator.clipboard.writeText(nextLink)
    } catch (err) {
      console.error("Failed to save agent share link", err)
    } finally {
      setSharingAgentId(null)
    }
  }

  const handleDeleteAgentShare = async (share: AgentShareLink) => {
    if (!canManageWorkspace) return
    const confirmed = window.confirm(locale === "zh" ? "确定删除这个分享链接？删除后该地址将无法访问。" : "Delete this share link? The address will stop working.")
    if (!confirmed) return

    setDeletingShareToken(share.token)
    try {
      const deleted = await deleteAgentShareLink(share.token)
      if (!deleted) return
      setAgentShareLinks(prev => prev.filter(item => item.token !== share.token))
      if (editingShareToken === share.token) resetShareForm()
    } finally {
      setDeletingShareToken(null)
    }
  }

  const toggleShareOption = (key: keyof AgentShareOptions) => {
    setShareOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const submitAgentChangeRequest = async (
    action: "create" | "update",
    profile: AgentProfile,
    previousValues?: Record<string, unknown>,
  ) => {
    if (!authHeaders || !activeWorkspace) return false

    const payload: Record<string, unknown> = { ...profile }
    if (action === "update" && previousValues) {
      payload.previousValues = previousValues
    }

    const response = await apiFetch(`/api/workspaces/${activeWorkspace.id}/change-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        targetType: "agent_profile",
        targetId: action === "update" ? profile.id : null,
        action,
        payload,
      }),
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return true
  }

  const handleSaveAgent = async () => {
    if (!agentForm.name.trim()) return
    const modelTemperature = agentForm.modelTemperature.trim() === ""
      ? null
      : Number(agentForm.modelTemperature)
    if (
      modelTemperature !== null &&
      (!Number.isFinite(modelTemperature) || modelTemperature < 0 || modelTemperature > 2)
    ) {
      window.alert(locale === "zh" ? "Temperature 必须在 0 到 2 之间。" : "Temperature must be between 0 and 2.")
      return
    }

    const enabledTools = [
      ...agentForm.enabledTools.filter(
        tool => tool !== "rag_search" && tool !== "query_form_data" && tool !== "manage_form_data"
      ),
      ...(agentForm.knowledgeBaseIds.length > 0 ? ["rag_search" as const] : []),
      ...((agentForm.formCategoryIds.length > 0 || Object.values(agentForm.formPermissions).some(permissions =>
        permissions.includes("read")
      )) ? ["query_form_data" as const] : []),
      ...(Object.values(agentForm.formPermissions).some(permissions =>
        permissions.some(permission => permission !== "read")
      ) ? ["manage_form_data" as const] : []),
    ]

    const profileData = {
      name: agentForm.name.trim(),
      description: agentForm.description.trim(),
      systemPrompt: agentForm.systemPrompt,
      model: agentForm.model || null,
      modelTemperature,
      enabledTools,
      knowledgeBaseIds: agentForm.knowledgeBaseIds,
      skillIds: agentForm.skillIds,
      skillCategoryIds: agentForm.skillCategoryIds,
      mcpIds: agentForm.mcpIds,
      agentIds: agentForm.agentIds,
      formIds: agentForm.formIds,
      formCategoryIds: agentForm.formCategoryIds,
      formPermissions: agentForm.formPermissions,
      customFunctions: agentForm.customFunctions,
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
      if (!canManageWorkspace) {
        const now = new Date().toISOString()
        const pendingProfile: AgentProfile = {
          ...(profileData as Omit<AgentProfile, "id" | "createdAt" | "updatedAt">),
          id: generateUUID(),
          createdAt: now,
          updatedAt: now,
        }
        try {
          const submitted = await submitAgentChangeRequest("create", pendingProfile)
          if (submitted) {
            setIsCreatingAgent(false)
            onCreateChange?.(false)
            onEditAgentChange?.(null)
            onBackToChat()
          }
        } catch (err) {
          console.error("Failed to submit agent profile change request", err)
          window.alert(locale === "zh" ? "提交审批失败，请稍后重试。" : "Failed to submit change request. Please try again.")
        }
        return
      }

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
      if (!canManageWorkspace) {
        const target = agentProfiles.find(profile => profile.id === activeEditingAgentId)
        if (!target) return
        const pendingProfile: AgentProfile = {
          ...target,
          ...(profileData as Partial<AgentProfile>),
          updatedAt: new Date().toISOString(),
        }
        try {
          const submitted = await submitAgentChangeRequest("update", pendingProfile, target as unknown as Record<string, unknown>)
          if (submitted) {
            setIsEditingAgent(false)
            onEditAgentChange?.(null)
            onCreateChange?.(false)
            onBackToChat()
          }
        } catch (err) {
          console.error("Failed to submit agent profile change request", err)
          window.alert(locale === "zh" ? "提交审批失败，请稍后重试。" : "Failed to submit change request. Please try again.")
        }
        return
      }

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
    if (isScopedAgentConfig) return
    if (!canManageWorkspace) return
    deleteAgentProfile(id)
    setDeleteConfirmId(null)
    setSelectedAgentId(null)
    onEditAgentChange?.(null)
  }

  const handleCancelAgentForm = () => {
    onCreateChange?.(false)
    setIsEditingAgent(false)
    setIsCreatingAgent(false)
    onEditAgentChange?.(null)
  }

  const handleRestoreAgentVersion = async (versionId: string) => {
    if (!canManageWorkspace || !selectedAgentId) return

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

  const handleAddCustomFunction = () => {
    const firstFormId = agentForm.formIds[0] || forms[0]?.id || ""
    setAgentForm(prev => ({
      ...prev,
      customFunctions: [
        ...prev.customFunctions,
        {
          id: `macro_${generateUUID().slice(0, 8)}`,
          name: locale === "zh" ? "新宏操作" : "New macro",
          description: locale === "zh" ? "执行预定义的表单操作。" : "Run predefined form operations.",
          enabled: true,
          parameters: [],
          steps: [
            {
              action: "create",
              formId: firstFormId,
              data: {},
            },
          ],
        },
      ],
    }))
  }

  const handleUpdateCustomFunction = (id: string, patch: Partial<CustomFunction>) => {
    setAgentForm(prev => ({
      ...prev,
      customFunctions: prev.customFunctions.map(item =>
        item.id === id ? { ...item, ...patch } : item
      ),
    }))
  }

  const handleRemoveCustomFunction = (id: string) => {
    setAgentForm(prev => ({
      ...prev,
      customFunctions: prev.customFunctions.filter(item => item.id !== id),
    }))
  }

  const visibleBuiltinTools = BUILTIN_TOOLS

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
    onCreateChange?.(false)
    setSelectedMcpId(id)
    setIsEditingMcp(false)
    setIsCreatingMcp(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateMcp = () => {
    onCreateChange?.(true)
    setSelectedMcpId(null)
    setIsCreatingMcp(true)
    setIsEditingMcp(false)
    setMcpSaveError("")
    setMcpForm({
      name: "",
      type: "streamable_http",
      url: "http://localhost:8000/mcp",
      headers: "{\n  \"Authorization\": \"Bearer token\"\n}"
    })
    setDeleteConfirmId(null)
  }

  const handleStartEditMcp = (mcp: McpServer) => {
    onCreateChange?.(false)
    setSelectedMcpId(mcp.id)
    setIsEditingMcp(true)
    setIsCreatingMcp(false)
    setMcpSaveError("")
    setMcpForm({
      name: mcp.name,
      type: normalizeMcpTransport(mcp.type),
      url: mcp.url || "",
      headers: JSON.stringify(mcp.headers || {}, null, 2)
    })
    setDeleteConfirmId(null)
  }

  const handleSaveMcp = async () => {
    if (!mcpForm.name.trim() || !authHeaders) return

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
    setIsSavingMcp(true)
    setMcpSaveError("")

    try {
      if (isCreatingMcp) {
        const newMcp: Omit<McpServer, "createdAt" | "updatedAt" | "tools" | "resources" | "prompts"> = {
          id: generateUUID(),
          name: mcpForm.name.trim(),
          type: mcpForm.type,
          url: mcpForm.url.trim() || undefined,
          headers: parsedHeaders
        }

        const resp = await apiFetch("/api/mcp-servers", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            ...newMcp,
            createdAt: now,
            updatedAt: now
          })
        })
        if (!resp.ok) throw new Error((await resp.json()).detail || t.mcpDiscoveryFailed)
        const saved = await resp.json()
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
        setMcpServers(prev => [...prev, saved])
        setSelectedMcpId(saved.id)
        setIsCreatingMcp(false)
        onCreateChange?.(false)
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

        const resp = await apiFetch(`/api/mcp-servers/${selectedMcpId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedMcp)
        })
        if (!resp.ok) throw new Error((await resp.json()).detail || t.mcpDiscoveryFailed)
        const saved = await resp.json()
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
        setMcpServers(prev => prev.map(m => m.id === selectedMcpId ? saved : m))
        setIsEditingMcp(false)
      }
    } catch (err) {
      console.error("Failed to save MCP server in database", err)
      setMcpSaveError(err instanceof Error ? err.message : t.mcpDiscoveryFailed)
    } finally {
      setIsSavingMcp(false)
    }
  }

  const handleDeleteMcp = async (id: string) => {
    if (!authHeaders) return
    try {
      const resp = await apiFetch(`/api/mcp-servers/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        const saved = await resp.json().catch(() => null)
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
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
    onCreateChange?.(false)
    setSelectedKBId(id)
    setIsEditingKB(false)
    setIsCreatingKB(false)
    setDeleteConfirmId(null)
  }

  const handleStartCreateKB = () => {
    onCreateChange?.(true)
    setSelectedKBId(null)
    setIsCreatingKB(true)
    setIsEditingKB(false)
    setKbForm({ name: "", description: "" })
    setDeleteConfirmId(null)
  }

  const handleStartEditKB = (kb: KnowledgeBase) => {
    if (kb.isSystem) return
    onCreateChange?.(false)
    setSelectedKBId(kb.id)
    setIsEditingKB(true)
    setIsCreatingKB(false)
    setKbForm({ name: kb.name, description: kb.description })
    setDeleteConfirmId(null)
  }

  const handleSaveKB = async () => {
    if (!kbForm.name.trim() || !authHeaders) return

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
        const resp = await apiFetch("/api/knowledge-bases", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(newKB),
        })
        if (resp.ok) {
          const saved = await resp.json()
          if (isPendingChangeResponse(saved)) {
            handlePendingChangeResponse()
            return
          }
          setKnowledgeBases(prev => [...prev, saved])
          setSelectedKBId(saved.id)
          setIsCreatingKB(false)
          onCreateChange?.(false)
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
        const resp = await apiFetch(`/api/knowledge-bases/${selectedKBId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(updatedKB),
        })
        if (resp.ok) {
          const saved = await resp.json()
          if (isPendingChangeResponse(saved)) {
            handlePendingChangeResponse()
            return
          }
          setKnowledgeBases(prev => prev.map(kb => kb.id === selectedKBId ? saved : kb))
          setIsEditingKB(false)
        }
      } catch (err) {
        console.error("Failed to update knowledge base in database", err)
      }
    }
  }

  const handleDeleteKB = async (id: string) => {
    if (!authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === id)
    if (target?.isSystem) return
    try {
      const resp = await apiFetch(`/api/knowledge-bases/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      })
      if (resp.ok) {
        const saved = await resp.json().catch(() => null)
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
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
    if (!file || !selectedKBId || !authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === selectedKBId)
    if (target?.isSystem) return

    setUploadingFile(true)
    const form = new FormData()
    form.append("file", file)
    try {
      const resp = await apiFetch(`/api/knowledge-bases/${selectedKBId}/upload`, {
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
    if (!selectedKBId || !authHeaders) return
    const target = knowledgeBases.find(kb => kb.id === selectedKBId)
    if (target?.isSystem) return
    try {
      const resp = await apiFetch(`/api/knowledge-bases/${selectedKBId}/files/${encodeURIComponent(fileName)}`, {
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

  // ---------------------------------------------------------------------------
  // Form Actions
  // ---------------------------------------------------------------------------
  const handleSelectForm = (id: string) => {
    onCreateChange?.(false)
    setSelectedFormId(id)
    setIsEditingForm(false)
    setIsCreatingForm(false)
    setSelectedFormFieldId(null)
    setDeleteConfirmId(null)
    setRecordPage(1)
  }

  const handleStartCreateForm = (category = "") => {
    localCreateHandledRef.current = true
    onCreateChange?.(true)
    setSelectedFormId(null)
    setIsCreatingForm(true)
    setIsEditingForm(false)
    setFormDefinition({
      name: "",
      description: "",
      category,
      fields: [{ id: "name", label: locale === "zh" ? "名称" : "Name", type: "text", required: false, options: [] }],
      hooks: [],
    })
    setSelectedFormFieldId("name")
    setDeleteConfirmId(null)
  }

  const handleStartCreateAgentLinkedForm = (category = "") => {
    setAgentLinkedResourceCreateContext({
      type: "form",
      agentMode: isCreatingAgent ? "create" : "edit",
      agentId: selectedAgentId,
    })
    setActiveTab("forms")
    handleStartCreateForm(category)
  }

  const handleStartEditForm = (form: CustomForm) => {
    onCreateChange?.(false)
    setSelectedFormId(form.id)
    setIsEditingForm(true)
    setIsCreatingForm(false)
    setFormDefinition({
      name: form.name,
      description: form.description,
      category: form.category || "",
      fields: form.fields || [],
      hooks: form.hooks || [],
    })
    setSelectedFormFieldId(form.fields[0]?.id || null)
    setDeleteConfirmId(null)
  }

  const createRouteHandledRef = useRef(false)

  useEffect(() => {
    if (!createOnOpen) {
      if (createRouteHandledRef.current) {
        setIsCreatingSkill(false)
        setIsCreatingAgent(false)
        setIsCreatingMcp(false)
        setIsCreatingKB(false)
        setIsCreatingForm(false)
      }
      createRouteHandledRef.current = false
      return
    }
    if (createRouteHandledRef.current) return

    if (localCreateHandledRef.current) {
      createRouteHandledRef.current = true
      localCreateHandledRef.current = false
      return
    }

    createRouteHandledRef.current = true
    if (activeTab === "skills") handleStartCreateSkill()
    else if (activeTab === "agents") handleStartCreateAgent()
    else if (activeTab === "mcp") handleStartCreateMcp()
    else if (activeTab === "forms") handleStartCreateForm()
    else handleStartCreateKB()
  }, [activeTab, createOnOpen])

  const parseFormFields = (): CustomFormField[] | null => {
    const seen = new Set<string>()
    const fields = formDefinition.fields.map((field) => ({
      id: String(field.id || "").trim(),
      label: String(field.label || field.id || "").trim(),
      type: (["text", "number", "date", "boolean", "select"].includes(field.type) ? field.type : "text") as CustomFormField["type"],
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options.map(String).filter(Boolean) : [],
    })).filter(field => field.id && field.label)
    const hasDuplicate = fields.some(field => {
      if (seen.has(field.id)) return true
      seen.add(field.id)
      return false
    })
    const hasSystemFieldId = fields.some(field => SYSTEM_FORM_FIELD_IDS.has(field.id))
    if (hasSystemFieldId) {
      alert(locale === "zh" ? "createdAt 和 updatedAt 是系统字段，不能作为自定义字段 ID" : "createdAt and updatedAt are system fields and cannot be used as custom field IDs")
      return null
    }
    if (hasDuplicate) {
      alert(locale === "zh" ? "字段 ID 不能重复" : "Field IDs must be unique")
      return null
    }
    return fields
  }

  const parseFormHooks = (fields: CustomFormField[]): CustomFormHook[] | null => {
    const fieldIds = new Set(fields.map(field => field.id))
    const hooks = (formDefinition.hooks || []).map((hook) => {
      const conditions = (hook.conditions && hook.conditions.length > 0
        ? hook.conditions
        : [{
            fieldId: hook.fieldId || "",
            matchType: hook.matchType || "regex",
            pattern: hook.pattern || "",
            value: hook.value || "",
          }]
      ).map(condition => ({
        fieldId: String(condition.fieldId || "").trim(),
        matchType: (["regex", "value", "empty", "not_empty"].includes(condition.matchType)
          ? condition.matchType
          : "regex") as CustomFormHookCondition["matchType"],
        pattern: String(condition.pattern || ""),
        value: String(condition.value || ""),
      }))
      const firstCondition = conditions[0]
      return {
        id: String(hook.id || generateUUID()).trim(),
        name: String(hook.name || "").trim(),
        enabled: hook.enabled !== false,
        conditions,
        conditionLogic: (hook.conditionLogic === "any" ? "any" : "all") as CustomFormHook["conditionLogic"],
        fieldId: firstCondition?.fieldId || "",
        matchType: (firstCondition?.matchType === "value" ? "value" : "regex") as CustomFormHook["matchType"],
        pattern: firstCondition?.pattern || "",
        value: firstCondition?.value || "",
        url: String(hook.url || "").trim(),
        method: (["POST", "PUT", "PATCH"].includes(hook.method) ? hook.method : "POST") as CustomFormHook["method"],
        headers: Object.fromEntries(
          Object.entries(hook.headers && typeof hook.headers === "object" ? hook.headers : {})
            .map(([key, value]) => [String(key).trim(), String(value)])
            .filter(([key]) => key)
        ),
        payloadFieldIds: (hook.payloadFieldIds || []).map(item => String(item).trim()).filter(item => fieldIds.has(item)),
      }
    }).filter(hook => hook.conditions.some(condition => condition.fieldId || condition.pattern || condition.value) || hook.url)

    const invalidHook = hooks.find(hook => {
      if (!hook.conditions.length) return true
      if (hook.conditions.some(condition => !fieldIds.has(condition.fieldId))) return true
      if (!hook.url.startsWith("http://") && !hook.url.startsWith("https://")) return true
      return hook.conditions.some(condition => {
        if (condition.matchType === "regex" && !condition.pattern) return true
        return condition.matchType === "value" && condition.value === ""
      })
    })
    if (invalidHook) {
      alert(locale === "zh"
        ? "Hook 需要选择有效字段、填写 http(s) API 地址，并配置匹配条件。"
        : "Each hook needs a valid field, an http(s) API URL, and a match condition.")
      return null
    }
    return hooks
  }

  const handleSaveForm = async () => {
    if (!authHeaders || !formDefinition.name.trim()) return
    const fields = parseFormFields()
    if (!fields) return
    const hooks = parseFormHooks(fields)
    if (!hooks) return
    const now = new Date().toISOString()
    if (isCreatingForm) {
      const payload: CustomForm = {
        id: generateUUID(),
        name: formDefinition.name.trim(),
        description: formDefinition.description.trim(),
        category: formDefinition.category.trim(),
        fields,
        hooks,
        recordCount: 0,
        createdAt: now,
        updatedAt: now,
      }
      const resp = await apiFetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      })
      if (resp.ok) {
        const saved = await resp.json()
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
        setForms(prev => [...prev, saved])
        setSelectedFormId(saved.id)
        setIsCreatingForm(false)
        onCreateChange?.(false)
        if (agentLinkedResourceCreateContext?.type === "form") {
          returnToAgentEditorAfterLinkedResourceCreate(agentLinkedResourceCreateContext, saved.id)
        }
      }
    } else if (isEditingForm && selectedFormId) {
      const target = forms.find(form => form.id === selectedFormId)
      if (!target) return
      const resp = await apiFetch(`/api/forms/${selectedFormId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          ...target,
          name: formDefinition.name.trim(),
          description: formDefinition.description.trim(),
          category: formDefinition.category.trim(),
          fields,
          hooks,
          updatedAt: now,
        }),
      })
      if (resp.ok) {
        const saved = await resp.json()
        if (isPendingChangeResponse(saved)) {
          handlePendingChangeResponse()
          return
        }
        setForms(prev => prev.map(form => form.id === selectedFormId ? saved : form))
        setIsEditingForm(false)
      }
    }
  }

  const handleDeleteForm = async (id: string) => {
    if (!authHeaders) return
    const resp = await apiFetch(`/api/forms/${id}`, { method: "DELETE", headers: authHeaders })
    if (resp.ok) {
      const saved = await resp.json().catch(() => null)
      if (isPendingChangeResponse(saved)) {
        handlePendingChangeResponse()
        return
      }
      setForms(prev => {
        const updated = prev.filter(form => form.id !== id)
        setSelectedFormId(updated[0]?.id || null)
        return updated
      })
      setDeleteConfirmId(null)
    }
  }

  const handleAddFormRecord = async () => {
    if (!selectedFormId) return
    const selectedForm = forms.find(form => form.id === selectedFormId)
    const data = Object.fromEntries(
      (selectedForm?.fields || []).map(field => [field.id, field.type === "boolean" ? false : null])
    ) as Record<string, string | number | boolean | null>
    const now = new Date().toISOString()
    const draftRecord: CustomFormRecord = {
      id: `${DRAFT_FORM_RECORD_ID_PREFIX}${generateUUID()}`,
      formId: selectedFormId,
      data,
      createdAt: now,
      updatedAt: now,
    }
    setFormRecords(prev => [draftRecord, ...prev])
    setDirtyFormRecordIds(prev => new Set(prev).add(draftRecord.id))
  }

  const handleUpdateFormRecordCell = async (
    record: CustomFormRecord,
    field: CustomFormField,
    value: string | number | boolean | null,
  ) => {
    const normalizedValue = normalizeFieldValue(field, value)
    if (record.data?.[field.id] === normalizedValue) return
    const now = new Date().toISOString()
    const updatedRecord: CustomFormRecord = {
      ...record,
      data: { ...(record.data || {}), [field.id]: normalizedValue },
      updatedAt: now,
    }
    setFormRecords(prev => prev.map(item => item.id === record.id ? updatedRecord : item))
    setDirtyFormRecordIds(prev => new Set(prev).add(record.id))
    setFormRecordValidationErrors(prev => {
      if (!prev[record.id]?.[field.id]) return prev
      const nextRecordErrors = { ...prev[record.id] }
      delete nextRecordErrors[field.id]
      const next = { ...prev }
      if (Object.keys(nextRecordErrors).length > 0) next[record.id] = nextRecordErrors
      else delete next[record.id]
      return next
    })
  }

  const handleSaveFormRecord = async (recordId: string) => {
    if (!authHeaders || !selectedFormId) return false
    const selectedForm = forms.find(form => form.id === selectedFormId)
    const record = formRecords.find(item => item.id === recordId)
    if (!selectedForm || !record) return false

    const errors = validateFormRecordData(selectedForm.fields, record.data || {}, locale)
    setFormRecordValidationErrors(prev => {
      const next = { ...prev }
      if (Object.keys(errors).length > 0) next[recordId] = errors
      else delete next[recordId]
      return next
    })
    if (Object.keys(errors).length > 0) return false

    const isDraftRecord = record.id.startsWith(DRAFT_FORM_RECORD_ID_PREFIX)
    const updatedRecord = {
      ...record,
      id: isDraftRecord ? generateUUID() : record.id,
      updatedAt: new Date().toISOString(),
    }
    const resp = await apiFetch(
      isDraftRecord
        ? `/api/forms/${selectedFormId}/records`
        : `/api/forms/${selectedFormId}/records/${record.id}`,
      {
        method: isDraftRecord ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(updatedRecord),
      },
    )
    if (resp.ok) {
      const saved = await resp.json()
      if (isPendingChangeResponse(saved)) {
        handlePendingChangeResponse()
        setDirtyFormRecordIds(prev => {
          const next = new Set(prev)
          next.delete(record.id)
          return next
        })
        return true
      }
      setFormRecords(prev => prev.map(item => item.id === record.id ? saved : item))
      setDirtyFormRecordIds(prev => {
        const next = new Set(prev)
        next.delete(record.id)
        return next
      })
      if (isDraftRecord) {
        setFormRecordTotal(prev => prev + 1)
        setForms(prev => prev.map(form => form.id === selectedFormId ? { ...form, recordCount: form.recordCount + 1 } : form))
      }
      return true
    }
    return false
  }

  const handleSaveDirtyFormRecords = async () => {
    for (const recordId of Array.from(dirtyFormRecordIds)) {
      await handleSaveFormRecord(recordId)
    }
  }

  const handleDeleteFormRecord = async (recordId: string) => {
    if (recordId.startsWith(DRAFT_FORM_RECORD_ID_PREFIX)) {
      setFormRecords(prev => prev.filter(record => record.id !== recordId))
      setDirtyFormRecordIds(prev => {
        const next = new Set(prev)
        next.delete(recordId)
        return next
      })
      setFormRecordValidationErrors(prev => {
        const next = { ...prev }
        delete next[recordId]
        return next
      })
      return
    }
    if (!authHeaders || !selectedFormId) return
    const resp = await apiFetch(`/api/forms/${selectedFormId}/records/${recordId}`, {
      method: "DELETE",
      headers: authHeaders,
    })
    if (resp.ok) {
      const saved = await resp.json().catch(() => null)
      if (isPendingChangeResponse(saved)) {
        handlePendingChangeResponse()
        return
      }
      setFormRecords(prev => prev.filter(record => record.id !== recordId))
      setDirtyFormRecordIds(prev => {
        const next = new Set(prev)
        next.delete(recordId)
        return next
      })
      setFormRecordValidationErrors(prev => {
        const next = { ...prev }
        delete next[recordId]
        return next
      })
      setFormRecordTotal(prev => Math.max(0, prev - 1))
      setForms(prev => prev.map(form => form.id === selectedFormId ? { ...form, recordCount: Math.max(0, form.recordCount - 1) } : form))
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
  const selectedSkillView = useMemo(
    () => selectedSkill ? parseSkillForView(selectedSkill.content) : null,
    [selectedSkill]
  )
  const selectedAgent = selectedAgentId
    ? agentProfiles.find(p => (
      p.id === selectedAgentId
      && !isSystemAgentProfile(p)
      && (!scopedAgentProfileId || p.id === scopedAgentProfileId)
    )) || null
    : null
  const selectedAgentLinkedForms = useMemo(
    () => getLinkedFormsForAgent(selectedAgent, forms),
    [forms, selectedAgent],
  )
  const selectedKB = knowledgeBases.find(kb => kb.id === selectedKBId) || null
  const selectedMcp = mcpServers.find(m => m.id === selectedMcpId) || null
  const selectedForm = forms.find(form => form.id === selectedFormId) || null

  const handleOpenLinkedResourceEditor = (
    event: React.MouseEvent<HTMLButtonElement>,
    resource:
      | { type: "knowledge"; item: KnowledgeBase }
      | { type: "skill"; item: Skill }
      | { type: "mcp"; item: McpServer }
      | { type: "form"; item: CustomForm }
      | { type: "agent"; item: AgentProfile },
  ) => {
    event.stopPropagation()
    setDeleteConfirmId(null)

    if (resource.type === "knowledge") {
      setActiveTab("knowledge")
      if (resource.item.isSystem) {
        handleSelectKB(resource.item.id)
      } else {
        handleStartEditKB(resource.item)
      }
      return
    }

    if (resource.type === "skill") {
      setActiveTab("skills")
      handleStartEditSkill(resource.item)
      return
    }

    if (resource.type === "mcp") {
      setActiveTab("mcp")
      handleStartEditMcp(resource.item)
      return
    }

    if (resource.type === "form") {
      setActiveTab("forms")
      handleStartEditForm(resource.item)
      return
    }

    setActiveTab("agents")
    handleStartEditAgent(resource.item)
  }

  const linkedResourceItemClassName = (linked: boolean) => cn(
    "group/item flex min-w-0 items-center gap-2 rounded-lg p-2 transition-colors cursor-pointer",
    "bg-muted/55 hover:bg-muted focus-within:bg-muted",
    linked && "bg-primary/10 hover:bg-primary/15 focus-within:bg-primary/15"
  )

  const linkedResourceJumpButtonClassName =
    "ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 sm:opacity-0 sm:group-hover/item:opacity-100 sm:group-focus-within/item:opacity-100"

  const renderHeaderConfigActions = () => {
    if (activeTab === "mcp") {
      if (isCreatingMcp || isEditingMcp) {
        return (
          <>
            <Button
              onClick={handleSaveMcp}
              disabled={!mcpForm.name.trim() || isSavingMcp}
              className="bg-primary text-primary-foreground hover:bg-primary-active rounded-lg cursor-pointer"
            >
              {isSavingMcp ? t.mcpDiscovering : submitConfigLabel}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onCreateChange?.(false)
                setIsEditingMcp(false)
                setIsCreatingMcp(false)
              }}
              className="rounded-lg bg-muted/70 text-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {t.cancel}
            </Button>
          </>
        )
      }

      if (selectedMcp) {
        return (
          <Button
            variant="outline"
            onClick={() => handleStartEditMcp(selectedMcp)}
            className="gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.editServer}
          </Button>
        )
      }
    }

    if (activeTab === "skills") {
      if (isCreatingSkill || isEditingSkill) {
        return (
          <>
            <Button
              onClick={handleSaveSkill}
              disabled={!skillForm.content.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-active rounded-lg cursor-pointer"
            >
              {agentLinkedResourceCreateContext?.type === "skill"
                ? canManageWorkspace
                  ? (locale === "zh" ? "保存并关联" : "Save and link")
                  : submitConfigLabel
                : submitConfigLabel}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (agentLinkedResourceCreateContext?.type === "skill") {
                  returnToAgentEditorFromLinkedResourceCreate()
                  return
                }
                onCreateChange?.(false)
                setIsEditingSkill(false)
                setIsCreatingSkill(false)
              }}
              className="rounded-lg bg-muted/70 text-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {t.cancel}
            </Button>
          </>
        )
      }

      if (selectedSkill) {
        return (
          <Button
            variant="outline"
            onClick={() => handleStartEditSkill(selectedSkill)}
            className="gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.editSkill}
          </Button>
        )
      }
    }

    if (activeTab === "agents") {
      if (isCreatingAgent || isEditingAgent) {
        return (
          <>
            <Button
              onClick={handleSaveAgent}
              disabled={!agentForm.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-active rounded-lg cursor-pointer"
            >
              {submitConfigLabel}
            </Button>
            <Button
              variant="ghost"
              onClick={handleCancelAgentForm}
              className="rounded-lg bg-muted/70 text-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {t.cancel}
            </Button>
          </>
        )
      }

      if (selectedAgent) {
        return (
          <>
            <Button
              variant="outline"
              onClick={() => handleStartEditAgent(selectedAgent)}
              className="gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t.editAgent}
            </Button>
          </>
        )
      }
    }

    if (activeTab === "knowledge") {
      if (isCreatingKB || isEditingKB) {
        return (
          <>
            <Button
              onClick={handleSaveKB}
              disabled={!kbForm.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-active rounded-lg cursor-pointer"
            >
              {submitConfigLabel}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onCreateChange?.(false)
                setIsEditingKB(false)
                setIsCreatingKB(false)
              }}
              className="rounded-lg bg-muted/70 text-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {t.cancel}
            </Button>
          </>
        )
      }

      if (selectedKB && !selectedKB.isSystem) {
        return (
          <Button
            variant="outline"
            onClick={() => handleStartEditKB(selectedKB)}
            className="gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t.editKB}
          </Button>
        )
      }
    }

    if (activeTab === "forms") {
      if (isCreatingForm || isEditingForm) {
        return (
          <>
            <Button
              onClick={handleSaveForm}
              disabled={!formDefinition.name.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary-active rounded-lg cursor-pointer"
            >
              {agentLinkedResourceCreateContext?.type === "form"
                ? canManageWorkspace
                  ? (locale === "zh" ? "保存并关联" : "Save and link")
                  : submitConfigLabel
                : submitConfigLabel}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (agentLinkedResourceCreateContext?.type === "form") {
                  returnToAgentEditorFromLinkedResourceCreate()
                  return
                }
                onCreateChange?.(false)
                setIsEditingForm(false)
                setIsCreatingForm(false)
              }}
              className="rounded-lg bg-muted/70 text-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              {t.cancel}
            </Button>
          </>
        )
      }

      if (selectedForm) {
        return (
          <Button
            variant="outline"
            onClick={() => handleStartEditForm(selectedForm)}
            className="gap-1.5 rounded-lg border-border hover:bg-primary/10 hover:text-primary"
          >
            <Pencil className="w-3.5 h-3.5" />
            {locale === "zh" ? "编辑表单" : "Edit Form"}
          </Button>
        )
      }
    }

    return null
  }

  const filteredAgentKnowledgeBases = knowledgeBases.filter(kb => {
    const query = agentKbSearch.trim().toLowerCase()
    if (!query) return true
    const fileNames = (kb.files || []).map(file => file.name).join(" ")
    return [kb.name, kb.description, kb.id, fileNames].some(value => value.toLowerCase().includes(query))
  })
  const filteredAgentSkills = skills.filter(skill => {
    const query = agentSkillSearch.trim().toLowerCase()
    if (!query) return true
    const category = getSkillCategory(skill, locale === "zh" ? "未分类" : "Uncategorized").label
    return [skill.name, skill.description, skill.id, category].some(value => value.toLowerCase().includes(query))
  })
  const skillCategoryGroups = useMemo(
    () => groupSkillsByCategory(skills, locale === "zh" ? "未分类" : "Uncategorized"),
    [locale, skills],
  )
  const filteredAgentSkillCategoryGroups = useMemo(
    () => groupSkillsByCategory(filteredAgentSkills, locale === "zh" ? "未分类" : "Uncategorized"),
    [filteredAgentSkills, locale],
  )
  const toggleCollapsedSkillCategory = (key: string) => {
    setCollapsedSkillCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const toggleCollapsedAgentSkillCategory = (key: string) => {
    setCollapsedAgentSkillCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const toggleCollapsedFormCategory = (key: string) => {
    setCollapsedFormCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const toggleCollapsedAgentFormCategory = (key: string) => {
    setCollapsedAgentFormCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }
  const filteredAgentMcpServers = mcpServers.filter(mcp => {
    const query = agentMcpSearch.trim().toLowerCase()
    if (!query) return true
    return [mcp.name, mcp.url || "", mcp.id].some(value => value.toLowerCase().includes(query))
  })
  const filteredAgentForms = forms.filter(form => {
    const query = agentRoleSearch.trim().toLowerCase()
    if (!query) return true
    return [form.name, form.description, form.category, form.id].some(value => value.toLowerCase().includes(query))
  })
  const formCategoryGroups = useMemo(
    () => groupFormsByCategory(forms, locale === "zh" ? "未分类" : "Uncategorized"),
    [forms, locale],
  )
  const filteredAgentFormCategoryGroups = useMemo(
    () => groupFormsByCategory(filteredAgentForms, locale === "zh" ? "未分类" : "Uncategorized"),
    [filteredAgentForms, locale],
  )
  const shareSlugPrefix = useMemo(
    () => shareSlugUserPrefix(user?.username || user?.id),
    [user?.id, user?.username],
  )
  const configurableAgentProfiles = agentProfiles.filter(profile => (
    !isSystemAgentProfile(profile)
    && (!scopedAgentProfileId || profile.id === scopedAgentProfileId)
  ))
  const linkableAgentProfiles = configurableAgentProfiles.filter(p => p.id !== activeEditingAgentId)
  const filteredLinkableAgentProfiles = linkableAgentProfiles.filter(profile => {
    const query = agentRoleSearch.trim().toLowerCase()
    if (!query) return true
    return [profile.name, profile.description, profile.id].some(value => value.toLowerCase().includes(query))
  })
  const configBundleResources = useMemo(() => ({
    agents: configurableAgentProfiles.map(item => ({ id: item.id, name: item.name })),
    skills: skills.map(item => ({ id: item.id, name: item.name })),
    knowledgeBases: knowledgeBases
      .filter(item => !item.isSystem)
      .map(item => ({ id: item.id, name: item.name })),
    mcpServers: mcpServers.map(item => ({ id: item.id, name: item.name })),
    forms: forms.map(item => ({ id: item.id, name: item.name })),
  }), [configurableAgentProfiles, forms, knowledgeBases, mcpServers, skills])
  return (
    <div className="flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* 1. Header Area */}
      <header className="flex min-h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide flex items-center gap-1.5 font-display">
              {t.management}
            </h1>
            <p className="text-[11px] text-muted-foreground/80 leading-none">
              {t.mcpConfigureDesc}
            </p>
            {activeWorkspace && (
              <p className="mt-1 text-[11px] text-muted-foreground/80 leading-none">
                {activeWorkspace.name} · {canManageWorkspace
                  ? (locale === "zh" ? "可管理" : "Can manage")
                  : (locale === "zh" ? "仅使用，修改需审批" : "Use only, changes require approval")}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {renderHeaderConfigActions()}
          <Button
            variant="outline"
            onClick={() => {
              setConfigBundleInitialSelection(undefined)
              setConfigBundleMode("import")
            }}
            className="gap-1.5 rounded-lg"
          >
            <Download className="h-3.5 w-3.5" />
            {locale === "zh" ? "导入配置" : "Import config"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setConfigBundleInitialSelection(undefined)
              setConfigBundleMode("export")
            }}
            className="gap-1.5 rounded-lg"
          >
            <Upload className="h-3.5 w-3.5" />
            {locale === "zh" ? "导出配置" : "Export config"}
          </Button>
          <NavActionButton
            asChild
            variant="outline"
            title={locale === "zh" ? "返回首页" : "Back to home"}
            aria-label={locale === "zh" ? "返回首页" : "Back to home"}
          >
            <Link href="/">
              <Home className="w-4 h-4" />
              {locale === "zh" ? "首页" : "Home"}
            </Link>
          </NavActionButton>
          <NavActionButton
            variant="outline"
            onClick={onBackToChat}
          >
            <ArrowLeft className="w-4 h-4" />
            {t.backToChat}
          </NavActionButton>
        </div>
      </header>
      <ConfigBundleDialog
        mode={configBundleMode}
        onOpenChange={open => {
          if (!open) setConfigBundleMode(null)
        }}
        locale={locale}
        authHeaders={authHeaders}
        resources={configBundleResources}
        initialSelection={configBundleInitialSelection}
      />

      {/* 2. Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* Content Detail View */}
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          {/* ========================================== */}
          {/* FORMS TAB PANEL                            */}
          {/* ========================================== */}
          {activeTab === "forms" && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
              <ListPanel
                title={locale === "zh" ? "后台管理" : "Backend Admin"}
                className="border-border/40 bg-background/30"
                action={
                  <Button
                    size="sm"
                    onClick={() => handleStartCreateForm()}
                    className="h-7 w-7 rounded-md border-none bg-primary p-0 text-primary-foreground hover:bg-primary-active cursor-pointer"
                    title={locale === "zh" ? "新建表单" : "Create form"}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                }
              >
                <div className="space-y-2">
                  {formCategoryGroups.map(group => {
                    const collapsed = collapsedFormCategories.has(group.key)
                    const createCategory = getCategoryValueForCreate(group.key, group.label, UNCATEGORIZED_FORM_CATEGORY)
                    return (
                      <div key={group.key} className="space-y-1.5">
                        <div className="flex items-center gap-1 rounded-md text-xs font-semibold uppercase text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => toggleCollapsedFormCategory(group.key)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                            aria-expanded={!collapsed}
                          >
                            {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">{group.label}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartCreateForm(createCategory)}
                            className="h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            title={locale === "zh" ? `新建${group.label}表单` : `Create ${group.label} form`}
                            aria-label={locale === "zh" ? `新建${group.label}表单` : `Create ${group.label} form`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                          <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {group.forms.length}
                          </span>
                        </div>
                        {!collapsed && group.forms.map(form => (
                          <ListItem
                            key={form.id}
                            selected={selectedFormId === form.id}
                            title={form.name}
                            description={`${form.fields.length + SYSTEM_FORM_FIELDS.length} ${locale === "zh" ? "字段" : "fields"} · ${form.recordCount} ${locale === "zh" ? "记录" : "records"}`}
                            onSelect={() => handleSelectForm(form.id)}
                            actionsClassName={deleteConfirmId === form.id ? "md:opacity-100" : "md:pointer-events-none md:group-hover:pointer-events-auto md:group-focus-within:pointer-events-auto"}
                            actions={
                              deleteConfirmId === form.id ? (
                                <>
                                  <Button variant="unstyled" onClick={() => handleDeleteForm(form.id)} className="p-1 rounded text-destructive hover:bg-destructive/10" title={t.confirmDelete}>
                                    <Check className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="unstyled" onClick={() => setDeleteConfirmId(null)} className="p-1 rounded text-muted-foreground hover:bg-muted" title={t.cancel}>
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button variant="unstyled" onClick={() => handleStartEditForm(form)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80" title={locale === "zh" ? "编辑" : "Edit"}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="unstyled" onClick={() => setDeleteConfirmId(form.id)} className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" title={t.delete}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </>
                              )
                            }
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </ListPanel>

              <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
                {isCreatingForm || isEditingForm ? (
                  <ScrollArea className="h-full min-h-0 w-full min-w-0 overflow-hidden" contentClassName="w-full min-w-0 space-y-5 p-4 sm:p-6">
                    <div className="space-y-5">
                      <div>
                        <h2 className="text-lg font-semibold">{isCreatingForm ? (locale === "zh" ? "新建表单" : "Create Form") : (locale === "zh" ? "编辑表单" : "Edit Form")}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {locale === "zh" ? "通过可视化列设计字段，保存后记录表格会按字段生成可编辑列。" : "Design fields visually as columns. The records table follows this structure after saving."}
                        </p>
                      </div>
                      <div className="grid gap-4 rounded-xl bg-muted/35 p-4 md:grid-cols-2">
                        <InputField
                          id="form-name"
                          label={locale === "zh" ? "表单名称" : "Form Name"}
                          value={formDefinition.name}
                          onChange={(e) => setFormDefinition(prev => ({ ...prev, name: e.target.value }))}
                        />
                        <InputField
                          id="form-category"
                          label={locale === "zh" ? "表单类型" : "Form Type"}
                          value={formDefinition.category}
                          placeholder={locale === "zh" ? "例如：客户、订单、巡检" : "e.g. Customer, Order, Inspection"}
                          onChange={(e) => setFormDefinition(prev => ({ ...prev, category: e.target.value }))}
                        />
                        <FormField label={locale === "zh" ? "描述" : "Description"} className="md:col-span-2">
                          <Textarea
                            value={formDefinition.description}
                            onChange={(e) => setFormDefinition(prev => ({ ...prev, description: e.target.value }))}
                            className="min-h-28 rounded-lg"
                          />
                        </FormField>
                      </div>
                      <FormFieldDesigner
                        locale={locale}
                        definition={formDefinition}
                        selectedFieldId={selectedFormFieldId}
                        onDefinitionChange={setFormDefinition}
                        onSelectedFieldChange={setSelectedFormFieldId}
                      />
                    </div>
                  </ScrollArea>
                ) : selectedForm ? (
                  <ScrollArea className="h-full min-h-0 w-full min-w-0 overflow-hidden" contentClassName="w-full min-w-0 space-y-5 p-4 sm:p-6">
                    <div className="w-full min-w-0 space-y-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <TableProperties className="h-5 w-5 text-primary" />
                            <h2 className="text-lg font-semibold">{selectedForm.name}</h2>
                            {selectedForm.category && (
                              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                {selectedForm.category}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{selectedForm.description || (locale === "zh" ? "无描述" : "No description")}</p>
                          <p className="mt-2 font-mono text-xs text-muted-foreground">{selectedForm.id}</p>
                        </div>
                      </div>

                      <FormRecordsTable
                        locale={locale}
                        form={selectedForm}
                        records={formRecords}
                        total={formRecordTotal}
                        page={recordPage}
                        query={recordQuery}
                        dirtyRecordIds={dirtyFormRecordIds}
                        validationErrors={formRecordValidationErrors}
                        onQueryChange={setRecordQuery}
                        onPageChange={setRecordPage}
                        onAddRecord={handleAddFormRecord}
                        onDeleteRecord={handleDeleteFormRecord}
                        onUpdateCell={handleUpdateFormRecordCell}
                        onSaveDirtyRecords={handleSaveDirtyFormRecords}
                      />
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                    {locale === "zh" ? "选择或新建一个表单。" : "Select or create a form."}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================== */}
          {/* MCP TAB PANEL                              */}
          {/* ========================================== */}
          {activeTab === "mcp" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {/* Left MCP Server List */}
              <ListPanel
                title={t.mcpServers}
                className="border-border/40 bg-background/30"
                action={
                  <Button
                    size="sm"
                    onClick={handleStartCreateMcp}
                    className="h-7 w-7 rounded-md border-none bg-primary p-0 text-primary-foreground hover:bg-primary-active cursor-pointer"
                    title={t.addMcpServer}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                }
              >
                {mcpServers.map(mcp => (
                  <ListItem
                    key={mcp.id}
                    selected={selectedMcpId === mcp.id}
                    title={mcp.name}
                    description="Streamable HTTP"
                    onSelect={() => handleSelectMcp(mcp.id)}
                    className={selectedMcpId === mcp.id ? "animate-pulse-subtle" : undefined}
                    actionsClassName={
                      deleteConfirmId === mcp.id
                        ? "md:opacity-100"
                        : "md:pointer-events-none md:group-hover:pointer-events-auto md:group-focus-within:pointer-events-auto"
                    }
                    actions={
                      deleteConfirmId === mcp.id ? (
                        <>
                          <Button variant="unstyled"
                            onClick={() => handleDeleteMcp(mcp.id)}
                            className="p-1 rounded text-destructive hover:bg-destructive/10"
                            title={t.confirmDelete}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="unstyled"
                            onClick={() => setDeleteConfirmId(null)}
                            className="p-1 rounded text-muted-foreground hover:bg-muted"
                            title={t.cancel}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="unstyled"
                            onClick={() => handleStartEditMcp(mcp)}
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                            title={t.editAgent.replace(t.agent, "").trim()}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="unstyled"
                            onClick={() => setDeleteConfirmId(mcp.id)}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title={t.delete}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )
                    }
                  />
                ))}
                {mcpServers.length === 0 && (
                  <div className="p-4 text-center text-xs text-muted-foreground italic">
                    {t.noMcpServers}
                  </div>
                )}
              </ListPanel>

              {/* Right MCP Details / Form */}
              <ScrollArea
                className="min-h-0 flex-1 bg-gradient-to-tr from-sidebar-accent/5 to-transparent"
                contentClassName="p-4 sm:p-6"
              >
                {isCreatingMcp || isEditingMcp ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex flex-col gap-3 pb-2 border-b sm:flex-row sm:items-center sm:justify-between border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Cpu className="w-5 h-5 text-primary" />
                        {isCreatingMcp ? t.addMcpServer : t.editMcpServer}
                      </h2>
                    </div>

                    <div className="space-y-4">
                      <InputField
                        id="mcp-name"
                        label={t.name}
                        value={mcpForm.name}
                        onChange={e => setMcpForm({ ...mcpForm, name: e.target.value })}
                        placeholder={t.mcpNamePlaceholder}
                        className="rounded-lg"
                      />

                      <InputField
                        id="mcp-url"
                        label={t.sseServerUrl}
                        value={mcpForm.url}
                        onChange={e => setMcpForm({ ...mcpForm, url: e.target.value })}
                        placeholder={t.mcpUrlPlaceholder}
                        className="font-mono text-xs rounded-lg"
                      />

                      <FormField
                        id="mcp-headers"
                        label={t.customHeadersJson}
                        description={t.mcpServerDescription}
                      >
                        <Textarea
                          id="mcp-headers"
                          value={mcpForm.headers}
                          onChange={e => setMcpForm({ ...mcpForm, headers: e.target.value })}
                          placeholder={t.mcpHeadersPlaceholder}
                          rows={6}
                          className="resize-none rounded-lg text-xs font-mono"
                        />
                      </FormField>
                      {mcpSaveError && (
                        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {mcpSaveError}
                        </div>
                      )}
                    </div>
                  </div>
                ) : selectedMcpId !== null && selectedMcp ? (
                  <div className="w-full space-y-4">
                    <div className="flex flex-col gap-3 pb-2 border-b sm:flex-row sm:items-center sm:justify-between border-border/40">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Cpu className="w-6 h-6 text-primary" />
                          {selectedMcp.name}
                        </h2>
                        <div className="text-xs font-mono uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded w-max mt-2">
                          {t.streamableHttpTransport}
                        </div>
                      </div>
                    </div>

                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
                      <div className="space-y-4 rounded-xl border border-border/50 bg-background/50 p-4">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground">{t.sseServerUrl}</div>
                          <div className="break-all rounded-lg border border-border/40 bg-muted/30 p-2.5 font-mono text-sm select-all">
                            {selectedMcp.url}
                          </div>
                        </div>

                        {Object.keys(selectedMcp.headers || {}).length > 0 ? (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground">{t.customHeaders}</div>
                            <pre className="overflow-x-auto rounded-lg border border-border/40 bg-muted/30 p-2.5 font-mono text-xs">
                              {JSON.stringify(selectedMcp.headers, null, 2)}
                            </pre>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-muted-foreground">{t.customHeaders}</div>
                            <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 text-xs italic text-muted-foreground">
                              {t.noCustomHeaders}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="grid items-start gap-3 sm:grid-cols-3">
                        {([
                          ["tools", t.mcpTools, selectedMcp.tools || []],
                          ["resources", t.mcpResources, selectedMcp.resources || []],
                          ["prompts", t.mcpPrompts, selectedMcp.prompts || []],
                        ] as const).map(([key, label, items]) => (
                          <div key={key} className="h-fit self-start rounded-xl bg-muted/50 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-foreground">{label}</span>
                              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                {items.length}
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {items.length > 0 ? items.map((item, index) => (
                                <div key={`${key}-${item.name || item.uri || item.uriTemplate || index}`} className="rounded-lg bg-background px-2.5 py-2">
                                  <div className="truncate text-xs font-medium">
                                    {item.title || item.name || item.uri || item.uriTemplate}
                                  </div>
                                  {item.description && (
                                    <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                                      {item.description}
                                    </div>
                                  )}
                                  {item.kind === "template" && (
                                    <div className="mt-1 text-[10px] text-primary">{t.mcpResourceTemplate}</div>
                                  )}
                                </div>
                              )) : (
                                <div className="text-[10px] italic text-muted-foreground">{t.mcpNoneAdvertised}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                    {t.selectOrCreateMcpToStart}
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ========================================== */}
          {/* SKILLS TAB PANEL                           */}
          {/* ========================================== */}
          {activeTab === "skills" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {/* Left Skill List */}
              <div className="flex max-h-[42dvh] min-h-0 w-full flex-shrink-0 flex-col border-b border-border/40 bg-background/30 md:max-h-none md:w-[300px] md:border-b-0 md:border-r">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.skillsManager}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => handleStartCreateSkill()}
                    className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none"
                    title={t.addSkill}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                <ScrollArea
                  className="min-h-0 flex-1"
                  contentClassName="space-y-2 p-3"
                >
                  {skills.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground/80">
                      <Wrench className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40 opacity-70" />
                      {t.noSkills}
                    </div>
                  ) : (
                    skillCategoryGroups.map(group => {
                      const collapsed = collapsedSkillCategories.has(group.key)
                      const createCategory = getCategoryValueForCreate(group.key, group.label, UNCATEGORIZED_SKILL_CATEGORY)
                      return (
                        <div key={group.key} className="space-y-1.5">
                          <div className="flex items-center gap-1 rounded-md text-xs font-semibold uppercase text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                            <Button variant="unstyled"
                              type="button"
                              onClick={() => toggleCollapsedSkillCategory(group.key)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                              aria-expanded={!collapsed}
                            >
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />}
                              <span className="truncate">{group.label}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStartCreateSkill(createCategory)}
                              className="h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                              title={locale === "zh" ? `新建${group.label}技能` : `Create ${group.label} skill`}
                              aria-label={locale === "zh" ? `新建${group.label}技能` : `Create ${group.label} skill`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                            <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {group.skills.length}
                            </span>
                          </div>
                          {!collapsed && group.skills.map(skill => (
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
                                    : "opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto"
                                }`}
                                onClick={e => e.stopPropagation()}
                              >
                                {deleteConfirmId === skill.id ? (
                                  <>
                                    <Button variant="unstyled"
                                      onClick={() => handleDeleteSkill(skill.id)}
                                      className="p-1 rounded text-destructive hover:bg-destructive/10"
                                      title={t.confirmDeleteTitle}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="unstyled"
                                      onClick={() => setDeleteConfirmId(null)}
                                      className="p-1 rounded text-muted-foreground hover:bg-muted"
                                      title={t.cancelTitle}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button variant="unstyled"
                                      onClick={() => handleStartEditSkill(skill)}
                                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                      title={t.editTitle}
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button variant="unstyled"
                                      onClick={() => setDeleteConfirmId(skill.id)}
                                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                      title={t.deleteTitle}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })
                  )}
                </ScrollArea>
              </div>

              {/* Right Skill Edit Form / Details */}
              <ScrollArea
                className="min-h-0 flex-1 bg-gradient-to-tr from-sidebar-accent/5 to-transparent"
                contentClassName="flex min-h-full flex-col p-4 sm:p-6"
              >
                {isCreatingSkill || isEditingSkill ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex flex-col gap-3 pb-2 border-b sm:flex-row sm:items-center sm:justify-between border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Code2 className="w-5 h-5 text-primary" />
                        {isCreatingSkill ? t.addSkill : t.editSkill}
                      </h2>
                    </div>

                    <div className="p-3.5 bg-primary/5 rounded-lg border border-primary/10 text-xs text-primary/80 leading-relaxed">
                      💡 <strong>提示</strong>：技能名称与描述已实现<strong>零冗余设计</strong>。您只需在下方技能内容的 YAML Frontmatter（<code>name</code> 与 <code>description</code>）中进行定义，系统在保存时会自动提取。
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      <div className="skill-content-editor">
                        <Textarea
                          id="skill-content"
                          value={skillForm.content}
                          onChange={e => setSkillForm({ ...skillForm, content: e.target.value })}
                          placeholder={t.skillContentPlaceholder}
                          rows={24}
                          className="font-mono text-sm resize-y rounded-lg border-border/80 bg-background"
                        />
                      </div>
                    </div>


                  </div>
                ) : selectedSkill ? (
                  <div className="max-w-2xl space-y-4 flex-1 flex flex-col">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display">{selectedSkill.name}</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedSkill.description || t.noDescriptionProvided}
                        </p>
                      </div>
                    </div>

                    {selectedSkillView && (
                      <SkillStructuredView
                        skill={selectedSkill}
                        parsed={selectedSkillView}
                        locale={locale}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">{t.selectSkillToViewOrCreate}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartCreateSkill()}
                        className="mt-3 gap-1.5 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-lg"
                      >
                        <Plus className="w-4 h-4 text-primary" />
                        {t.addSkill}
                      </Button>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ========================================== */}
          {/* AGENTS TAB PANEL                           */}
          {/* ========================================== */}
          {activeTab === "agents" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {/* Left Role List */}
              <div className="flex max-h-[42dvh] min-h-0 w-full flex-shrink-0 flex-col border-b border-border/40 bg-background/30 md:max-h-none md:w-[300px] md:border-b-0 md:border-r">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {t.agentsManager}
                  </span>
                  {!isScopedAgentConfig && (
                    <Button
                      size="sm"
                      onClick={handleStartCreateAgent}
                      className="h-7 w-7 rounded-md p-0 bg-primary hover:bg-primary-active text-primary-foreground border-none"
                      title={t.addAgent}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  )}
                </div>

                <ScrollArea
                  className="min-h-0 flex-1"
                  contentClassName="space-y-2 p-3"
                >
                  {configurableAgentProfiles.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                      {t.createAgentPrompt}
                    </div>
                  )}

                  {configurableAgentProfiles.map(profile => (
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
                        {profile.enabledTools && visibleBuiltinTools.some(tool => profile.enabledTools.includes(tool.id)) && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15 flex items-center gap-0.5" title={profile.enabledTools.join(", ")}>
                            <Wrench className="w-2.5 h-2.5" />
                            {visibleBuiltinTools.filter(tool => profile.enabledTools.includes(tool.id)).length} {locale === "zh" ? "工具" : "Tools"}
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
                        {(() => {
                          const linkedFormCount = getLinkedFormsForAgent(profile, forms).length
                          if (linkedFormCount === 0) return null

                          return (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/15 flex items-center gap-0.5">
                              <TableProperties className="w-2.5 h-2.5" />
                              {linkedFormCount} {locale === "zh" ? "表单" : "Forms"}
                            </span>
                          )
                        })()}
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
                            : "opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto"
                        }`}
                        onClick={e => e.stopPropagation()}
                      >
                        {deleteConfirmId === profile.id ? (
                          <>
                            <Button variant="unstyled"
                              onClick={() => handleDeleteAgent(profile.id)}
                              className="p-1 rounded text-destructive hover:bg-destructive/10"
                              title={t.confirmDeleteTitle}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="unstyled"
                              onClick={() => setDeleteConfirmId(null)}
                              className="p-1 rounded text-muted-foreground hover:bg-muted"
                              title={t.cancelTitle}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="unstyled"
                              onClick={() => handleStartEditAgent(profile)}
                              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                              title={t.editTitle}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                              {!isScopedAgentConfig && (
                                <Button variant="unstyled"
                                  onClick={() => setDeleteConfirmId(profile.id)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  title={t.deleteTitle}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </ScrollArea>
              </div>

              {/* Right Role Form / Details */}
              <ScrollArea
                className="min-h-0 flex-1 bg-gradient-to-tr from-sidebar-accent/5 to-transparent"
                contentClassName="p-4 sm:p-6"
              >
                {isCreatingAgent || isEditingAgent ? (
                  <div className="max-w-none space-y-4">
                    <div className="flex flex-col gap-3 pb-2 border-b sm:flex-row sm:items-center sm:justify-between border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <Bot className="w-5 h-5 text-primary" />
                        {isCreatingAgent ? t.addAgent : t.editAgent}
                      </h2>
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

                    <div className="grid w-full gap-4 xl:grid-cols-2 xl:items-start">
                      <div className="min-w-0 space-y-4">
                    <div className="space-y-3 border border-border/50 rounded-xl p-4 bg-background/50">
                      <div className="space-y-1.5">
                        <Label>{locale === "zh" ? "角色模板" : "Role Template"}</Label>
                        <Select
                          value={agentForm.roleTemplateId || "custom"}
                          onValueChange={(value) => handleApplyRoleTemplate(value === "custom" ? "" : value)}
                        >
                          <SelectTrigger className="rounded-lg">
                            <SelectValue placeholder={locale === "zh" ? "选择角色模板" : "Select role template"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="custom">{locale === "zh" ? "自定义角色" : "Custom role"}</SelectItem>
                              {ROLE_TEMPLATES.map((template) => (
                                <SelectItem key={template.id} value={template.id}>
                                  {locale === "zh" ? template.nameZh : template.nameEn}
                                </SelectItem>
                              ))}
                            </SelectGroup>
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
                            <SelectTrigger className="w-full min-w-0 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {Object.entries(PERSONA_STYLE_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {locale === "zh" ? label.zh : label.en}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                          <Label>{locale === "zh" ? "客服边界" : "Support Boundary"}</Label>
                          <Select
                            value={agentForm.boundaryMode}
                            onValueChange={(value) => setAgentForm(prev => ({ ...prev, boundaryMode: value as BoundaryMode }))}
                          >
                            <SelectTrigger className="w-full min-w-0 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {Object.entries(BOUNDARY_MODE_LABELS).map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {locale === "zh" ? label.zh : label.en}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5 min-w-0">
                          <Label>{locale === "zh" ? "语音风格" : "Voice Style"}</Label>
                          <Select
                            value={agentForm.ttsVoice}
                            onValueChange={(value) => setAgentForm(prev => ({ ...prev, ttsVoice: value }))}
                          >
                            <SelectTrigger className="w-full min-w-0 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {TTS_VOICES.map((voice) => (
                                  <SelectItem key={voice.voice} value={voice.voice}>
                                    {voice.nameZh} · {voice.voice}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
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

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-name">{locale === "zh" ? "角色名称" : "Role Name"}</Label>
                        <Input
                          id="agent-name"
                          value={agentForm.name}
                          onChange={e => setAgentForm({ ...agentForm, name: e.target.value })}
                          placeholder={t.agentNamePlaceholder}
                          className="rounded-lg"
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
                            triggerClassName="w-full h-10 rounded-lg"
                            menuClassName="w-full max-w-none"
                          />
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="agent-model-temperature">
                          {locale === "zh" ? "Temperature" : "Temperature"}
                        </Label>
                        <Input
                          id="agent-model-temperature"
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={agentForm.modelTemperature}
                          onChange={e => setAgentForm({
                            ...agentForm,
                            modelTemperature: e.target.value,
                          })}
                          placeholder={locale === "zh" ? "默认" : "Default"}
                          className="rounded-lg"
                        />
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
                          className="rounded-lg"
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
                              <SelectTrigger className="rounded-lg">
                                <SelectValue placeholder={locale === "zh" ? "选择一个声纹" : "Select a voiceprint"} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {userVoiceprints.map((vp) => (
                                    <SelectItem key={vp.id} value={vp.id}>
                                      {vp.name}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
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
                        {visibleBuiltinTools.map(tool => {
                          const enabled = agentForm.enabledTools.includes(tool.id)
                          return (
                            <div key={tool.id} className="space-y-2 rounded-xl border border-border/50 bg-background/50 p-4">
                              <div
                                onClick={() => handleToggleTool(tool.id)}
                                className="flex cursor-pointer items-start gap-3 group"
                              >
                                <span
                                  className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors ${
                                    enabled ? "border-primary bg-primary" : "border-muted-foreground/40 group-hover:border-primary/50"
                                  }`}
                                >
                                  {enabled && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                                </span>
                                <div className="text-sm font-medium">{tool.label}</div>
                              </div>
                              {enabled && (
                                <div className="border-t border-border/40 pt-2 text-xs text-muted-foreground">
                                  {tool.description}
                                </div>
                              )}
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
                              <Button variant="unstyled"
                                type="button"
                                onClick={() => setAgentForm(prev => ({
                                  ...prev,
                                  wakeWords: prev.wakeWords.filter((_, i) => i !== idx)
                                }))}
                                className="hover:text-destructive transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </Button>
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
                          className="text-sm flex-1 rounded-lg"
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

                    {knowledgeBases.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-border/40">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkedSharedKnowledgeBases}</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {agentForm.knowledgeBaseIds.length}/{knowledgeBases.length}
                          </span>
                        </div>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={agentKbSearch}
                            onChange={e => setAgentKbSearch(e.target.value)}
                            placeholder={locale === "zh" ? "搜索知识库名称、描述、文件或 ID" : "Search knowledge bases by name, description, file, or ID"}
                            className="h-8 rounded-lg pl-8 text-xs"
                          />
                        </div>
                        <ScrollArea
                          className="max-h-64 rounded-xl border border-border/40 bg-background/50"
                          contentClassName="grid grid-cols-1 gap-2 p-1 sm:grid-cols-2"
                          viewportClassName="!h-auto max-h-64"
                        >
                          {filteredAgentKnowledgeBases.length > 0 ? filteredAgentKnowledgeBases.map((kb) => {
                            const linked = agentForm.knowledgeBaseIds.includes(kb.id)
                            return (
                              <div
                                key={kb.id}
                                className={linkedResourceItemClassName(linked)}
                                onClick={() => {
                                  const nextIds = linked
                                    ? agentForm.knowledgeBaseIds.filter(id => id !== kb.id)
                                    : [...agentForm.knowledgeBaseIds, kb.id]
                                  const enabledTools = nextIds.length > 0
                                    ? [...new Set([...agentForm.enabledTools, "rag_search" as BuiltinToolId])]
                                    : agentForm.enabledTools.filter(tool => tool !== "rag_search")
                                  setAgentForm({ ...agentForm, knowledgeBaseIds: nextIds, enabledTools })
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
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={(event) => handleOpenLinkedResourceEditor(event, { type: "knowledge", item: kb })}
                                  className={linkedResourceJumpButtonClassName}
                                  title={kb.isSystem
                                    ? (locale === "zh" ? "查看知识库配置" : "Open knowledge base configuration")
                                    : (locale === "zh" ? "编辑知识库配置" : "Edit knowledge base configuration")}
                                  aria-label={kb.isSystem
                                    ? (locale === "zh" ? `查看知识库配置：${kb.name}` : `Open knowledge base configuration: ${kb.name}`)
                                    : (locale === "zh" ? `编辑知识库配置：${kb.name}` : `Edit knowledge base configuration: ${kb.name}`)}
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )
                          }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的知识库" : "No matching knowledge bases found."}
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.linkCustomSkills}</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {agentForm.skillIds.length}/{skills.length}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartCreateAgentLinkedSkill()}
                            className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            title={locale === "zh" ? "新建并关联技能" : "Create and link skill"}
                            aria-label={locale === "zh" ? "新建并关联技能" : "Create and link skill"}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={agentSkillSearch}
                          onChange={e => setAgentSkillSearch(e.target.value)}
                          placeholder={locale === "zh" ? "搜索技能名称、描述或 ID" : "Search skills by name, description, or ID"}
                          className="h-8 rounded-lg pl-8 text-xs"
                        />
                      </div>
                      <ScrollArea
                        className="max-h-64 rounded-xl border border-border/40 bg-background/50"
                        contentClassName="space-y-2 p-1"
                        viewportClassName="!h-auto max-h-64"
                      >
                        {filteredAgentSkillCategoryGroups.length > 0 ? filteredAgentSkillCategoryGroups.map(group => {
                          const collapsed = collapsedAgentSkillCategories.has(group.key)
                          const categoryLinked = agentForm.skillCategoryIds.includes(group.key)
                          const linkedCount = categoryLinked
                            ? group.skills.length
                            : group.skills.filter(sk => agentForm.skillIds.includes(sk.id)).length
                          const createCategory = getCategoryValueForCreate(group.key, group.label, UNCATEGORIZED_SKILL_CATEGORY)
                          return (
                            <div key={group.key} className="space-y-1.5">
                              <div className="flex items-center gap-1 rounded-md text-xs font-semibold uppercase text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={() => {
                                    const nextCategoryIds = categoryLinked
                                      ? agentForm.skillCategoryIds.filter(id => id !== group.key)
                                      : [...agentForm.skillCategoryIds, group.key]
                                    const groupSkillIds = new Set(group.skills.map(skill => skill.id))
                                    setAgentForm({
                                      ...agentForm,
                                      skillCategoryIds: nextCategoryIds,
                                      skillIds: categoryLinked
                                        ? agentForm.skillIds
                                        : agentForm.skillIds.filter(id => !groupSkillIds.has(id)),
                                    })
                                  }}
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                                  title={locale === "zh" ? `关联整个${group.label}分类` : `Link entire ${group.label} category`}
                                  aria-label={locale === "zh" ? `关联整个${group.label}分类` : `Link entire ${group.label} category`}
                                  aria-pressed={categoryLinked}
                                >
                                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${
                                    categoryLinked ? "border-primary bg-primary" : "border-muted-foreground/35"
                                  }`}>
                                    {categoryLinked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                                  </span>
                                </Button>
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={() => toggleCollapsedAgentSkillCategory(group.key)}
                                  className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                                  aria-expanded={!collapsed}
                                >
                                  {collapsed ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />}
                                  <span className="truncate">{group.label}</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleStartCreateAgentLinkedSkill(createCategory)}
                                  className="h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  title={locale === "zh" ? `新建并关联${group.label}技能` : `Create and link ${group.label} skill`}
                                  aria-label={locale === "zh" ? `新建并关联${group.label}技能` : `Create and link ${group.label} skill`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </Button>
                                <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  {linkedCount}/{group.skills.length}
                                </span>
                              </div>
                              {!collapsed && (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {group.skills.map((sk) => {
                                    const linked = categoryLinked || agentForm.skillIds.includes(sk.id)
                                    return (
                                      <div
                                        key={sk.id}
                                        className={linkedResourceItemClassName(linked)}
                                        onClick={() => {
                                          if (categoryLinked) return
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
                                        <Button variant="unstyled"
                                          type="button"
                                          onClick={(event) => handleOpenLinkedResourceEditor(event, { type: "skill", item: sk })}
                                          className={linkedResourceJumpButtonClassName}
                                          title={locale === "zh" ? "编辑技能配置" : "Edit skill configuration"}
                                          aria-label={locale === "zh" ? `编辑技能配置：${sk.name}` : `Edit skill configuration: ${sk.name}`}
                                        >
                                          <ArrowUpRight className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        }) : (
                          <div className="py-6 text-center text-xs text-muted-foreground">
                            {locale === "zh" ? "未找到匹配的技能" : "No matching skills found."}
                          </div>
                        )}
                      </ScrollArea>
                    </div>
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
                            className="h-8 rounded-lg pl-8 text-xs"
                          />
                        </div>
                        <ScrollArea
                          className="max-h-64 rounded-xl border border-border/40 bg-background/50"
                          contentClassName="grid grid-cols-1 gap-2 p-1 sm:grid-cols-2"
                          viewportClassName="!h-auto max-h-64"
                        >
                          {filteredAgentMcpServers.length > 0 ? filteredAgentMcpServers.map((mcp) => {
                            const linked = agentForm.mcpIds.includes(mcp.id)
                            return (
                              <div
                                key={mcp.id}
                                className={linkedResourceItemClassName(linked)}
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
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={(event) => handleOpenLinkedResourceEditor(event, { type: "mcp", item: mcp })}
                                  className={linkedResourceJumpButtonClassName}
                                  title={locale === "zh" ? "编辑 MCP 配置" : "Edit MCP configuration"}
                                  aria-label={locale === "zh" ? `编辑 MCP 配置：${mcp.name}` : `Edit MCP configuration: ${mcp.name}`}
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )
                          }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的 MCP" : "No matching MCP servers found."}
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    )}

                    <div className="space-y-2 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between gap-3">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {locale === "zh" ? "关联表单数据" : "Link Forms"}
                        </Label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {agentForm.formIds.length}/{forms.length}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartCreateAgentLinkedForm()}
                            className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            title={locale === "zh" ? "新建并关联表单" : "Create and link form"}
                            aria-label={locale === "zh" ? "新建并关联表单" : "Create and link form"}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                        <ScrollArea
                          className="max-h-64 rounded-xl border border-border/40 bg-background/50"
                          contentClassName="space-y-2 p-1"
                          viewportClassName="!h-auto max-h-64"
                        >
                          {filteredAgentFormCategoryGroups.length > 0 ? filteredAgentFormCategoryGroups.map(group => {
                            const collapsed = collapsedAgentFormCategories.has(group.key)
                            const categoryLinked = agentForm.formCategoryIds.includes(group.key)
                            const linkedCount = categoryLinked
                              ? group.forms.length
                              : group.forms.filter(form => agentForm.formIds.includes(form.id)).length
                            const createCategory = getCategoryValueForCreate(group.key, group.label, UNCATEGORIZED_FORM_CATEGORY)
                            return (
                              <div key={group.key} className="space-y-1.5">
                                <div className="flex items-center gap-1 rounded-md text-xs font-semibold uppercase text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                                  <Button variant="unstyled"
                                    type="button"
                                    onClick={() => {
                                      const nextCategoryIds = categoryLinked
                                        ? agentForm.formCategoryIds.filter(id => id !== group.key)
                                        : [...agentForm.formCategoryIds, group.key]
                                      const groupFormIds = new Set(group.forms.map(form => form.id))
                                      const nextFormIds = categoryLinked
                                        ? agentForm.formIds
                                        : agentForm.formIds.filter(id => !groupFormIds.has(id))
                                      const nextPermissions = { ...agentForm.formPermissions }
                                      if (!categoryLinked) {
                                        for (const formId of groupFormIds) {
                                          delete nextPermissions[formId]
                                        }
                                      }
                                      const hasReadableForms = nextCategoryIds.length > 0 || Object.values(nextPermissions).some(permissions => permissions.includes("read"))
                                      const hasManageableForms = Object.values(nextPermissions).some(permissions => permissions.some(permission => permission !== "read"))
                                      const enabledTools = [
                                        ...agentForm.enabledTools.filter(tool => tool !== "query_form_data" && tool !== "manage_form_data"),
                                        ...(hasReadableForms ? ["query_form_data" as BuiltinToolId] : []),
                                        ...(hasManageableForms ? ["manage_form_data" as BuiltinToolId] : []),
                                      ]
                                      setAgentForm({
                                        ...agentForm,
                                        formCategoryIds: nextCategoryIds,
                                        formIds: nextFormIds,
                                        formPermissions: nextPermissions,
                                        enabledTools,
                                      })
                                    }}
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                                    title={locale === "zh" ? `关联整个${group.label}分类` : `Link entire ${group.label} category`}
                                    aria-label={locale === "zh" ? `关联整个${group.label}分类` : `Link entire ${group.label} category`}
                                    aria-pressed={categoryLinked}
                                  >
                                    <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${
                                      categoryLinked ? "border-primary bg-primary" : "border-muted-foreground/35"
                                    }`}>
                                      {categoryLinked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                                    </span>
                                  </Button>
                                  <Button variant="unstyled"
                                    type="button"
                                    onClick={() => toggleCollapsedAgentFormCategory(group.key)}
                                    className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left"
                                    aria-expanded={!collapsed}
                                  >
                                    {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                                    <span className="truncate">{group.label}</span>
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleStartCreateAgentLinkedForm(createCategory)}
                                    className="h-6 w-6 shrink-0 rounded-md p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                    title={locale === "zh" ? `新建并关联${group.label}表单` : `Create and link ${group.label} form`}
                                    aria-label={locale === "zh" ? `新建并关联${group.label}表单` : `Create and link ${group.label} form`}
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </Button>
                                  <span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                    {linkedCount}/{group.forms.length}
                                  </span>
                                </div>
                                {!collapsed && (
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {group.forms.map((form) => {
                                      const explicitLinked = agentForm.formIds.includes(form.id)
                                      const linked = categoryLinked || explicitLinked
                                      return (
                                        <div
                                          key={form.id}
                                          className={linkedResourceItemClassName(linked)}
                                          onClick={() => {
                                            if (categoryLinked) return
                                            const nextIds = linked
                                              ? agentForm.formIds.filter(id => id !== form.id)
                                              : [...agentForm.formIds, form.id]
                                            const nextPermissions = { ...agentForm.formPermissions }
                                            if (linked) {
                                              delete nextPermissions[form.id]
                                            } else {
                                              nextPermissions[form.id] = ["read"]
                                            }
                                            const enabledTools = nextIds.length > 0
                                              ? [...new Set([...agentForm.enabledTools, "query_form_data" as BuiltinToolId])]
                                              : agentForm.enabledTools.filter(tool => tool !== "query_form_data" && tool !== "manage_form_data")
                                            setAgentForm({
                                              ...agentForm,
                                              formIds: nextIds,
                                              formPermissions: nextPermissions,
                                              enabledTools,
                                            })
                                          }}
                                        >
                                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                                            linked ? "bg-primary border-primary" : "border-muted-foreground/35"
                                          }`}>
                                            {linked && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium truncate">{form.name}</div>
                                            <div className="text-[10px] text-muted-foreground truncate">{form.fields.length + SYSTEM_FORM_FIELDS.length} {locale === "zh" ? "字段" : "fields"} · {form.recordCount} {locale === "zh" ? "记录" : "records"}</div>
                                            {explicitLinked && (
                                              <div className="mt-2 flex flex-wrap gap-1">
                                                {([
                                                  ["create", locale === "zh" ? "增" : "Create"],
                                                  ["read", locale === "zh" ? "查" : "Read"],
                                                  ["update", locale === "zh" ? "改" : "Update"],
                                                  ["delete", locale === "zh" ? "删" : "Delete"],
                                                ] as Array<[FormRecordPermission, string]>).map(([permission, label]) => {
                                                  const selected = (agentForm.formPermissions[form.id] || ["read"]).includes(permission)
                                                  return (
                                                    <Button variant="unstyled"
                                                      key={permission}
                                                      type="button"
                                                      onClick={(event) => {
                                                        event.stopPropagation()
                                                        const current = agentForm.formPermissions[form.id] || ["read"]
                                                        if (selected && current.length === 1) return
                                                        const next = selected
                                                          ? current.filter(item => item !== permission)
                                                          : [...current, permission]
                                                        setAgentForm({
                                                          ...agentForm,
                                                          formPermissions: {
                                                            ...agentForm.formPermissions,
                                                            [form.id]: next,
                                                          },
                                                        })
                                                      }}
                                                      className={cn(
                                                        "rounded-md px-2 py-1 text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20",
                                                        selected
                                                          ? "bg-primary-soft text-primary"
                                                          : "bg-muted text-muted-foreground hover:text-foreground",
                                                      )}
                                                      aria-pressed={selected}
                                                    >
                                                      {label}
                                                    </Button>
                                                  )
                                                })}
                                              </div>
                                            )}
                                          </div>
                                          <Button variant="unstyled"
                                            type="button"
                                            onClick={(event) => handleOpenLinkedResourceEditor(event, { type: "form", item: form })}
                                            className={linkedResourceJumpButtonClassName}
                                            title={locale === "zh" ? "编辑表单配置" : "Edit form configuration"}
                                            aria-label={locale === "zh" ? `编辑表单配置：${form.name}` : `Edit form configuration: ${form.name}`}
                                          >
                                            <ArrowUpRight className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          }) : (
                            <div className="py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "暂无表单，可新建并关联。" : "No forms yet. Create and link one."}
                            </div>
                          )}
                        </ScrollArea>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border/40">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {locale === "zh" ? "自定义宏工具" : "Custom Macro Tools"}
                          </Label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {locale === "zh"
                              ? "把一组预定义表单操作暴露成 agent 可调用的 toolcall。参数可在步骤中用 {{name}} 引用。"
                              : "Expose predefined form operations as agent-callable tools. Use {{name}} in steps to reference arguments."}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddCustomFunction}
                          className="h-8 rounded-lg"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {locale === "zh" ? "新增宏" : "Add"}
                        </Button>
                      </div>

                      {agentForm.customFunctions.length > 0 && (
                        <div className="space-y-3">
                          {agentForm.customFunctions.map((customFunction) => (
                            <div key={customFunction.id} className="rounded-xl border border-border/50 bg-background/50 p-3">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-foreground">
                                    {customFunction.name || customFunction.id}
                                  </div>
                                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                    macro_{customFunction.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "macro"}_{customFunction.id.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 12)}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant={customFunction.enabled ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => handleUpdateCustomFunction(customFunction.id, { enabled: !customFunction.enabled })}
                                    className="h-7 rounded-md px-2 text-xs"
                                  >
                                    {customFunction.enabled ? (locale === "zh" ? "启用" : "Enabled") : (locale === "zh" ? "停用" : "Disabled")}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveCustomFunction(customFunction.id)}
                                    className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label className="text-xs">{locale === "zh" ? "名称" : "Name"}</Label>
                                  <Input
                                    value={customFunction.name}
                                    onChange={event => handleUpdateCustomFunction(customFunction.id, { name: event.target.value })}
                                    className="h-8 rounded-lg text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">ID</Label>
                                  <Input
                                    value={customFunction.id}
                                    readOnly
                                    className="h-8 rounded-lg bg-muted/40 text-xs"
                                  />
                                </div>
                              </div>

                              <div className="mt-3 space-y-1.5">
                                <Label className="text-xs">{locale === "zh" ? "描述" : "Description"}</Label>
                                <Textarea
                                  value={customFunction.description}
                                  onChange={event => handleUpdateCustomFunction(customFunction.id, { description: event.target.value })}
                                  className="min-h-16 rounded-lg text-xs"
                                />
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <div className="space-y-1.5">
                                  <Label className="text-xs">
                                    {locale === "zh" ? "参数 JSON" : "Arguments JSON"}
                                  </Label>
                                  <Textarea
                                    defaultValue={JSON.stringify(customFunction.parameters || [], null, 2)}
                                    onBlur={event => {
                                      try {
                                        const parsed = JSON.parse(event.target.value)
                                        if (Array.isArray(parsed)) {
                                          handleUpdateCustomFunction(customFunction.id, { parameters: parsed })
                                        }
                                      } catch {
                                        return
                                      }
                                    }}
                                    placeholder='[{"name":"customerName","description":"Customer name","type":"string","required":true}]'
                                    className="min-h-32 rounded-lg font-mono text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-xs">
                                    {locale === "zh" ? "步骤 JSON" : "Steps JSON"}
                                  </Label>
                                  <Textarea
                                    defaultValue={JSON.stringify(customFunction.steps || [], null, 2)}
                                    onBlur={event => {
                                      try {
                                        const parsed = JSON.parse(event.target.value)
                                        if (Array.isArray(parsed)) {
                                          handleUpdateCustomFunction(customFunction.id, { steps: parsed })
                                        }
                                      } catch {
                                        return
                                      }
                                    }}
                                    placeholder='[{"action":"create","formId":"form-id","data":{"customer":"{{customerName}}"}}]'
                                    className="min-h-32 rounded-lg font-mono text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

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
                            className="h-8 rounded-lg pl-8 text-xs"
                          />
                        </div>
                        <ScrollArea
                          className="max-h-64 rounded-xl border border-border/40 bg-background/50"
                          contentClassName="grid grid-cols-1 gap-2 p-1 sm:grid-cols-2"
                          viewportClassName="!h-auto max-h-64"
                        >
                          {filteredLinkableAgentProfiles.length > 0 ? filteredLinkableAgentProfiles.map((agent) => {
                              const linked = agentForm.agentIds?.includes(agent.id)
                              return (
                                <div
                                  key={agent.id}
                                  className={linkedResourceItemClassName(Boolean(linked))}
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
                                  <Button variant="unstyled"
                                    type="button"
                                    onClick={(event) => handleOpenLinkedResourceEditor(event, { type: "agent", item: agent })}
                                    className={linkedResourceJumpButtonClassName}
                                    title={locale === "zh" ? "编辑角色配置" : "Edit role configuration"}
                                    aria-label={locale === "zh" ? `编辑角色配置：${agent.name}` : `Edit role configuration: ${agent.name}`}
                                  >
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              )
                            }) : (
                            <div className="col-span-full py-6 text-center text-xs text-muted-foreground">
                              {locale === "zh" ? "未找到匹配的角色" : "No matching roles found."}
                            </div>
                          )}
                        </ScrollArea>
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
                  <div className="w-full space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Bot className="w-6 h-6 text-primary" />
                          {selectedAgent.name}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedAgent.description || t.noDescriptionProvided}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 grid w-full gap-4 xl:grid-cols-2 xl:items-start">
                      <div className="min-w-0 space-y-6">
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
                                ? "生成 /agentapp/ 分享链接，其他账号打开后可直接导入该角色。"
                                : "Create an /agentapp/ share link so another account can import this agent."}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleSaveAgentShare(selectedAgent.id)}
                              disabled={sharingAgentId === selectedAgent.id}
                              className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              {sharingAgentId === selectedAgent.id
                                ? (locale === "zh" ? "保存中" : "Saving")
                                : editingShareToken
                                  ? (locale === "zh" ? "保存分享" : "Save Share")
                                  : (locale === "zh" ? "新建分享" : "New Share")}
                            </Button>
                            {editingShareToken && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={resetShareForm}
                                className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {locale === "zh" ? "新建" : "New"}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setConfigBundleInitialSelection({
                                  agents: [selectedAgent.id],
                                  skills: [],
                                  knowledgeBases: [],
                                  mcpServers: [],
                                  forms: [],
                                })
                                setConfigBundleMode("export")
                              }}
                              className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {locale === "zh" ? "导出" : "Export"}
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "分享地址" : "Share Addresses"}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {agentShareLinksLoading
                                ? (locale === "zh" ? "加载中" : "Loading")
                                : `${agentShareLinks.length}`}
                            </div>
                          </div>
                          {agentShareLinks.length > 0 ? (
                            <div className="flex flex-col gap-2">
                              {agentShareLinks.map((share) => {
                                const isEditing = editingShareToken === share.token
                                return (
                                  <div key={share.token} className={cn(
                                    "grid gap-2 rounded-md border border-border/60 bg-background px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto]",
                                    isEditing && "border-primary",
                                  )}>
                                    <button
                                      type="button"
                                      onClick={() => startEditShare(share)}
                                      className="min-w-0 text-left"
                                    >
                                      <div className="truncate font-mono text-[11px] text-foreground">
                                        {share.customSlug || share.token}
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <span>{formatDateTime(share.updatedAt)}</span>
                                        {share.priceCents > 0 && <span>¥{(share.priceCents / 100).toFixed(2)}</span>}
                                        {share.trialDurationMinutes > 0 && (
                                          <span>
                                            {locale === "zh"
                                              ? `试用 ${share.trialDurationMinutes} 分钟`
                                              : `${share.trialDurationMinutes} min trial`}
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCopyAgentShareLink(share)}
                                        className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                        {locale === "zh" ? "复制" : "Copy"}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => startEditShare(share)}
                                        className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        {locale === "zh" ? "编辑" : "Edit"}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleDeleteAgentShare(share)}
                                        disabled={deletingShareToken === share.token}
                                        className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        {deletingShareToken === share.token
                                          ? (locale === "zh" ? "删除中" : "Deleting")
                                          : (locale === "zh" ? "删除" : "Delete")}
                                      </Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-muted-foreground">
                              {locale === "zh" ? "还没有分享地址。填写下方配置后可以为同一个智能体创建多个分享链接。" : "No share addresses yet. Use the form below to create multiple share links for this agent."}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor="agent-share-slug" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "自定义地址" : "Custom address"}
                            </Label>
                            <Input
                              id="agent-share-slug"
                              value={shareSlug}
                              onChange={(event) => setShareSlug(event.target.value)}
                              placeholder={locale === "zh" ? "例如 sales-helper" : "sales-helper"}
                              className="h-9"
                            />
                            <div className="text-[11px] text-muted-foreground">
                              {locale === "zh"
                                ? `实际地址会默认加账号前缀：${shareSlugPrefix}-sales-helper`
                                : `The final address is prefixed by your account: ${shareSlugPrefix}-sales-helper`}
                            </div>
                          </div>
                          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor="agent-share-price" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "价格（元）" : "Price (CNY)"}
                            </Label>
                            <Input
                              id="agent-share-price"
                              value={sharePrice}
                              onChange={(event) => setSharePrice(event.target.value)}
                              placeholder="0"
                              inputMode="decimal"
                              className="h-9"
                            />
                          </div>
                          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor="agent-share-trial" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "试用时间（分钟）" : "Trial (minutes)"}
                            </Label>
                            <Input
                              id="agent-share-trial"
                              value={shareTrialMinutes}
                              onChange={(event) => setShareTrialMinutes(event.target.value)}
                              placeholder="0"
                              inputMode="numeric"
                              className="h-9"
                            />
                            <div className="text-[11px] text-muted-foreground">
                              {locale === "zh"
                                ? "仅对付费分享生效；0 表示不开放试用。"
                                : "Only applies to paid shares; 0 disables trials."}
                            </div>
                          </div>
                          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-4">
                            <Label htmlFor="agent-share-introduction" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              {locale === "zh" ? "分享页介绍" : "Share page intro"}
                            </Label>
                            <Textarea
                              id="agent-share-introduction"
                              value={shareIntroduction}
                              onChange={(event) => setShareIntroduction(event.target.value)}
                              placeholder={locale === "zh"
                                ? "介绍这个 Agent 的适用场景、能力边界和使用前需要知道的信息。"
                                : "Describe this agent's use case, capabilities, and expectations."}
                              rows={4}
                              maxLength={1600}
                            />
                          </div>
                          <div className="col-span-2 flex flex-col gap-2 sm:col-span-4">
                            <div className="flex items-center justify-between gap-3">
                              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                {locale === "zh" ? "分享页常见问题" : "Share page FAQ"}
                              </Label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addShareFaqItem}
                                disabled={shareFaqItems.length >= 12}
                                className="h-8 gap-1.5 rounded-lg border-border bg-background px-2.5"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {locale === "zh" ? "添加" : "Add"}
                              </Button>
                            </div>
                            <div className="flex flex-col gap-2">
                              {shareFaqItems.map((item, index) => (
                                <div key={index} className="grid gap-2 rounded-lg border border-border/50 bg-background/50 p-3 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto]">
                                  <Input
                                    value={item.question}
                                    onChange={(event) => updateShareFaqItem(index, "question", event.target.value)}
                                    placeholder={locale === "zh" ? "问题" : "Question"}
                                    maxLength={160}
                                    className="h-9"
                                  />
                                  <Input
                                    value={item.answer}
                                    onChange={(event) => updateShareFaqItem(index, "answer", event.target.value)}
                                    placeholder={locale === "zh" ? "答案" : "Answer"}
                                    maxLength={800}
                                    className="h-9"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => removeShareFaqItem(index)}
                                    className="h-9 gap-1.5 rounded-lg border-border bg-background px-2.5"
                                    title={locale === "zh" ? "删除 FAQ" : "Remove FAQ"}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    <span className="sr-only">{locale === "zh" ? "删除" : "Remove"}</span>
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                          {([
                            ["knowledgeBases", locale === "zh" ? "知识库" : "KBs"],
                            ["skills", locale === "zh" ? "Skills" : "Skills"],
                            ["mcpServers", "MCP"],
                            ["agents", locale === "zh" ? "多角色" : "Roles"],
                            ["forms", locale === "zh" ? "表单" : "Forms"],
                          ] as [keyof AgentShareOptions, string][]).map(([key, label]) => (
                            <Button variant="unstyled"
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
                            </Button>
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

                        <ScrollArea
                          className="h-64"
                          contentClassName="space-y-2 pr-3"
                        >
                          {agentVersions.length === 0 && !agentVersionsLoading ? (
                            <div className="flex h-64 items-center justify-center px-4 text-center">
                              <p className="text-xs text-muted-foreground">
                                {locale === "zh"
                                  ? "暂无历史版本。保存角色配置后会自动记录版本。"
                                  : "No saved versions yet. Versions are recorded when this role is saved."}
                              </p>
                            </div>
                          ) : (
                            agentVersions.map((version, index) => {
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
                            })
                          )}
                        </ScrollArea>
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          {t.enabledToolsTitle}
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {visibleBuiltinTools.map(tool => {
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

                        {/* Linked Forms */}
                        {selectedAgentLinkedForms.length > 0 && (
                          <div className="space-y-2">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <TableProperties className="w-3.5 h-3.5 text-amber-500" />
                              {locale === "zh" ? "已关联的表单数据" : "Linked Forms"}
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {selectedAgentLinkedForms.map(form => {
                                const explicitLinked = selectedAgent.formIds?.includes(form.id)
                                const categoryLinked = selectedAgent.formCategoryIds?.includes(getFormCategoryKey(form))
                                const permissions = selectedAgent.formPermissions?.[form.id] || (explicitLinked ? ["read"] : [])
                                const permissionText = permissions.length > 0
                                  ? permissions.map(permission => {
                                    if (locale !== "zh") return permission
                                    if (permission === "create") return "新增"
                                    if (permission === "read") return "查询"
                                    if (permission === "update") return "修改"
                                    return "删除"
                                  }).join(" / ")
                                  : (locale === "zh" ? "分类关联" : "Category linked")

                                return (
                                  <div key={form.id} className="p-2.5 border border-amber-500/20 bg-amber-500/5 rounded-xl flex items-center gap-2.5">
                                    <TableProperties className="w-4 h-4 text-amber-500 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate">{form.name}</div>
                                      <div className="text-[10px] text-muted-foreground truncate">
                                        {form.fields.length + SYSTEM_FORM_FIELDS.length} {locale === "zh" ? "字段" : "fields"} · {form.recordCount} {locale === "zh" ? "记录" : "records"} · {permissionText}
                                      </div>
                                      {categoryLinked && !explicitLinked && (
                                        <div className="text-[10px] text-muted-foreground truncate">
                                          {locale === "zh" ? `来自分类：${form.category || "未分类"}` : `From category: ${form.category || "Uncategorized"}`}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
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
                              {configurableAgentProfiles
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

                      <aside className="min-w-0 overflow-hidden rounded-xl border border-border/40 bg-background/50 xl:sticky xl:top-0">
                        <div className="border-b border-border/30 bg-muted/20 px-4 py-2">
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {t.systemInstructions}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-muted-foreground">
                          {selectedAgent.systemPrompt}
                        </div>
                      </aside>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-center">
                    <div>
                      <Bot className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">{t.selectAgentToViewOrCreate}</p>
                      {!isScopedAgentConfig && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleStartCreateAgent}
                          className="mt-3 gap-1.5 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-lg"
                        >
                          <Plus className="w-4 h-4 text-primary" />
                          {t.addAgent}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>
          )}

          {/* ========================================== */}
          {/* KNOWLEDGE BASE TAB PANEL                   */}
          {/* ========================================== */}
          {activeTab === "knowledge" && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
              {/* Left KB List */}
              <div className="flex max-h-[42dvh] min-h-0 w-full flex-shrink-0 flex-col border-b border-border/40 bg-background/30 md:max-h-none md:w-[300px] md:border-b-0 md:border-r">
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

                <ScrollArea
                  className="min-h-0 flex-1"
                  contentClassName="space-y-2 p-3"
                >
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
                                : "opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto"
                            }`}
                            onClick={e => e.stopPropagation()}
                          >
                            {deleteConfirmId === kb.id ? (
                              <>
                                <Button variant="unstyled"
                                  onClick={() => handleDeleteKB(kb.id)}
                                  className="p-1 rounded text-destructive hover:bg-destructive/10"
                                  title={t.confirmDeleteTitle}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="unstyled"
                                  onClick={() => setDeleteConfirmId(null)}
                                  className="p-1 rounded text-muted-foreground hover:bg-muted"
                                  title={t.cancelTitle}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="unstyled"
                                  onClick={() => handleStartEditKB(kb)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80"
                                  title={t.editTitle}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="unstyled"
                                  onClick={() => setDeleteConfirmId(kb.id)}
                                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  title={t.deleteTitle}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </ScrollArea>
              </div>

              {/* Right KB Edit Form / Details */}
              <ScrollArea
                className="min-h-0 flex-1 bg-gradient-to-tr from-sidebar-accent/5 to-transparent"
                contentClassName="p-4 sm:p-6"
              >
                {isCreatingKB || isEditingKB ? (
                  <div className="max-w-2xl space-y-4">
                    <div className="flex flex-col gap-3 pb-2 border-b sm:flex-row sm:items-center sm:justify-between border-border/40">
                      <h2 className="text-lg font-semibold tracking-wide font-display text-primary flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-primary" />
                        {isCreatingKB ? t.addKnowledge : t.editKnowledge}
                      </h2>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="kb-name">{t.kbName}</Label>
                        <Input
                          id="kb-name"
                          value={kbForm.name}
                          onChange={e => setKbForm({ ...kbForm, name: e.target.value })}
                          placeholder={t.kbNamePlaceholder}
                          className="rounded-lg"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="kb-desc">{t.kbDesc}</Label>
                        <Input
                          id="kb-desc"
                          value={kbForm.description}
                          onChange={e => setKbForm({ ...kbForm, description: e.target.value })}
                          placeholder={t.kbDescPlaceholder}
                          className="rounded-lg"
                        />
                      </div>
                    </div>


                  </div>
                ) : selectedKB ? (
                  <div className="max-w-3xl space-y-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-xl font-bold font-display flex items-center gap-2">
                          <Database className="w-6 h-6 text-primary" />
                          {selectedKB.name}
                        </h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedKB.description || t.noDescriptionProvided}
                        </p>
                      </div>
                    </div>
                    {selectedKB.importStatus && selectedKB.importStatus !== "ready" && (
                      <div className={`rounded-xl border p-3 text-sm ${
                        selectedKB.importStatus === "failed"
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-primary/20 bg-primary/5 text-foreground"
                      }`}>
                        <div className="flex items-center gap-2 font-medium">
                          {selectedKB.importStatus === "importing" && (
                            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                          )}
                          {selectedKB.importStatus === "importing"
                            ? locale === "zh" ? "正在重新建立知识库索引" : "Reindexing knowledge base"
                            : selectedKB.importStatus === "needs_upload"
                              ? locale === "zh" ? "需要重新上传原始文档" : "Source documents must be uploaded again"
                              : locale === "zh" ? "知识库索引失败" : "Knowledge base indexing failed"}
                        </div>
                        {selectedKB.importError && (
                          <p className="mt-1 text-xs opacity-80">{selectedKB.importError}</p>
                        )}
                      </div>
                    )}

                    {/* KB File Management */}
                    <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                          <Input
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
                                  <Button variant="unstyled"
                                    onClick={() => handleDeleteKBFile(file.name)}
                                    className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                    title={t.deleteDocumentTitle}
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
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
              </ScrollArea>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
