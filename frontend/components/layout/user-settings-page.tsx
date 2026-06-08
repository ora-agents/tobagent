"use client"

import { useState, useEffect } from "react"
import { User, Mail, Shield, Loader2, AlertCircle, Settings2, ArrowLeft, MessagesSquare, KeyRound, Plus, Trash2, Copy, Check, Accessibility } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

interface UserSettingsPageProps {
  onBackToChat: () => void
  elderOptimized: boolean
  onElderOptimizedChange: (enabled: boolean) => void
}

interface UserApiKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

export function UserSettingsPage({ onBackToChat, elderOptimized, onElderOptimizedChange }: UserSettingsPageProps) {
  const { user, updateProfile } = useAuth()
  const { locale } = useI18n()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [preferences, setPreferences] = useState("")
  const [safetyEnabled, setSafetyEnabled] = useState(false)
  const [multiAgentEnabled, setMultiAgentEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [apiKeys, setApiKeys] = useState<UserApiKey[]>([])
  const [apiKeyName, setApiKeyName] = useState("Default SDK key")
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Sync form state when user changes
  useEffect(() => {
    if (user) {
      setUsername(user.username || "")
      setEmail(user.email || "")
      setPreferences(user.preferences || "")
      setSafetyEnabled(user.safetyEnabled || false)
      setError(null)
      setSaved(false)
    }
  }, [user])

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

  // Auto-hide success message
  useEffect(() => {
    if (saved) {
      const timer = setTimeout(() => setSaved(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [saved])

  if (!user) return null

  const zh = locale === "zh"
  const switchSize = elderOptimized
    ? {
        track: "h-8 w-14",
        knob: "h-7 w-7",
        knobOn: "translate-x-[26px]",
        knobOff: "translate-x-[2px]",
      }
    : {
        track: "h-[22px] w-10",
        knob: "h-[18px] w-[18px]",
        knobOn: "translate-x-[20px]",
        knobOff: "translate-x-[2px]",
      }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    setLoading(true)
    try {
      const payload = {
        email: email.trim() || null,
        preferences: preferences.trim() || null,
        safetyEnabled,
      }
      const updated = await updateProfile(payload)
      console.log('[UserSettingsPage] Saved:', updated)
      setSaved(true)
    } catch (err: any) {
      console.error('[UserSettingsPage] Save failed:', err)
      setError(err.message || (zh ? "保存失败，请重试" : "Save failed, please try again"))
    } finally {
      setLoading(false)
    }
  }

  const handleCreateApiKey = async () => {
    if (!apiKeyName.trim()) return
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

  return (
    <div className={`h-screen flex flex-col bg-background text-foreground overflow-hidden ${elderOptimized ? "text-[17px]" : ""}`}>
      {/* 1. Header Area - matches ManagementDashboard */}
      <header className={`${elderOptimized ? "min-h-20 px-5 sm:px-8 py-3" : "h-16 px-6"} border-b border-border/60 bg-background/95 backdrop-blur flex items-center justify-between flex-shrink-0 gap-3`}>
        <div className="flex items-center gap-3">
          <div>
            <h1 className={`${elderOptimized ? "text-2xl gap-2" : "text-base gap-1.5"} font-semibold tracking-wide flex items-center font-display`}>
              <Settings2 className={`${elderOptimized ? "w-6 h-6" : "w-5 h-5"} text-primary`} />
              {zh ? "用户设置" : "User Settings"}
            </h1>
            <p className={`${elderOptimized ? "text-sm mt-1 leading-snug" : "text-[11px] leading-none"} text-muted-foreground/80`}>
              {zh
                ? "管理您的个人信息、偏好设置和安全选项"
                : "Manage your profile, preferences, and safety options"}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onBackToChat}
          className={`${elderOptimized ? "h-11 px-4 text-base" : ""} gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200 border-border/80 shadow-depth-xs rounded-lg`}
        >
          <ArrowLeft className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"}`} />
          {zh ? "返回对话" : "Back to Chat"}
        </Button>
      </header>

      {/* 2. Main Content Area - matches ManagementDashboard gradient bg */}
      <div className="flex-1 flex overflow-hidden">
        <main className={`flex-1 overflow-y-auto ${elderOptimized ? "p-4 sm:p-8" : "p-6 sm:p-8"} bg-gradient-to-tr from-sidebar-accent/5 to-transparent`}>
          <div className={`${elderOptimized ? "max-w-3xl space-y-7" : "max-w-2xl space-y-6"} mx-auto`}>
            {/* Colorful gradient header decoration */}
            <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40 rounded-full" />

            <form onSubmit={handleSave} className={elderOptimized ? "space-y-7" : "space-y-6"}>
              {/* Error Message */}
              {error && (
                <div className={`flex items-center gap-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive ${elderOptimized ? "p-4 text-base" : "p-3 text-sm"}`}>
                  <AlertCircle className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"} shrink-0`} />
                  <div className="font-medium truncate">{error}</div>
                </div>
              )}

              {/* Success Message */}
              {saved && (
                <div className={`flex items-center gap-2.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 ${elderOptimized ? "p-4 text-base" : "p-3 text-sm"}`}>
                  <div className="font-medium">{zh ? "保存成功！" : "Saved successfully!"}</div>
                </div>
              )}

              {/* Elder Optimized Display Section */}
              <div className={`${elderOptimized ? "space-y-5 rounded-xl p-6" : "space-y-4 rounded-xl p-5"} border border-primary/20 bg-primary/5`}>
                <h3 className={`${elderOptimized ? "text-base" : "text-xs uppercase tracking-wider"} font-bold text-muted-foreground flex items-center gap-1.5`}>
                  <Accessibility className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} text-primary`} />
                  {zh ? "老人优化显示" : "Senior-friendly Display"}
                </h3>

                <button
                  type="button"
                  role="switch"
                  aria-checked={elderOptimized}
                  onClick={() => onElderOptimizedChange(!elderOptimized)}
                  className={`${elderOptimized ? "items-center gap-5 p-5" : "items-start gap-3 p-3.5"} flex w-full rounded-xl border border-primary/25 bg-background/70 text-left transition-all duration-200 hover:border-primary/45 hover:bg-background focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`relative rounded-full transition-colors duration-200 ${switchSize.track} ${
                        elderOptimized ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    >
                      <div
                        className={`absolute top-[2px] rounded-full bg-white shadow-sm transition-transform duration-200 ${switchSize.knob} ${
                          elderOptimized ? switchSize.knobOn : switchSize.knobOff
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={`${elderOptimized ? "text-lg" : "text-sm"} font-semibold text-foreground`}>
                      {zh ? "放大全部界面" : "Enlarge The Whole App"}
                    </div>
                    <div className={`${elderOptimized ? "text-base mt-2 leading-7" : "text-xs mt-1 leading-relaxed"} text-muted-foreground`}>
                      {zh
                        ? "开启后会放大全部界面的文字、输入框、按钮、开关和对话内容，让点击和阅读更轻松，同时保留当前的温暖配色和简洁布局。"
                        : "Increases text, inputs, buttons, switches, and chat content across the app while keeping the current warm palette and clean layout."}
                    </div>
                  </div>
                </button>
              </div>

              {/* Profile Info Section */}
              <div className={`${elderOptimized ? "space-y-5 rounded-xl p-6" : "space-y-4 rounded-xl p-5"} border border-border/40 bg-background/50`}>
                <h3 className={`${elderOptimized ? "text-base" : "text-xs uppercase tracking-wider"} font-bold text-muted-foreground flex items-center gap-1.5`}>
                  <User className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
                  {zh ? "基本信息" : "Profile Information"}
                </h3>

                {/* Username */}
                <div className={elderOptimized ? "space-y-2" : "space-y-1.5"}>
                  <Label htmlFor="settings-username" className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                    {zh ? "用户名" : "Username"} <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative group">
                    <span className={`${elderOptimized ? "left-4" : "left-3"} absolute top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200`}>
                      <User className={elderOptimized ? "w-5 h-5" : "w-4 h-4"} />
                    </span>
                    <Input
                      id="settings-username"
                      type="text"
                      placeholder={zh ? "输入用户名" : "Enter username"}
                      value={username}
                      readOnly
                      disabled
                      className={`${elderOptimized ? "h-14 pl-12 text-lg" : "h-10 pl-9 text-sm"} bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg`}
                      required
                    />
                  </div>
                </div>

                {/* Email */}
                <div className={elderOptimized ? "space-y-2" : "space-y-1.5"}>
                  <Label htmlFor="settings-email" className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                    {zh ? "邮箱" : "Email"}
                  </Label>
                  <div className="relative group">
                    <span className={`${elderOptimized ? "left-4" : "left-3"} absolute top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200`}>
                      <Mail className={elderOptimized ? "w-5 h-5" : "w-4 h-4"} />
                    </span>
                    <Input
                      id="settings-email"
                      type="email"
                      placeholder={zh ? "输入邮箱地址" : "Enter email address"}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className={`${elderOptimized ? "h-14 pl-12 text-lg" : "h-10 pl-9 text-sm"} bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg`}
                    />
                  </div>
                </div>
              </div>

              {/* Preferences Section */}
              <div className={`${elderOptimized ? "space-y-5 rounded-xl p-6" : "space-y-4 rounded-xl p-5"} border border-border/40 bg-background/50`}>
                <h3 className={`${elderOptimized ? "text-base" : "text-xs uppercase tracking-wider"} font-bold text-muted-foreground flex items-center gap-1.5`}>
                  <Settings2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
                  {zh ? "通用偏好 (提示词注入)" : "General Preferences (Prompt Injection)"}
                </h3>

                <div className={elderOptimized ? "space-y-2" : "space-y-1.5"}>
                  <Label htmlFor="settings-preferences" className={`${elderOptimized ? "text-base" : "text-xs"} font-semibold text-muted-foreground`}>
                    {zh ? "偏好信息" : "Your Preferences"}
                  </Label>
                  <Textarea
                    id="settings-preferences"
                    value={preferences}
                    onChange={(e) => setPreferences(e.target.value)}
                    disabled={loading}
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
              </div>

              {/* Safety Switch Section */}
              <div className={`${elderOptimized ? "space-y-5 rounded-xl p-6" : "space-y-4 rounded-xl p-5"} border border-border/40 bg-background/50`}>
                <h3 className={`${elderOptimized ? "text-base" : "text-xs uppercase tracking-wider"} font-bold text-muted-foreground flex items-center gap-1.5`}>
                  <Shield className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
                  {zh ? "安全选项" : "Safety Options"}
                </h3>

                <button
                  type="button"
                  role="switch"
                  aria-checked={safetyEnabled}
                  className={`${elderOptimized ? "items-center gap-5 p-5" : "items-start gap-3 p-3.5"} flex w-full text-left rounded-xl border border-border/50 bg-background/50 cursor-pointer hover:border-primary/30 hover:bg-accent/20 transition-all duration-200 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none`}
                  onClick={() => setSafetyEnabled(!safetyEnabled)}
                >
                  {/* Toggle Switch */}
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`relative rounded-full transition-colors duration-200 ${switchSize.track} ${
                        safetyEnabled ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    >
                      <div
                        className={`absolute top-[2px] rounded-full bg-white shadow-sm transition-transform duration-200 ${switchSize.knob} ${
                          safetyEnabled ? switchSize.knobOn : switchSize.knobOff
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className={`${elderOptimized ? "text-lg" : "text-sm"} font-semibold text-foreground`}>
                      {zh ? "安全确认模式" : "Safety Confirmation Mode"}
                    </div>
                    <div className={`${elderOptimized ? "text-base mt-2 leading-7" : "text-xs mt-1 leading-relaxed"} text-muted-foreground`}>
                      {zh
                        ? "开启后，角色在执行任何潜在危险操作（如删除文件、发送邮件、修改系统配置等）之前，会先向您描述操作内容和潜在后果，并等待您的明确确认。"
                        : "When enabled, the agent will describe the action and its potential consequences before executing any potentially dangerous operations (e.g., deleting files, sending emails, modifying system configs), and wait for your explicit confirmation."}
                    </div>
                  </div>
                </button>
              </div>

              {/* API Key Section */}
              <div className={`${elderOptimized ? "space-y-5 rounded-xl p-6" : "space-y-4 rounded-xl p-5"} border border-border/40 bg-background/50`}>
                <h3 className={`${elderOptimized ? "text-base" : "text-xs uppercase tracking-wider"} font-bold text-muted-foreground flex items-center gap-1.5`}>
                  <KeyRound className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
                  {zh ? "API Key 与远程调用" : "API Keys & Remote Calls"}
                </h3>

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
                      <Button type="button" variant="outline" size="sm" onClick={handleCopyNewApiKey} className={`${elderOptimized ? "h-12 px-4 text-base" : "h-9"} gap-1.5`}>
                        {copied ? <Check className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} /> : <Copy className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />}
                        {copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}
                      </Button>
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
                  <Button
                    type="button"
                    variant="outline"
                    disabled={apiKeysLoading || !apiKeyName.trim()}
                    onClick={handleCreateApiKey}
                    className={`${elderOptimized ? "h-14 px-5 text-lg" : "h-10"} rounded-lg gap-1.5`}
                  >
                    {apiKeysLoading ? <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} animate-spin`} /> : <Plus className={elderOptimized ? "w-5 h-5" : "w-3.5 h-3.5"} />}
                    {zh ? "创建" : "Create"}
                  </Button>
                </div>

                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <div key={key.id} className={`${elderOptimized ? "px-4 py-3" : "px-3 py-2"} flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40`}>
                      <div className="min-w-0">
                        <div className={`${elderOptimized ? "text-lg" : "text-sm"} font-medium truncate`}>{key.name}</div>
                        <div className={`${elderOptimized ? "text-sm mt-1" : "text-xs"} text-muted-foreground font-mono`}>{key.keyPrefix}</div>
                      </div>
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
                    </div>
                  ))}
                  {!apiKeysLoading && apiKeys.length === 0 && (
                    <div className={`${elderOptimized ? "text-base" : "text-xs"} text-muted-foreground`}>
                      {zh ? "还没有 API key。" : "No API keys yet."}
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant={multiAgentEnabled ? "default" : "outline"}
                onClick={() => setMultiAgentEnabled((enabled) => !enabled)}
                className={`w-full justify-between rounded-xl font-semibold transition-all duration-200 ${
                  elderOptimized ? "min-h-16 px-5 text-lg" : "h-12 px-4 text-sm"
                } ${
                  multiAgentEnabled
                    ? "bg-primary hover:bg-primary/95 text-primary-foreground border-primary"
                    : "bg-background/50 border-border/50 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <MessagesSquare className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"} flex-shrink-0`} />
                  <span className="truncate">
                    {zh ? "多角色对话和信息沟通" : "Multi-agent Conversation & Information Exchange"}
                  </span>
                </span>
                <span
                  className={`relative inline-flex ${switchSize.track} flex-shrink-0 overflow-hidden rounded-full transition-colors duration-200 ${
                    multiAgentEnabled ? "bg-primary-foreground/25" : "bg-muted-foreground/25"
                  }`}
                >
                  <span
                    className={`absolute left-0 top-[2px] rounded-full bg-background shadow-sm transition-transform duration-200 ${switchSize.knob} ${
                      multiAgentEnabled ? switchSize.knobOn : switchSize.knobOff
                    }`}
                  />
                </span>
              </Button>

              {/* Action Buttons */}
              <div className={`${elderOptimized ? "flex-col sm:flex-row gap-3 pt-3" : "items-center gap-2 pt-2"} flex`}>
                <Button
                  type="submit"
                  disabled={loading || !username.trim()}
                  className={`${elderOptimized ? "h-14 px-8 text-lg w-full sm:w-auto" : "h-10 px-6 text-sm"} bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg font-semibold`}
                >
                  {loading ? (
                    <>
                      <Loader2 className={`${elderOptimized ? "w-5 h-5" : "w-4 h-4"} animate-spin mr-2`} />
                      {zh ? "保存中..." : "Saving..."}
                    </>
                  ) : (
                    zh ? "保存设置" : "Save Settings"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onBackToChat}
                  className={`${elderOptimized ? "h-14 px-6 text-lg w-full sm:w-auto" : "h-10 px-4 text-sm"} rounded-lg`}
                >
                  {zh ? "取消" : "Cancel"}
                </Button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}
