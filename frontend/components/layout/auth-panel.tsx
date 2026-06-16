'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/providers/auth-provider'
import { User, Lock, Mail, AlertCircle, Loader2, X } from 'lucide-react'
import { useT } from '@/lib/i18n'

interface AuthPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inline?: boolean
}

export function AuthPanel({ open, onOpenChange, inline = false }: AuthPanelProps) {
  const t = useT()
  const { login, register, error, clearError } = useAuth()

  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    clearError()
    setLocalError(null)
  }, [activeTab, open, clearError])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!username.trim() || !password) {
      setLocalError(t.fillRequiredFields)
      return
    }

    if (activeTab === 'register') {
      if (password !== confirmPassword) {
        setLocalError(t.passwordsDoNotMatch)
        return
      }
      if (password.length < 6) {
        setLocalError(t.passwordMinLength)
        return
      }
    }

    setLoading(true)
    try {
      if (activeTab === 'login') {
        await login(username.trim(), password)
      } else {
        await register(username.trim(), password, email.trim() || undefined)
      }
      onOpenChange(false)
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setEmail('')
    } catch (err: any) {
      // AuthProvider owns the network error message.
    } finally {
      setLoading(false)
    }
  }

  const shownError = localError || error
  const title = activeTab === 'login' ? t.welcomeBack : t.createAccountTitle
  const description = activeTab === 'login' ? t.signInAccessDesc : t.registerAccessDesc

  const cardContent = (
    <section
      aria-label={title}
      className="relative w-full max-w-[29rem] overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-depth-lg sm:p-6 dark:bg-card"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-full bg-gradient-to-t from-primary-soft/70 to-transparent dark:from-background/40" />

      <div className="relative space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <svg className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2c0 5.523 4.477 10 10 10-5.523 0-10 4.477-10 10 0-5.523-4.477-10-10-10 5.523 0 10-4.477 10-10z" />
              </svg>
              {t.authSecureAccess}
            </div>
            {!inline && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Close auth panel"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-4xl font-medium leading-[1.05] tracking-normal text-foreground">
              {title}
            </h2>
            <p className="max-w-sm text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-lg border border-border bg-secondary p-1">
          <button
            type="button"
            onClick={() => setActiveTab('login')}
            className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
              activeTab === 'login'
                ? 'bg-background text-foreground shadow-depth-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.signIn}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
              activeTab === 'register'
                ? 'bg-background text-foreground shadow-depth-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.register}
          </button>
        </div>

        <div className="rounded-xl bg-secondary p-3 dark:bg-background/50">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-[0.12em] text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-success" />
            {t.authWorkspaceTitle}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <div className="rounded-lg border border-border/70 bg-background/70 p-2">
              <div className="font-mono text-[11px] text-primary">01</div>
              {t.authFeatureRole}
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-2">
              <div className="font-mono text-[11px] text-primary">02</div>
              {t.authFeatureKnowledge}
            </div>
            <div className="rounded-lg border border-border/70 bg-background/70 p-2">
              <div className="font-mono text-[11px] text-primary">03</div>
              {t.authFeatureTools}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {shownError && (
            <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="font-medium">{shownError}</div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">
              {t.username} <span className="text-destructive">*</span>
            </Label>
            <div className="group relative">
              <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/70 transition-all duration-200 group-focus-within:text-primary">
                <User className="h-4 w-4" />
              </span>
              <Input
                id="username"
                type="text"
                placeholder={t.enterUsername}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                className="h-10 rounded-md border-border bg-background pl-9 text-sm transition-all duration-200 hover:border-primary/50 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
                required
              />
            </div>
          </div>

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">
                {t.email}
              </Label>
              <div className="group relative">
                <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/70 transition-all duration-200 group-focus-within:text-primary">
                  <Mail className="h-4 w-4" />
                </span>
                <Input
                  id="email"
                  type="email"
                  placeholder={t.enterEmailOptional}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="h-10 rounded-md border-border bg-background pl-9 text-sm transition-all duration-200 hover:border-primary/50 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
              {t.password} <span className="text-destructive">*</span>
            </Label>
            <div className="group relative">
              <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/70 transition-all duration-200 group-focus-within:text-primary">
                <Lock className="h-4 w-4" />
              </span>
              <Input
                id="password"
                type="password"
                placeholder={t.enterPassword}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="h-10 rounded-md border-border bg-background pl-9 text-sm transition-all duration-200 hover:border-primary/50 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
                required
              />
            </div>
          </div>

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-medium text-muted-foreground">
                {t.confirmPassword} <span className="text-destructive">*</span>
              </Label>
              <div className="group relative">
                <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/70 transition-all duration-200 group-focus-within:text-primary">
                  <Lock className="h-4 w-4" />
                </span>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t.confirmPasswordPlaceholder}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="h-10 rounded-md border-border bg-background pl-9 text-sm transition-all duration-200 hover:border-primary/50 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/15"
                  required
                />
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full cursor-pointer rounded-md bg-primary text-sm font-medium text-primary-foreground shadow-depth-xs transition-all duration-200 hover:bg-primary-active hover:shadow-depth-hover active:bg-primary-active"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.pleaseWait}
              </>
            ) : activeTab === 'login' ? (
              t.signIn
            ) : (
              t.createAccountTitle
            )}
          </Button>
        </form>

        <div className="border-t border-border pt-3 text-center text-sm text-muted-foreground">
          {activeTab === 'login' ? (
            <>
              {t.dontHaveAccount}{' '}
              <button
                type="button"
                onClick={() => setActiveTab('register')}
                className="cursor-pointer font-medium text-primary hover:text-primary-active hover:underline"
              >
                {t.createOneNow}
              </button>
            </>
          ) : (
            <>
              {t.alreadyHaveAccount}{' '}
              <button
                type="button"
                onClick={() => setActiveTab('login')}
                className="cursor-pointer font-medium text-primary hover:text-primary-active hover:underline"
              >
                {t.signInHere}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  )

  if (inline) {
    return cardContent
  }

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#181715]/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      {cardContent}
    </div>
  )
}
