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
  mode?: 'login' | 'register'
  onModeChange?: (mode: 'login' | 'register') => void
  onAuthenticated?: () => void
}

export function AuthPanel({
  open,
  onOpenChange,
  inline = false,
  mode,
  onModeChange,
  onAuthenticated,
}: AuthPanelProps) {
  const t = useT()
  const { login, register, error, clearError } = useAuth()

  const [internalTab, setInternalTab] = useState<'login' | 'register'>(mode ?? 'login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const activeTab = mode ?? internalTab

  const setActiveTab = (nextMode: 'login' | 'register') => {
    setInternalTab(nextMode)
    onModeChange?.(nextMode)
  }

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
      onAuthenticated?.()
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
      className="relative w-full max-w-[29rem] overflow-hidden rounded-2xl bg-card p-6 shadow-depth-lg sm:p-7 dark:bg-card"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />

      <div className="relative space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            {!inline && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-muted"
                aria-label="Close auth panel"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-4xl font-medium leading-[1.05] tracking-normal text-foreground">
              {title}
            </h2>
            <p className="max-w-sm text-sm leading-5 text-foreground/75">
              {description}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-lg bg-secondary p-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setActiveTab('login')}
            className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
              activeTab === 'login'
                ? 'bg-card text-primary shadow-depth-xs'
                : 'text-foreground hover:bg-background hover:text-foreground'
            }`}
          >
            {t.signIn}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setActiveTab('register')}
            className={`rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
              activeTab === 'register'
                ? 'bg-card text-primary shadow-depth-xs'
                : 'text-foreground hover:bg-background hover:text-foreground'
            }`}
          >
            {t.register}
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {shownError && (
            <div className="flex items-center gap-2.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="whitespace-pre-line font-medium">{shownError}</div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="username" className="text-xs font-medium text-foreground">
              {t.username} <span className="text-destructive">*</span>
            </Label>
            <div className="group relative">
              <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-all duration-200 group-focus-within:text-primary">
                <User className="h-4 w-4" />
              </span>
              <Input
                id="username"
                type="text"
                placeholder={t.enterUsername}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                className="h-10 rounded-md bg-secondary pl-9 text-sm text-foreground transition-all duration-200 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15"
                required
              />
            </div>
          </div>

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-foreground">
                {t.email}
              </Label>
              <div className="group relative">
                <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-all duration-200 group-focus-within:text-primary">
                  <Mail className="h-4 w-4" />
                </span>
                <Input
                  id="email"
                  type="email"
                  placeholder={t.enterEmailOptional}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="h-10 rounded-md bg-secondary pl-9 text-sm text-foreground transition-all duration-200 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-medium text-foreground">
              {t.password} <span className="text-destructive">*</span>
            </Label>
            <div className="group relative">
              <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-all duration-200 group-focus-within:text-primary">
                <Lock className="h-4 w-4" />
              </span>
              <Input
                id="password"
                type="password"
                placeholder={t.enterPassword}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="h-10 rounded-md bg-secondary pl-9 text-sm text-foreground transition-all duration-200 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15"
                required
              />
            </div>
          </div>

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-medium text-foreground">
                {t.confirmPassword} <span className="text-destructive">*</span>
              </Label>
              <div className="group relative">
                <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground transition-all duration-200 group-focus-within:text-primary">
                  <Lock className="h-4 w-4" />
                </span>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t.confirmPasswordPlaceholder}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="h-10 rounded-md bg-secondary pl-9 text-sm text-foreground transition-all duration-200 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-primary/15"
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

        <div className="pt-1 text-center text-sm text-foreground/75">
          {activeTab === 'login' ? (
            <>
              {t.dontHaveAccount}{' '}
              <Button
                type="button"
                variant="link"
                onClick={() => setActiveTab('register')}
                className="h-auto cursor-pointer p-0 font-medium text-primary hover:text-primary-active"
              >
                {t.createOneNow}
              </Button>
            </>
          ) : (
            <>
              {t.alreadyHaveAccount}{' '}
              <Button
                type="button"
                variant="link"
                onClick={() => setActiveTab('login')}
                className="h-auto cursor-pointer p-0 font-medium text-primary hover:text-primary-active"
              >
                {t.signInHere}
              </Button>
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
