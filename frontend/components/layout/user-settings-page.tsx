"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import {
  User,
  Mail,
  Shield,
  Loader2,
  AlertCircle,
  Settings2,
  ArrowLeft,
  MessagesSquare,
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  Accessibility,
  Mic,
  Square,
  Upload,
  Waves,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NavActionButton } from "@/components/ui/nav-action-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AppHeader, AppShell } from "@/components/ui/app-shell"
import { NavItem } from "@/components/ui/nav-item"
import { PageSection, PageSectionTitle } from "@/components/ui/page-section"
import { StatusNotice } from "@/components/ui/status-notice"
import { ActionButton } from "@/components/ui/action-button"
import { EmptyState } from "@/components/ui/empty-state"
import { InputField } from "@/components/ui/input-field"
import { ListItem } from "@/components/ui/list-item"
import { SettingsSwitch } from "@/components/ui/settings-switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"
import {
  useVoiceprintRecorder,
  SPEAKER_AUDIO_ACCEPT,
} from "@/lib/hooks/use-voiceprint-recorder"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserVoiceprint {
  id: string
  name: string
  sampleText: string | null
  enrolledAt: string | null
  createdAt: string
}

interface UserSettingsPageProps {
  onBackToChat: () => void
  elderOptimized: boolean
  onElderOptimizedChange: (enabled: boolean) => void
  voiceprints: UserVoiceprint[]
  onVoiceprintsChange: (vps: UserVoiceprint[]) => void
  onClearAllConversations: () => Promise<number>
  conversationCount: number
}

interface UserApiKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

// ---------------------------------------------------------------------------
// Sample text for voiceprint enrollment
// ---------------------------------------------------------------------------

const SPEAKER_SAMPLE_TEXT = {
  zh: "请用自然语速朗读：我是本智能体的授权使用者，正在完成声纹绑定。",
  en: "Please read naturally: I am the authorized user of this agent and I am completing voiceprint binding.",
}

// ---------------------------------------------------------------------------
// Section config for left nav
// ---------------------------------------------------------------------------

interface NavSection {
  id: string
  icon: React.ComponentType<{ className?: string }>
  labelZh: string
  labelEn: string
}

const NAV_SECTIONS: NavSection[] = [
  { id: "section-display", icon: Accessibility, labelZh: "优化显示", labelEn: "Display" },
  { id: "section-profile", icon: User, labelZh: "基本信息", labelEn: "Profile" },
  { id: "section-prefs", icon: Settings2, labelZh: "通用偏好", labelEn: "Preferences" },
  { id: "section-safety", icon: Shield, labelZh: "安全选项", labelEn: "Safety" },
  { id: "section-voiceprint", icon: Waves, labelZh: "声纹管理", labelEn: "Voiceprints" },
  { id: "section-apikeys", icon: KeyRound, labelZh: "API Key", labelEn: "API Keys" },
  { id: "section-danger", icon: Trash2, labelZh: "危险操作", labelEn: "Danger Zone" },
]

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function UserSettingsPage({
  onBackToChat,
  elderOptimized,
  onElderOptimizedChange,
  voiceprints,
  onVoiceprintsChange,
  onClearAllConversations,
  conversationCount,
}: UserSettingsPageProps) {
  const { user, updateProfile } = useAuth()
  const { locale } = useI18n()
  const zh = locale === "zh"

  // ---- Form state ----
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [preferences, setPreferences] = useState("")
  const [safetyEnabled, setSafetyEnabled] = useState(false)
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(false)

  // ---- Auto-save state ----
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const lastSavedRef = useRef<{ email: string; preferences: string; safetyEnabled: boolean } | null>(null)

  // ---- API keys state ----
  const [apiKeys, setApiKeys] = useState<UserApiKey[]>([])
  const [apiKeyName, setApiKeyName] = useState("Default SDK key")
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // ---- Dangerous actions state ----
  const [clearConversationsOpen, setClearConversationsOpen] = useState(false)
  const [clearConversationsConfirmText, setClearConversationsConfirmText] = useState("")
  const [clearConversationsLoading, setClearConversationsLoading] = useState(false)
  const [clearConversationsStatus, setClearConversationsStatus] = useState<string | null>(null)

  // ---- Voiceprint state ----
  const [newVoiceprintName, setNewVoiceprintName] = useState("")
  const [voiceprintStatus, setVoiceprintStatus] = useState<string | null>(null)
  const voiceprintNameInputRef = useRef<HTMLInputElement>(null)
  const pendingVoiceprintNameRef = useRef("")

  // ---- Active section tracking ----
  const [activeSection, setActiveSection] = useState("section-display")
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  // ---- Sync form state when user changes ----
  useEffect(() => {
    if (user) {
      setUsername(user.username || "")
      setEmail(user.email || "")
      setPreferences(user.preferences || "")
      setSafetyEnabled(user.safetyEnabled || false)
      setError(null)
      setSaved(false)
      lastSavedRef.current = {
        email: user.email || "",
        preferences: user.preferences || "",
        safetyEnabled: user.safetyEnabled || false,
      }
    }
  }, [user])

  // ---- Load API keys ----
  useEffect(() => {
    if (!user) return
    const loadApiKeys = async () => {
      setApiKeysLoading(true)
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/api-keys`, {
          headers: { Authorization: `Bearer ${user.id}` },
        })
        if (resp.ok) {
          setApiKeys(await resp.json())
        }
      } catch (err) {
        console.error("[UserSettingsPage] Failed to load API keys:", err)
      } finally {
        setApiKeysLoading(false)
      }
    }
    loadApiKeys()
  }, [user])

  // ---- Auto-hide success message ----
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [saved])

  // ---- Auto-save (debounced) ----
  useEffect(() => {
    if (!user) return
    const last = lastSavedRef.current
    if (
      last &&
      last.email === (email.trim() || "") &&
      last.preferences === (preferences.trim() || "") &&
      last.safetyEnabled === safetyEnabled
    ) {
      return // no change
    }

    const timer = setTimeout(async () => {
      setError(null)
      setSaving(true)
      try {
        const payload = {
          email: email.trim() || null,
          preferences: preferences.trim() || null,
          safetyEnabled,
        }
        await updateProfile(payload)
        lastSavedRef.current = {
          email: email.trim() || "",
          preferences: preferences.trim() || "",
          safetyEnabled,
        }
        setSaved(true)
      } catch (err: any) {
        console.error("[UserSettingsPage] Auto-save failed:", err)
        setError(err.message || (zh ? "保存失败，请重试" : "Save failed, please try again"))
      } finally {
        setSaving(false)
      }
    }, 600)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, preferences, safetyEnabled, user])

  const registerSectionRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el)
    } else {
      sectionRefs.current.delete(id)
    }
  }, [])

  const updateActiveSectionFromScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const maxScrollTop = container.scrollHeight - container.clientHeight
    if (container.scrollTop <= 2) {
      setActiveSection(NAV_SECTIONS[0].id)
      return
    }
    if (maxScrollTop - container.scrollTop <= 2) {
      setActiveSection(NAV_SECTIONS[NAV_SECTIONS.length - 1].id)
      return
    }

    const containerTop = container.getBoundingClientRect().top
    const activationY = containerTop + Math.min(container.clientHeight * 0.28, 180)
    let nextActive = NAV_SECTIONS[0].id

    for (const section of NAV_SECTIONS) {
      const el = sectionRefs.current.get(section.id)
      if (!el) continue
      if (el.getBoundingClientRect().top <= activationY) {
        nextActive = section.id
      } else {
        break
      }
    }

    setActiveSection(nextActive)
  }, [])

  useEffect(() => {
    updateActiveSectionFromScroll()
  }, [updateActiveSectionFromScroll])

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id)
    const el = sectionRefs.current.get(id) || document.getElementById(id)
    const container = scrollContainerRef.current
    if (!el || !container) return

    const containerTop = container.getBoundingClientRect().top
    const sectionTop = el.getBoundingClientRect().top
    container.scrollTo({
      top: container.scrollTop + sectionTop - containerTop,
      behavior: "smooth",
    })
  }, [])

  // ---- Voiceprint recorder hook ----
  const sampleText = SPEAKER_SAMPLE_TEXT[locale as "zh" | "en"]

  const handleVoiceprintEnrollment = useCallback(
    async (audioDataUri: string) => {
      if (!user) return
      const voiceprintName = pendingVoiceprintNameRef.current || newVoiceprintName.trim()
      if (!voiceprintName) {
        setVoiceprintStatus(zh ? "请先填写声纹名称，再录制或上传音频。" : "Please enter a voiceprint name before recording or uploading audio.")
        voiceprintNameInputRef.current?.focus()
        throw new Error(zh ? "缺少声纹名称" : "Missing voiceprint name")
      }
      setVoiceprintStatus(zh ? "正在生成声纹..." : "Creating voiceprint...")
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/user-voiceprints`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.id}`,
          },
          body: JSON.stringify({
            name: voiceprintName,
            audio: audioDataUri,
            sampleText,
          }),
        })
        if (!resp.ok) {
          const text = await resp.text().catch(() => "")
          throw new Error(text || `HTTP ${resp.status}`)
        }
        const created = await resp.json()
        onVoiceprintsChange([created, ...voiceprints])
        pendingVoiceprintNameRef.current = ""
        setNewVoiceprintName("")
        setVoiceprintStatus(zh ? "声纹已保存！" : "Voiceprint saved!")
        setTimeout(() => setVoiceprintStatus(null), 2500)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setVoiceprintStatus(`${zh ? "声纹保存失败" : "Voiceprint save failed"}: ${message}`)
      }
    },
    [user, zh, newVoiceprintName, sampleText, voiceprints, onVoiceprintsChange],
  )

  const {
    isRecording,
    isProcessing: isVoiceprintProcessing,
    status: recorderStatus,
    audioInputRef,
    startRecording: startVoiceprintRecording,
    stopRecording: stopVoiceprintRecording,
    handleAudioUpload: handleVoiceprintUpload,
  } = useVoiceprintRecorder({
    locale: locale as "zh" | "en",
    onAudioReady: handleVoiceprintEnrollment,
    userId: user?.id,
    sampleText,
  })

  const requireVoiceprintName = useCallback(() => {
    const trimmedName = newVoiceprintName.trim()
    if (trimmedName) {
      pendingVoiceprintNameRef.current = trimmedName
      return true
    }
    pendingVoiceprintNameRef.current = ""
    setVoiceprintStatus(zh ? "请先填写声纹名称，再录制或上传音频。" : "Please enter a voiceprint name before recording or uploading audio.")
    voiceprintNameInputRef.current?.focus()
    return false
  }, [newVoiceprintName, zh])

  const handleVoiceprintRecordClick = useCallback(() => {
    if (isRecording) {
      void stopVoiceprintRecording()
      return
    }
    if (!requireVoiceprintName()) return
    void startVoiceprintRecording()
  }, [isRecording, requireVoiceprintName, startVoiceprintRecording, stopVoiceprintRecording])

  const handleVoiceprintUploadClick = useCallback(() => {
    if (!requireVoiceprintName()) return
    audioInputRef.current?.click()
  }, [audioInputRef, requireVoiceprintName])

  const handleVoiceprintFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!requireVoiceprintName()) {
        event.target.value = ""
        return
      }
      await handleVoiceprintUpload(event)
    },
    [handleVoiceprintUpload, requireVoiceprintName],
  )

  const handleDeleteVoiceprint = useCallback(
    async (vpId: string) => {
      if (!user) return
      try {
        const resp = await fetch(`${LANGGRAPH_API_URL}/api/user-voiceprints/${vpId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${user.id}` },
        })
        if (resp.ok) {
          onVoiceprintsChange(voiceprints.filter((vp) => vp.id !== vpId))
        }
      } catch (err) {
        console.error("[UserSettingsPage] Failed to delete voiceprint:", err)
      }
    },
    [user, voiceprints, onVoiceprintsChange],
  )

  // ---- API key actions ----
  const handleCreateApiKey = async () => {
    if (!apiKeyName.trim() || !user) return
    setError(null)
    setApiKeysLoading(true)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.id}` },
        body: JSON.stringify({ name: apiKeyName.trim() }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.detail || (zh ? "创建 API key 失败" : "Failed to create API key"))
      }
      const created = await resp.json()
      setNewApiKey(created.apiKey)
      setApiKeys((prev) => [{ ...created, apiKey: undefined }, ...prev])
      setApiKeyName("Default SDK key")
    } catch (err: any) {
      setError(err.message || (zh ? "创建 API key 失败" : "Failed to create API key"))
    } finally {
      setApiKeysLoading(false)
    }
  }

  const handleDeleteApiKey = async (keyId: string) => {
    if (!user) return
    setError(null)
    try {
      const resp = await fetch(`${LANGGRAPH_API_URL}/api/auth/api-keys/${keyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${user.id}` },
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error(data.detail || (zh ? "删除 API key 失败" : "Failed to delete API key"))
      }
      setApiKeys((prev) => prev.filter((key) => key.id !== keyId))
    } catch (err: any) {
      setError(err.message || (zh ? "删除 API key 失败" : "Failed to delete API key"))
    }
  }

  const handleCopyNewApiKey = async () => {
    if (!newApiKey) return
    await navigator.clipboard.writeText(newApiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const clearConversationsPhrase = zh ? "清空所有对话" : "CLEAR ALL CONVERSATIONS"
  const clearConversationsConfirmed = clearConversationsConfirmText.trim() === clearConversationsPhrase

  const handleClearAllConversations = async () => {
    if (!clearConversationsConfirmed) return

    setError(null)
    setClearConversationsStatus(null)
    setClearConversationsLoading(true)
    try {
      const deletedCount = await onClearAllConversations()
      setClearConversationsOpen(false)
      setClearConversationsConfirmText("")
      setClearConversationsStatus(
        zh
          ? `已清空 ${deletedCount} 条对话记录。`
          : `Cleared ${deletedCount} conversation${deletedCount === 1 ? "" : "s"}.`,
      )
      setTimeout(() => setClearConversationsStatus(null), 3000)
    } catch (err: any) {
      console.error("[UserSettingsPage] Failed to clear conversations:", err)
      setError(err.message || (zh ? "清空对话失败，请重试" : "Failed to clear conversations, please try again"))
    } finally {
      setClearConversationsLoading(false)
    }
  }

  // ---- Computed: combined status for voiceprint section ----
  const effectiveVoiceprintStatus = voiceprintStatus || recorderStatus

  if (!user) return null

  const sectionDensity = elderOptimized ? "roomy" : "default"
  const sectionTitleCompact = !elderOptimized

  return (
    <>
    <AppShell className={`flex-col ${elderOptimized ? "text-[17px]" : ""}`}>
      {/* Header */}
      <AppHeader className={`${elderOptimized ? "min-h-20 px-5 py-3 sm:px-8" : "px-6"} justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <div>
            <h1 className={`${elderOptimized ? "text-2xl gap-2" : "text-base gap-1.5"} font-semibold tracking-wide flex items-center font-display`}>
              <Settings2 className={`${elderOptimized ? "w-6 h-6" : "w-5 h-5"} text-primary`} />
              {zh ? "用户设置" : "User Settings"}
            </h1>
            <p className={`${elderOptimized ? "text-sm mt-1 leading-snug" : "text-[11px] leading-none"} text-muted-foreground/80`}>
              {zh ? "管理您的个人信息、偏好设置和安全选项" : "Manage your profile, preferences, and safety options"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {zh ? "保存中..." : "Saving..."}
            </span>
          )}
          {saved && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {zh ? "已保存" : "Saved"}
            </span>
          )}
          <NavActionButton
            variant="outline"
            onClick={onBackToChat}
            className={elderOptimized ? "h-11 min-w-[8.5rem] px-4 text-base" : ""}
          >
            <ArrowLeft className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"}`} />
            {zh ? "返回对话" : "Back to Chat"}
          </NavActionButton>
        </div>
      </AppHeader>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left nav (hidden in elder mode for simplicity) */}
        {!elderOptimized && (
          <aside className="w-[180px] border-r border-border/40 flex-shrink-0 overflow-y-auto bg-background/30">
            <nav className="p-4 space-y-1 sticky top-0">
              <div className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-3 px-3">
                {zh ? "配置目录" : "Sections"}
              </div>
              {NAV_SECTIONS.map(({ id, icon: Icon, labelZh, labelEn }) => (
                <NavItem
                  key={id}
                  onClick={() => scrollToSection(id)}
                  icon={Icon}
                  active={activeSection === id}
                  label={zh ? labelZh : labelEn}
                />
              ))}
            </nav>
          </aside>
        )}

        {/* Scrollable content */}
        <main
          ref={scrollContainerRef}
          onScroll={updateActiveSectionFromScroll}
          className={`flex-1 overflow-y-auto ${elderOptimized ? "p-4 sm:p-8" : "p-6 sm:p-8"} bg-gradient-to-tr from-sidebar-accent/5 to-transparent`}
        >
          <div className={`${elderOptimized ? "max-w-3xl space-y-7" : "max-w-2xl space-y-6"} mx-auto`}>
            {/* Gradient decoration */}
            <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40 rounded-full" />

            {/* Error */}
            {error && (
              <StatusNotice tone="error" className={elderOptimized ? "p-4 text-base" : undefined}>
                {error}
              </StatusNotice>
            )}

            {/* ============ Section: Optimized Display ============ */}
            <PageSection
              id="section-display"
              ref={registerSectionRef("section-display")}
              tone="primary"
              density={sectionDensity}
            >
              <PageSectionTitle icon={Accessibility} compact={sectionTitleCompact}>
                {zh ? "优化显示" : "Optimized Display"}
              </PageSectionTitle>
              <SettingsSwitch
                checked={elderOptimized}
                onCheckedChange={onElderOptimizedChange}
                size={elderOptimized ? "lg" : "default"}
                className="border-primary/25 bg-background/70 hover:border-primary/45"
                label={zh ? "放大全部界面" : "Enlarge The Whole App"}
                description={
                  zh
                    ? "开启后会放大全部界面的文字、输入框、按钮、开关和对话内容，让点击和阅读更轻松，同时保留当前的温暖配色和简洁布局。"
                    : "Increases text, inputs, buttons, switches, and chat content across the app while keeping the current warm palette and clean layout."
                }
              />
            </PageSection>

            {/* ============ Section: Profile Info ============ */}
            <PageSection
              id="section-profile"
              ref={registerSectionRef("section-profile")}
              density={sectionDensity}
            >
              <PageSectionTitle icon={User} compact={sectionTitleCompact}>
                {zh ? "基本信息" : "Profile Information"}
              </PageSectionTitle>

              {/* Username */}
              <InputField
                id="settings-username"
                label={zh ? "用户名" : "Username"}
                type="text"
                placeholder={zh ? "输入用户名" : "Enter username"}
                value={username}
                readOnly
                disabled
                required
                leadingIcon={<User className={elderOptimized ? "w-5 h-5" : "w-4 h-4"} />}
                fieldClassName={elderOptimized ? "space-y-2" : undefined}
                labelClassName={elderOptimized ? "text-base" : undefined}
                className={`${elderOptimized ? "h-14 pl-12 text-lg" : ""} bg-background/50 border-border/40 focus:bg-background/90`}
              />

              {/* Email */}
              <InputField
                id="settings-email"
                label={zh ? "邮箱" : "Email"}
                type="email"
                placeholder={zh ? "输入邮箱地址" : "Enter email address"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leadingIcon={<Mail className={elderOptimized ? "w-5 h-5" : "w-4 h-4"} />}
                fieldClassName={elderOptimized ? "space-y-2" : undefined}
                labelClassName={elderOptimized ? "text-base" : undefined}
                className={`${elderOptimized ? "h-14 pl-12 text-lg" : ""} bg-background/50 border-border/40 focus:bg-background/90`}
              />
            </PageSection>

            {/* ============ Section: Preferences ============ */}
            <PageSection
              id="section-prefs"
              ref={registerSectionRef("section-prefs")}
              density={sectionDensity}
            >
              <PageSectionTitle icon={Settings2} compact={sectionTitleCompact}>
                {zh ? "通用偏好 (提示词注入)" : "General Preferences (Prompt Injection)"}
              </PageSectionTitle>

              <div className={elderOptimized ? "space-y-2" : "space-y-1.5"}>
                <Label htmlFor="settings-preferences" className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                  {zh ? "偏好信息" : "Your Preferences"}
                </Label>
                <Textarea
                  id="settings-preferences"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  rows={6}
                  placeholder={
                    zh
                      ? "例如：我是一名前端开发者，偏好使用 TypeScript 和 React。回答时请简洁明了，使用中文。我喜欢先看方案概览再看具体实现..."
                      : "e.g., I'm a frontend developer who prefers TypeScript and React. Please keep answers concise. I like to see the overview before diving into implementation details..."
                  }
                  className={`${elderOptimized ? "min-h-48 p-4 text-lg leading-8" : "text-sm leading-relaxed"} resize-none bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg`}
                />
                <p className={`${elderOptimized ? "text-sm leading-6" : "text-[11px]"} text-muted-foreground/80`}>
                  {zh
                    ? "这些信息会作为上下文注入到角色的系统提示中，帮助角色更好地理解您的需求和偏好。"
                    : "This information will be injected into the agent's system prompt to help it better understand your needs and preferences."}
                </p>
              </div>
            </PageSection>

            {/* ============ Section: Safety ============ */}
            <PageSection
              id="section-safety"
              ref={registerSectionRef("section-safety")}
              density={sectionDensity}
            >
              <PageSectionTitle icon={Shield} compact={sectionTitleCompact}>
                {zh ? "安全选项" : "Safety Options"}
              </PageSectionTitle>

              <SettingsSwitch
                checked={safetyEnabled}
                onCheckedChange={setSafetyEnabled}
                size={elderOptimized ? "lg" : "default"}
                label={zh ? "安全确认模式" : "Safety Confirmation Mode"}
                description={
                  zh
                    ? "开启后，角色在执行任何潜在危险操作（如删除文件、发送邮件、修改系统配置等）之前，会先向您描述操作内容和潜在后果，并等待您的明确确认。"
                    : "When enabled, the agent will describe the action and its potential consequences before executing any potentially dangerous operations (e.g., deleting files, sending emails, modifying system configs), and wait for your explicit confirmation."
                }
              />
            </PageSection>

            {/* ============ Section: Voiceprint Management ============ */}
            <PageSection
              id="section-voiceprint"
              ref={registerSectionRef("section-voiceprint")}
              density={sectionDensity}
            >
              <PageSectionTitle icon={Waves} compact={sectionTitleCompact}>
                {zh ? "声纹管理" : "Voiceprint Management"}
              </PageSectionTitle>

              <p className={`${elderOptimized ? "text-base leading-7" : "text-xs leading-relaxed"} text-muted-foreground`}>
                {zh
                  ? "在此注册您的声纹，注册后可在角色配置中选择使用。一个用户可以注册多个声纹。"
                  : "Register your voiceprint here. Once registered, it can be selected in agent configurations. You can register multiple voiceprints."}
              </p>

              {/* Saved voiceprints list */}
              {voiceprints.length > 0 && (
                <div className="space-y-2">
                  <div className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                    {zh ? "已注册的声纹" : "Registered Voiceprints"}
                  </div>
                  {voiceprints.map((vp) => (
                    <ListItem
                      key={vp.id}
                      title={vp.name}
                      description={vp.enrolledAt ? new Date(vp.enrolledAt).toLocaleString() : new Date(vp.createdAt).toLocaleString()}
                      className={`${elderOptimized ? "px-4 py-3 pr-16" : "px-3 py-2.5 pr-14"} cursor-default`}
                      actions={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteVoiceprint(vp.id)}
                          className={`${elderOptimized ? "h-11 w-11" : "h-8 w-8"} p-0 text-muted-foreground hover:text-destructive`}
                          title={zh ? "删除声纹" : "Delete voiceprint"}
                        >
                          <Trash2 className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />
                        </Button>
                      }
                    >
                    </ListItem>
                  ))}
                </div>
              )}

              {/* New voiceprint registration */}
              <div className={`space-y-3 pt-3 border-t border-border/40`}>
                <Label className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                  {zh ? "注册新声纹" : "Register New Voiceprint"}
                </Label>

                {/* Sample text */}
                <div className={`rounded-lg border border-border/60 bg-muted/20 ${elderOptimized ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"} leading-relaxed`}>
                  {sampleText}
                </div>

                {/* Name input */}
                <Input
                  ref={voiceprintNameInputRef}
                  value={newVoiceprintName}
                  onChange={(e) => setNewVoiceprintName(e.target.value)}
                  placeholder={zh ? "声纹名称（如：我的声纹）" : "Voiceprint name (e.g., My Voiceprint)"}
                  className={`${elderOptimized ? "h-14 text-lg" : "h-10 text-sm"} bg-background/50 border-border/40 focus:border-primary/60 rounded-lg`}
                />

                {/* Hidden file input */}
                <input
                  ref={audioInputRef}
                  type="file"
                  accept={SPEAKER_AUDIO_ACCEPT}
                  onChange={handleVoiceprintFileChange}
                  className="hidden"
                />

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    type="button"
                    variant={isRecording ? "destructive" : "outline"}
                    size={elderOptimized ? "lg" : "sm"}
                    onClick={handleVoiceprintRecordClick}
                    disabled={isVoiceprintProcessing}
                    className="gap-1.5 rounded-lg"
                  >
                    {isRecording ? <Square className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} /> : isVoiceprintProcessing ? <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} animate-spin`} /> : <Mic className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />}
                    {isVoiceprintProcessing
                      ? (zh ? "正在保存" : "Saving")
                      : isRecording
                      ? (zh ? "停止并保存" : "Stop and save")
                      : (zh ? "录制声纹" : "Record voiceprint")}
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="outline"
                    size={elderOptimized ? "lg" : "sm"}
                    onClick={handleVoiceprintUploadClick}
                    disabled={isRecording || isVoiceprintProcessing}
                    className="gap-1.5 rounded-lg"
                  >
                    <Upload className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />
                    {zh ? "上传音频" : "Upload audio"}
                  </ActionButton>
                </div>

                {/* Status */}
                {effectiveVoiceprintStatus && (
                  <p className={`${elderOptimized ? "text-sm" : "text-xs"} text-muted-foreground`}>{effectiveVoiceprintStatus}</p>
                )}
              </div>
            </PageSection>

            {/* ============ Section: API Keys ============ */}
            <PageSection
              id="section-apikeys"
              ref={registerSectionRef("section-apikeys")}
              density={sectionDensity}
            >
              <PageSectionTitle icon={KeyRound} compact={sectionTitleCompact}>
                {zh ? "API Key 与远程调用" : "API Keys & Remote Calls"}
              </PageSectionTitle>

              <p className={`${elderOptimized ? "text-base leading-7" : "text-xs leading-relaxed"} text-muted-foreground`}>
                {zh
                  ? "这些 key 用于外部 LangGraph SDK 或服务端调用。本 Web UI 始终使用当前登录会话。"
                  : "These keys are for external LangGraph SDK or server-side calls. This Web UI always uses the current login session."}
              </p>

              {newApiKey && (
                <div className={`${elderOptimized ? "p-4 space-y-3" : "p-3 space-y-2"} rounded-lg border border-primary/25 bg-primary/5`}>
                  <div className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-foreground`}>
                    {zh ? "新 API key 只显示一次" : "New API key, shown once"}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input value={newApiKey} readOnly className={`${elderOptimized ? "h-12 text-base" : "h-9 text-xs"} font-mono bg-background/70`} />
                    <ActionButton type="button" variant="outline" size="sm" onClick={handleCopyNewApiKey} className={`${elderOptimized ? "h-12 px-4 text-base" : "h-9"} gap-1.5`}>
                      {copied ? <Check className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} /> : <Copy className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />}
                      {copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}
                    </ActionButton>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={apiKeyName}
                  onChange={(e) => setApiKeyName(e.target.value)}
                  placeholder={zh ? "API key 名称" : "API key name"}
                  className={`${elderOptimized ? "h-14 text-lg" : "h-10 text-sm"} bg-background/50 border-border/40 focus:border-primary/60 rounded-lg`}
                />
                <ActionButton
                  type="button"
                  variant="outline"
                  disabled={apiKeysLoading || !apiKeyName.trim()}
                  onClick={handleCreateApiKey}
                  className={`${elderOptimized ? "h-14 px-5 text-lg" : "h-10"} rounded-lg gap-1.5`}
                >
                  {apiKeysLoading ? <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} animate-spin`} /> : <Plus className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />}
                  {zh ? "创建" : "Create"}
                </ActionButton>
              </div>

              <div className="space-y-2">
                {apiKeys.map((key) => (
                  <ListItem
                    key={key.id}
                    title={key.name}
                    description={<span className="font-mono">{key.keyPrefix}</span>}
                    className={`${elderOptimized ? "px-4 py-3 pr-16" : "px-3 py-2 pr-14"} cursor-default`}
                    actions={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteApiKey(key.id)}
                        className={`${elderOptimized ? "h-11 w-11" : "h-8 w-8"} p-0 text-muted-foreground hover:text-destructive`}
                        title={zh ? "删除 API key" : "Delete API key"}
                      >
                        <Trash2 className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />
                      </Button>
                    }
                  />
                ))}
                {!apiKeysLoading && apiKeys.length === 0 && (
                  <EmptyState
                    className="min-h-20"
                    description={zh ? "还没有 API key。" : "No API keys yet."}
                  />
                )}
              </div>
            </PageSection>

            {/* Multi-agent toggle (kept at bottom) */}
            <SettingsSwitch
              checked={multiAgentEnabled}
              onCheckedChange={setMultiAgentEnabled}
              size={elderOptimized ? "lg" : "default"}
              label={
                <span className="flex items-center gap-2 min-w-0">
                <MessagesSquare className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"} flex-shrink-0`} />
                <span className="truncate">
                  {zh ? "多角色对话和信息沟通" : "Multi-agent Conversation & Information Exchange"}
                </span>
              </span>
              }
            />

            {/* ============ Section: Danger Zone ============ */}
            <PageSection
              id="section-danger"
              ref={registerSectionRef("section-danger")}
              className="border-destructive/25 bg-destructive/5"
            >
              <PageSectionTitle icon={Trash2} compact={sectionTitleCompact} className="text-destructive">
                {zh ? "危险操作" : "Danger Zone"}
              </PageSectionTitle>

              <div className={`${elderOptimized ? "gap-4 p-4" : "gap-3 p-3.5"} flex flex-col rounded-xl border border-destructive/20 bg-background/70 sm:flex-row sm:items-center sm:justify-between`}>
                <div className="min-w-0">
                  <div className={`${elderOptimized ? "text-lg" : "text-sm"} font-semibold text-foreground`}>
                    {zh ? "清空所有对话记录" : "Clear all conversations"}
                  </div>
                  <div className={`${elderOptimized ? "text-base mt-2 leading-7" : "text-xs mt-1 leading-relaxed"} text-muted-foreground`}>
                    {zh
                      ? `将永久删除当前账号的全部对话记录。当前已加载 ${conversationCount} 条，删除后无法恢复。`
                      : `Permanently deletes every conversation for this account. ${conversationCount} loaded now. This cannot be undone.`}
                  </div>
                  {clearConversationsStatus && (
                    <div className={`${elderOptimized ? "text-sm mt-2" : "text-xs mt-2"} text-green-600 dark:text-green-400`}>
                      {clearConversationsStatus}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size={elderOptimized ? "lg" : "sm"}
                  onClick={() => setClearConversationsOpen(true)}
                  disabled={clearConversationsLoading}
                  className="shrink-0 gap-1.5 rounded-lg"
                >
                  {clearConversationsLoading ? (
                    <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} animate-spin`} />
                  ) : (
                    <Trash2 className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />
                  )}
                  {zh ? "清空对话" : "Clear conversations"}
                </Button>
              </div>
            </PageSection>

            {/* Bottom spacing */}
            <div className="h-8" />
          </div>
        </main>
      </div>
    </AppShell>

    <Dialog
      open={clearConversationsOpen}
      onOpenChange={(open) => {
        if (clearConversationsLoading) return
        setClearConversationsOpen(open)
        if (!open) {
          setClearConversationsConfirmText("")
        }
      }}
    >
      <DialogContent className={elderOptimized ? "sm:max-w-xl p-7" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle className={`${elderOptimized ? "text-2xl" : "text-lg"} flex items-center gap-2 text-destructive`}>
            <AlertCircle className={elderOptimized ? "w-6 h-6" : "w-5 h-5"} />
            {zh ? "确认清空所有对话记录" : "Confirm clearing all conversations"}
          </DialogTitle>
          <DialogDescription className={elderOptimized ? "text-base leading-7" : "text-sm leading-6"}>
            {zh
              ? "此操作会永久删除当前账号下的全部对话记录和本地输入草稿，删除后无法恢复。"
              : "This permanently deletes every conversation for this account and local input drafts. It cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="clear-conversations-confirm" className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
            {zh ? "请输入以下文字进行确认：" : "Type this phrase to confirm:"}
          </Label>
          <div className={`${elderOptimized ? "text-base px-4 py-3" : "text-sm px-3 py-2"} rounded-lg border border-destructive/20 bg-destructive/5 font-mono text-destructive`}>
            {clearConversationsPhrase}
          </div>
          <Input
            id="clear-conversations-confirm"
            value={clearConversationsConfirmText}
            onChange={(e) => setClearConversationsConfirmText(e.target.value)}
            disabled={clearConversationsLoading}
            className={`${elderOptimized ? "h-14 text-lg" : "h-10 text-sm"} rounded-lg border-border/60 bg-background`}
            autoComplete="off"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setClearConversationsOpen(false)}
            disabled={clearConversationsLoading}
            className={elderOptimized ? "h-12 px-5 text-base" : ""}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleClearAllConversations}
            disabled={!clearConversationsConfirmed || clearConversationsLoading}
            className={`${elderOptimized ? "h-12 px-5 text-base" : ""} gap-1.5`}
          >
            {clearConversationsLoading && <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} animate-spin`} />}
            {zh ? "永久清空" : "Clear permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
