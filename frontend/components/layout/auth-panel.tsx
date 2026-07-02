'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/components/providers/auth-provider'
import { AlertCircle, Loader2, X } from 'lucide-react'
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
  const { login, register, sendSmsCode, capabilities, error, clearError } = useAuth()

  const [internalTab, setInternalTab] = useState<'login' | 'register'>(mode ?? 'login')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const activeTab = mode ?? internalTab
  const smsEnabled = capabilities.smsAuth
  const registerBlocked = activeTab === 'register' && !smsEnabled

  const setActiveTab = (nextMode: 'login' | 'register') => {
    if (nextMode === 'register' && !smsEnabled) return
    setInternalTab(nextMode)
    onModeChange?.(nextMode)
  }

  useEffect(() => {
    clearError()
    setLocalError(null)
  }, [activeTab, open, clearError])

  useEffect(() => {
    if (codeCooldown <= 0) return
    const timer = window.setTimeout(() => setCodeCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [codeCooldown])

  const accountInput = phone.trim()
  const normalizedPhone = accountInput.replace(/\s+/g, '').replace(/-/g, '')

  const handleSendCode = async () => {
    setLocalError(null)
    if (!smsEnabled) {
      setLocalError(t.smsAuthUnavailable)
      return
    }
    if (!normalizedPhone) {
      setLocalError(t.enterPhone)
      return
    }
    setSendingCode(true)
    try {
      await sendSmsCode(normalizedPhone, 'register')
      setCodeCooldown(60)
    } catch {
      // AuthProvider owns the network error message.
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (
      registerBlocked
      || (activeTab === 'login' && (!accountInput || !password.trim()))
      || (activeTab === 'register' && (!username.trim() || !smsCode.trim() || !password.trim() || !confirmPassword.trim()))
    ) {
      setLocalError(registerBlocked ? t.smsAuthUnavailable : t.fillRequiredFields)
      return
    }
    if (password.trim().length < 6) {
      setLocalError(t.passwordMinLength)
      return
    }
    if (activeTab === 'register' && password.trim() !== confirmPassword.trim()) {
      setLocalError(t.passwordsDoNotMatch)
      return
    }

    setLoading(true)
    try {
      if (activeTab === 'login') {
        await login(accountInput, password.trim())
      } else {
        await register(username.trim(), normalizedPhone, smsCode.trim(), password.trim())
      }
      onOpenChange(false)
      setUsername('')
      setPhone('')
      setSmsCode('')
      setPassword('')
      setConfirmPassword('')
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
  const sectionClassName = inline
    ? 'relative w-full max-w-sm'
    : 'relative w-full max-w-[29rem] overflow-hidden rounded-2xl bg-card p-7 shadow-depth-lg sm:p-8 dark:bg-card'

  const cardContent = (
    <section
      aria-label={title}
      className={sectionClassName}
    >
      {!inline && <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-primary" />}

      <div className="relative space-y-6">
        <div className="space-y-4">
          {!inline && (
            <div className="flex items-center justify-end">
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
            </div>
          )}

          <div className={inline ? 'flex flex-col items-center gap-1 text-center' : 'space-y-2.5'}>
            <p className={inline ? 'text-balance text-sm leading-6 text-muted-foreground' : 'max-w-sm text-sm leading-6 text-muted-foreground'}>
              {description}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {shownError && (
            <div className="flex items-center gap-2.5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="whitespace-pre-line font-medium">{shownError}</div>
            </div>
          )}

          {registerBlocked && !shownError && (
            <div className="flex items-center gap-2.5 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="font-medium">{t.smsAuthUnavailable}</div>
            </div>
          )}

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium text-foreground">
                {t.username} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="username"
                type="text"
                placeholder={t.enterUsername}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading || registerBlocked}
                className="h-11 rounded-lg bg-secondary px-3 text-sm text-foreground shadow-none transition-colors duration-200 hover:bg-muted focus-visible:bg-secondary"
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-sm font-medium text-foreground">
              {activeTab === 'login' ? t.accountOrPhone : t.phone} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="phone"
              type={activeTab === 'login' ? 'text' : 'tel'}
              inputMode={activeTab === 'login' ? 'text' : 'tel'}
              placeholder={activeTab === 'login' ? t.enterAccountOrPhone : t.enterPhone}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading || registerBlocked}
              className="h-11 rounded-lg bg-secondary px-3 text-sm text-foreground shadow-none transition-colors duration-200 hover:bg-muted focus-visible:bg-secondary"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium text-foreground">
              {t.password} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="password"
              type="password"
              placeholder={t.enterPassword}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading || registerBlocked}
              className="h-11 rounded-lg bg-secondary px-3 text-sm text-foreground shadow-none transition-colors duration-200 hover:bg-muted focus-visible:bg-secondary"
              required
            />
          </div>

          {activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground">
                {t.confirmPassword} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading || registerBlocked}
                className="h-11 rounded-lg bg-secondary px-3 text-sm text-foreground shadow-none transition-colors duration-200 hover:bg-muted focus-visible:bg-secondary"
                required
              />
            </div>
          )}

          {smsEnabled && activeTab === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="smsCode" className="text-sm font-medium text-foreground">
                {t.smsCode} <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="smsCode"
                  type="text"
                  inputMode="numeric"
                  placeholder={t.enterSmsCode}
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value)}
                  disabled={loading}
                  className="h-11 min-w-0 flex-1 rounded-lg bg-secondary px-3 text-sm text-foreground shadow-none transition-colors duration-200 hover:bg-muted focus-visible:bg-secondary"
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading || sendingCode || codeCooldown > 0}
                  onClick={handleSendCode}
                  className="h-11 shrink-0 rounded-lg px-3 text-sm"
                >
                  {sendingCode ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : codeCooldown > 0 ? (
                    `${codeCooldown}s`
                  ) : (
                    t.sendSmsCode
                  )}
                </Button>
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || registerBlocked}
            className="h-11 w-full cursor-pointer rounded-lg bg-primary text-sm font-medium text-primary-foreground shadow-depth-xs transition-all duration-200 hover:bg-primary-active hover:shadow-depth-hover active:bg-primary-active"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.pleaseWait}
              </>
            ) : activeTab === 'login' ? (
              t.loginSubmit
            ) : (
              t.createAccountTitle
            )}
          </Button>
        </form>

        <div className="pt-1 text-center text-sm text-muted-foreground">
          {activeTab === 'login' ? (
            smsEnabled ? (
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
            ) : null
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
