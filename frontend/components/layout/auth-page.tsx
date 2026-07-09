'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AuthPanel } from '@/components/layout/auth-panel'
import { SiteComplianceFooter } from '@/components/layout/site-compliance-footer'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPlaceholder } from '@/components/ui/loading-placeholder'
import { PageSection, PageSectionTitle } from '@/components/ui/page-section'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusNotice } from '@/components/ui/status-notice'
import { normalizeLangGraphApiUrl, useApiConfig } from '@/lib/config/api-config'
import { useI18n, useT } from '@/lib/i18n'
import logoImage from '@/public/logo.png'
import { Home, LogIn, RotateCcw, Save, ServerCog } from 'lucide-react'

interface AuthPageProps {
  mode: 'login' | 'register' | 'reset'
}

function AuthPageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background-tint" aria-busy="true" role="status">
      <LoadingPlaceholder variant="button" className="h-12 w-48" />
    </div>
  )
}

function DesktopBackendAddressSection({
  zh,
  onBackendChanged,
}: {
  zh: boolean
  onBackendChanged: () => void
}) {
  const { apiUrl, defaultApiUrl, isDesktopRuntime, loading, setApiUrl, resetApiUrl } = useApiConfig()
  const [draftUrl, setDraftUrl] = useState(apiUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraftUrl(apiUrl)
  }, [apiUrl])

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 1600)
    return () => window.clearTimeout(timer)
  }, [saved])

  if (!isDesktopRuntime) return null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    let nextUrl: string
    try {
      nextUrl = normalizeLangGraphApiUrl(draftUrl)
    } catch (err: any) {
      setError(err?.message || '后端地址无效')
      setSaving(false)
      return
    }

    try {
      const changed = nextUrl !== apiUrl
      await setApiUrl(nextUrl)
      if (changed) onBackendChanged()
      setSaved(true)
    } catch (err: any) {
      console.error('[API Config] Failed to save backend URL:', err)
      setError(err?.message || (zh ? '后端地址保存失败' : 'Failed to save backend URL'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    setError(null)
    try {
      const changed = apiUrl !== defaultApiUrl
      await resetApiUrl()
      setDraftUrl(defaultApiUrl)
      if (changed) onBackendChanged()
      setSaved(true)
    } catch (err: any) {
      console.error('[API Config] Failed to reset backend URL:', err)
      setError(err?.message || (zh ? '后端地址保存失败' : 'Failed to save backend URL'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageSection density="compact" className="w-full shadow-none">
      <PageSectionTitle icon={ServerCog} compact>
        {zh ? '后端地址' : 'Backend URL'}
      </PageSectionTitle>
      {error && <StatusNotice tone="error">{error}</StatusNotice>}
      {saved && <StatusNotice tone="success">{zh ? '后端地址已保存' : 'Backend URL saved'}</StatusNotice>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="desktop-backend-url" className="text-xs font-semibold text-muted-foreground">
          API URL
        </Label>
        <Input
          id="desktop-backend-url"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          placeholder="https://gen.wsiri.cn"
          disabled={saving || loading}
          aria-invalid={Boolean(error)}
          className="bg-secondary text-sm"
        />
        <div className="truncate text-xs text-muted-foreground">
          {zh ? '当前：' : 'Current: '}{apiUrl}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleReset} disabled={saving || loading} className="rounded-lg">
          <RotateCcw data-icon="inline-start" />
          {zh ? '默认' : 'Default'}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving || loading} className="rounded-lg">
          <Save data-icon="inline-start" />
          {zh ? '保存' : 'Save'}
        </Button>
      </div>
    </PageSection>
  )
}

export function AuthPage({ mode }: AuthPageProps) {
  const t = useT()
  const { locale } = useI18n()
  const router = useRouter()
  const { user, loading, logout, clearError } = useAuth()
  const { isDesktopRuntime } = useApiConfig()
  const zh = locale === 'zh'
  const [activeView, setActiveView] = useState<'login' | 'backend'>('login')
  const [authMode, setAuthMode] = useState<AuthPageProps['mode']>(mode)

  useEffect(() => {
    setAuthMode(mode)
  }, [mode])

  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, router, user])

  if (user || (loading && !isDesktopRuntime)) {
    return <AuthPageFallback />
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background p-3 text-foreground sm:p-4 lg:p-6">
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl bg-card shadow-depth-sm lg:grid-cols-[minmax(25rem,0.95fr)_minmax(24rem,1.05fr)]">
        <main className="relative flex min-h-0 flex-col gap-5 px-6 py-6 sm:px-10 lg:px-14 lg:py-8">
          <div className={`flex justify-center gap-3 md:justify-start ${activeView === 'login' ? 'absolute inset-x-6 top-6 z-10 sm:inset-x-10 lg:inset-x-14 lg:top-8' : ''}`}>
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 md:justify-start">
              <Image src={logoImage} alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" draggable={false} />
              <div>
                <div className="text-sm font-medium tracking-tight">{t.loginBrandName}</div>
                <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
              </div>
            </div>
            <Button asChild variant="secondary" size="sm" className="h-9 shrink-0 rounded-lg">
              <Link href="/" aria-label={zh ? '返回首页' : 'Back to home'}>
                <Home data-icon="inline-start" />
                {zh ? '首页' : 'Home'}
              </Link>
            </Button>
            {isDesktopRuntime && (
              <Button
                type="button"
                variant={activeView === 'backend' ? 'outline' : 'secondary'}
                size="sm"
                onClick={() => setActiveView((view) => (view === 'backend' ? 'login' : 'backend'))}
                className="h-9 shrink-0 rounded-lg"
              >
                {activeView === 'backend' ? <LogIn data-icon="inline-start" /> : <ServerCog data-icon="inline-start" />}
                {activeView === 'backend' ? (zh ? '登录' : 'Login') : (zh ? '后端' : 'Backend')}
              </Button>
            )}
          </div>

          {activeView === 'login' ? (
            <div className="absolute inset-0 flex min-h-0 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-24 sm:px-10 lg:px-14">
              {loading && (
                <div className="w-full max-w-sm rounded-lg bg-secondary px-3 py-2 text-center text-xs text-muted-foreground">
                  {zh ? '正在检查当前后端会话，本地部署工具可直接使用。' : 'Checking the current backend session. Local deployment tools remain available.'}
                </div>
              )}
              <AuthPanel
                open={true}
                onOpenChange={() => {}}
                inline
                mode={authMode}
                onModeChange={(nextMode) => {
                  setAuthMode(nextMode)
                  router.push(nextMode === 'login' ? '/login' : nextMode === 'register' ? '/register' : '/forgot-password')
                }}
                onAuthenticated={() => router.replace('/')}
              />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1" viewportClassName="pr-3">
              <div className="flex min-h-full flex-col items-center justify-start gap-5 py-2">
                <div className="flex w-full max-w-xl flex-col gap-4">
                  <DesktopBackendAddressSection
                    zh={zh}
                    onBackendChanged={() => {
                      logout()
                      clearError()
                    }}
                  />
                </div>
              </div>
            </ScrollArea>
          )}
        </main>

        <aside className="relative hidden min-h-0 overflow-hidden bg-background-tint lg:block">
          <div className="relative h-full min-h-0 w-full">
            <Image
              src="/login_sidepic.svg"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 0vw"
              className="object-contain p-8 xl:p-12"
              draggable={false}
            />
          </div>
        </aside>
      </div>
      <SiteComplianceFooter className="pt-2" />
    </div>
  )
}
