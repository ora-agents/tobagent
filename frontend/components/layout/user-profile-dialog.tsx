"use client"

import { useState, useEffect } from "react"
import { User, Mail, Shield, Loader2, AlertCircle, Settings2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/providers/auth-provider"
import { useI18n } from "@/lib/i18n"

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserProfileDialog({ open, onOpenChange }: UserProfileDialogProps) {
  const { user, updateProfile } = useAuth()
  const { locale } = useI18n()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [preferences, setPreferences] = useState("")
  const [safetyEnabled, setSafetyEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Sync form state when dialog opens or user changes
  useEffect(() => {
    if (user && open) {
      setUsername(user.username || "")
      setEmail(user.email || "")
      setPreferences(user.preferences || "")
      setSafetyEnabled(user.safetyEnabled || false)
      setError(null)
      setSaved(false)
    }
  }, [user, open])

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

    if (!username.trim()) {
      setError(zh ? "用户名不能为空" : "Username cannot be empty")
      return
    }

    setLoading(true)
    try {
      const payload = {
        username: username.trim(),
        email: email.trim() || null,
        preferences: preferences.trim() || null,
        safetyEnabled,
      }
      console.log('[UserProfileDialog] Saving:', payload)
      const updated = await updateProfile(payload)
      console.log('[UserProfileDialog] Saved:', updated)
      setSaved(true)
    } catch (err: any) {
      console.error('[UserProfileDialog] Save failed:', err)
      setError(err.message || (zh ? "保存失败，请重试" : "Save failed, please try again"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col bg-background/95 backdrop-blur-md border-border/60 shadow-depth-lg rounded-xl overflow-hidden p-0">
        {/* Colorful gradient header decoration */}
        <div className="h-2 w-full bg-gradient-to-r from-primary via-primary/80 to-primary/40 flex-shrink-0" />

        <div className="p-6 space-y-5 overflow-y-auto">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="text-2xl font-bold font-sans tracking-tight text-foreground flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-primary" />
              {zh ? "用户设置" : "User Settings"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {zh
                ? "管理您的个人信息、偏好设置和安全选项。偏好信息将被注入到智能体的系统提示中。"
                : "Manage your profile, preferences, and safety options. Your preferences will be injected into the agent's system prompt."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-5">
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
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                {zh ? "基本信息" : "Profile Information"}
              </h3>

              {/* Username */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-username" className="text-xs font-semibold text-muted-foreground">
                  {zh ? "用户名" : "Username"} <span className="text-destructive">*</span>
                </Label>
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                    <User className="w-4 h-4" />
                  </span>
                  <Input
                    id="profile-username"
                    type="text"
                    placeholder={zh ? "输入用户名" : "Enter username"}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                    className="pl-9 bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg h-10 text-sm"
                    required
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-email" className="text-xs font-semibold text-muted-foreground">
                  {zh ? "邮箱" : "Email"}
                </Label>
                <div className="relative group">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/75 group-focus-within:text-primary transition-all duration-200">
                    <Mail className="w-4 h-4" />
                  </span>
                  <Input
                    id="profile-email"
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
            <div className="space-y-4 pt-2 border-t border-border/40">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5" />
                {zh ? "通用偏好 (提示词注入)" : "General Preferences (Prompt Injection)"}
              </h3>

              <div className="space-y-1.5">
                <Label htmlFor="profile-preferences" className="text-xs font-semibold text-muted-foreground">
                  {zh ? "偏好信息" : "Your Preferences"}
                </Label>
                <Textarea
                  id="profile-preferences"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  disabled={loading}
                  rows={5}
                  placeholder={
                    zh
                      ? "例如：我是一名前端开发者，偏好使用 TypeScript 和 React。回答时请简洁明了，使用中文。我喜欢先看方案概览再看具体实现..."
                      : "e.g., I'm a frontend developer who prefers TypeScript and React. Please keep answers concise. I like to see the overview before diving into implementation details..."
                  }
                  className="resize-none bg-background/50 border-border/40 focus:border-primary/60 focus:bg-background/90 rounded-lg text-sm leading-relaxed"
                />
                <p className="text-[11px] text-muted-foreground/80">
                  {zh
                    ? "这些信息会作为上下文注入到智能体的系统提示中，帮助智能体更好地理解您的需求和偏好。"
                    : "This information will be injected into the agent's system prompt to help it better understand your needs and preferences."}
                </p>
              </div>
            </div>

            {/* Safety Switch Section */}
            <div className="space-y-4 pt-2 border-t border-border/40">
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
                      ? "开启后，智能体在执行任何潜在危险操作（如删除文件、发送邮件、修改系统配置等）之前，会先向您描述操作内容和潜在后果，并等待您的明确确认。"
                      : "When enabled, the agent will describe the action and its potential consequences before executing any potentially dangerous operations (e.g., deleting files, sending emails, modifying system configs), and wait for your explicit confirmation."}
                  </div>
                </div>
              </div>
            </div>

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
                onClick={() => onOpenChange(false)}
                className="rounded-lg h-10 px-4 text-sm"
              >
                {zh ? "取消" : "Cancel"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
