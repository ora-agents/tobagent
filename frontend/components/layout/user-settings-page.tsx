"use client"

import { useState, useEffect } from "react"
import { User, Mail, Shield, Loader2, AlertCircle, Settings2, ArrowLeft, MessagesSquare, KeyRound, Plus, Trash2, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

interface UserSettingsPageProps {
  onBackToChat: () => void
}

interface UserApiKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

export function UserSettingsPage({ onBackToChat }: UserSettingsPageProps) {
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
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* 1. Header Area - matches ManagementDashboard */}
      <header className="h-16 px-6 border-b border-border/60 bg-background/95 backdrop-blur flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-wide flex items-center gap-1.5 font-display">
              <Settings2 className="w-5 h-5 text-primary" />
              {zh ? "用户设置" : "User Settings"}
            </h1>
            <p className="text-[11px] text-muted-foreground/80 leading-none">
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
          className="gap-2 hover:bg-primary/10 hover:text-primary transition-all duration-200 border-border/80 shadow-depth-xs rounded-lg"
        >
          <ArrowLeft className="w-4 h-4" />
          {zh ? "返回对话" : "Back to Chat"}
        </Button>
      </header>

      {/* 2. Main Content Area - matches ManagementDashboard gradient bg */}
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6 sm:p-8 bg-gradient-to-tr from-sidebar-accent/5 to-transparent">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Colorful gradient header decoration */}
            <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40 rounded-full" />

            <form onSubmit={handleSave} className="space-y-6">
              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <div className="font-medium truncate">{error}</div>
                </div>
              )}

              {/* Success Message */}
              {saved && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm">
                  <div className="font-medium">{zh ? "保存成功！" : "Saved successfully!"}</div>
                </div>
              )}

              {/* Profile Info Section */}
              <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-5">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" />
                  {zh ? "基本信息" : "Profile Information"}
                </h3>

                {/* Username */}
                <div className="space-y-1.5">
                  <Label htmlFor="settings-username" className="text-xs font-semibold text-muted-foreground">
                    {zh ? "用户名" : "Username"} <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative group">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                      <User className="w-4 h-4" />
                    </span>
                    <Input
                      id="settings-username"
                      type="text"
                      placeholder={zh ? "输入用户名" : "Enter username"}
                      value={username}
                      readOnly
                      disabled
                      className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg h-10 text-sm"
                      required
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="settings-email" className="text-xs font-semibold text-muted-foreground">
                    {zh ? "邮箱" : "Email"}
                  </Label>
                  <div className="relative group">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                      <Mail className="w-4 h-4" />
                    </span>
                    <Input
                      id="settings-email"
                      type="email"
                      placeholder={zh ? "输入邮箱地址" : "Enter email address"}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={loading}
                      className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg h-10 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Preferences Section */}
              <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-5">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5" />
                  {zh ? "通用偏好 (提示词注入)" : "General Preferences (Prompt Injection)"}
                </h3>

                <div className="space-y-1.5">
                  <Label htmlFor="settings-preferences" className="text-xs font-semibold text-muted-foreground">
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
                    className="resize-none bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg text-sm leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground/80">
                    {zh
                      ? "这些信息会作为上下文注入到角色的系统提示中，帮助角色更好地理解您的需求和偏好。"
                      : "This information will be injected into the agent's system prompt to help it better understand your needs and preferences."}
                  </p>
                </div>
              </div>

              {/* Safety Switch Section */}
              <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-5">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  {zh ? "安全选项" : "Safety Options"}
                </h3>

                <div
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-border/50 bg-background/50 cursor-pointer hover:border-primary/30 hover:bg-accent/20 transition-all duration-200"
                  onClick={() => setSafetyEnabled(!safetyEnabled)}
                >
                  {/* Toggle Switch */}
                  <div className="flex-shrink-0 mt-0.5">
                    <div
                      className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 ${
                        safetyEnabled ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    >
                      <div
                        className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          safetyEnabled ? "translate-x-[20px]" : "translate-x-[2px]"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {zh ? "安全确认模式" : "Safety Confirmation Mode"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {zh
                        ? "开启后，角色在执行任何潜在危险操作（如删除文件、发送邮件、修改系统配置等）之前，会先向您描述操作内容和潜在后果，并等待您的明确确认。"
                        : "When enabled, the agent will describe the action and its potential consequences before executing any potentially dangerous operations (e.g., deleting files, sending emails, modifying system configs), and wait for your explicit confirmation."}
                    </div>
                  </div>
                </div>
              </div>

              {/* API Key Section */}
              <div className="space-y-4 border border-border/40 rounded-xl bg-background/50 p-5">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  {zh ? "API Key 与远程调用" : "API Keys & Remote Calls"}
                </h3>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {zh
                    ? "这些 key 用于外部 LangGraph SDK 或服务端调用。本 Web UI 始终使用当前登录会话。"
                    : "These keys are for external LangGraph SDK or server-side calls. This Web UI always uses the current login session."}
                </p>

                {newApiKey && (
                  <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-2">
                    <div className="text-xs font-semibold text-foreground">
                      {zh ? "新 API key 只显示一次" : "New API key, shown once"}
                    </div>
                    <div className="flex gap-2">
                      <Input value={newApiKey} readOnly className="font-mono text-xs h-9 bg-background/70" />
                      <Button type="button" variant="outline" size="sm" onClick={handleCopyNewApiKey} className="h-9 gap-1.5">
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    value={apiKeyName}
                    onChange={(e) => setApiKeyName(e.target.value)}
                    placeholder={zh ? "API key 名称" : "API key name"}
                    className="bg-background/50 border-border/40 focus:border-primary/60 rounded-lg h-10 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={apiKeysLoading || !apiKeyName.trim()}
                    onClick={handleCreateApiKey}
                    className="rounded-lg h-10 gap-1.5"
                  >
                    {apiKeysLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {zh ? "创建" : "Create"}
                  </Button>
                </div>

                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{key.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{key.keyPrefix}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteApiKey(key.id)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        title={zh ? "删除 API key" : "Delete API key"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  {!apiKeysLoading && apiKeys.length === 0 && (
                    <div className="text-xs text-muted-foreground">
                      {zh ? "还没有 API key。" : "No API keys yet."}
                    </div>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant={multiAgentEnabled ? "default" : "outline"}
                onClick={() => setMultiAgentEnabled((enabled) => !enabled)}
                className={`w-full justify-between rounded-xl h-12 px-4 text-sm font-semibold transition-all duration-200 ${
                  multiAgentEnabled
                    ? "bg-primary hover:bg-primary/95 text-primary-foreground border-primary"
                    : "bg-background/50 border-border/50 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <MessagesSquare className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">
                    {zh ? "多角色对话和信息沟通" : "Multi-agent Conversation & Information Exchange"}
                  </span>
                </span>
                <span
                  className={`relative inline-flex h-[22px] w-10 flex-shrink-0 overflow-hidden rounded-full transition-colors duration-200 ${
                    multiAgentEnabled ? "bg-primary-foreground/25" : "bg-muted-foreground/25"
                  }`}
                >
                  <span
                    className={`absolute left-0 top-[2px] h-[18px] w-[18px] rounded-full bg-background shadow-sm transition-transform duration-200 ${
                      multiAgentEnabled ? "translate-x-[20px]" : "translate-x-[2px]"
                    }`}
                  />
                </span>
              </Button>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="submit"
                  disabled={loading || !username.trim()}
                  className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-lg h-10 px-6 text-sm font-semibold"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
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
                  className="rounded-lg h-10 px-4 text-sm"
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
