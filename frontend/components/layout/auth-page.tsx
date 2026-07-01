'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AuthPanel } from '@/components/layout/auth-panel'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPlaceholder } from '@/components/ui/loading-placeholder'
import { normalizeLangGraphApiUrl, useApiConfig } from '@/lib/config/api-config'
import { useT } from '@/lib/i18n'
import logoImage from '@/public/logo.png'
import { RotateCcw, Save, ServerCog } from 'lucide-react'

interface AuthPageProps {
  mode: 'login' | 'register'
}

function AuthPageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background-tint" aria-busy="true" role="status">
      <LoadingPlaceholder variant="button" className="h-12 w-48" />
    </div>
  )
}

function DesktopBackendDialog({ onBackendChanged }: { onBackendChanged: () => void }) {
  const { apiUrl, defaultApiUrl, isDesktopRuntime, loading, setApiUrl, resetApiUrl } = useApiConfig()
  const [open, setOpen] = useState(false)
  const [draftUrl, setDraftUrl] = useState(apiUrl)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setDraftUrl(apiUrl)
  }, [apiUrl, open])

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
      setOpen(false)
    } catch (err: any) {
      console.error('[API Config] Failed to save backend URL:', err)
      setError(err?.message || '后端地址保存失败')
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
      setOpen(false)
    } catch (err: any) {
      console.error('[API Config] Failed to reset backend URL:', err)
      setError(err?.message || '后端地址保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm" disabled={loading} className="h-9 rounded-lg">
          <ServerCog data-icon="inline-start" />
          后端
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>后端地址</DialogTitle>
          <DialogDescription>{apiUrl}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="desktop-backend-url">API URL</Label>
          <Input
            id="desktop-backend-url"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="https://gen.wsiri.cn"
            disabled={saving}
            aria-invalid={Boolean(error)}
          />
          {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={handleReset} disabled={saving}>
            <RotateCcw data-icon="inline-start" />
            默认
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            <Save data-icon="inline-start" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AuthPage({ mode }: AuthPageProps) {
  const t = useT()
  const router = useRouter()
  const { user, loading, logout, clearError } = useAuth()

  useEffect(() => {
    if (!loading && user) {
      router.replace('/')
    }
  }, [loading, router, user])

  if (loading || user) {
    return <AuthPageFallback />
  }

  return (
    <div className="min-h-svh bg-background p-4 text-foreground sm:p-6 lg:p-8">
      <div className="grid min-h-[calc(100svh-2rem)] overflow-hidden rounded-2xl bg-card shadow-depth-sm sm:min-h-[calc(100svh-3rem)] lg:min-h-[calc(100svh-4rem)] lg:grid-cols-2">
        <main className="flex min-h-0 flex-col gap-8 px-6 py-7 sm:px-10 lg:px-14 lg:py-10">
          <div className="flex justify-center gap-3 md:justify-start">
            <div className="flex min-w-0 flex-1 items-center justify-center gap-3 md:justify-start">
              <Image src={logoImage} alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" draggable={false} />
              <div>
                <div className="text-sm font-medium tracking-tight">{t.loginBrandName}</div>
                <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
              </div>
            </div>
            <DesktopBackendDialog onBackendChanged={() => {
              logout()
              clearError()
            }} />
          </div>

          <div className="flex flex-1 items-center justify-center">
            <AuthPanel
              open={true}
              onOpenChange={() => {}}
              inline
              mode={mode}
              onModeChange={(nextMode) => router.push(nextMode === 'login' ? '/login' : '/register')}
              onAuthenticated={() => router.replace('/')}
            />
          </div>
        </main>

        <aside className="relative hidden min-h-0 overflow-hidden bg-background-tint lg:block">
          <div className="flex h-full items-center justify-center px-8 py-10 xl:px-12">
            <Image
              src="/login_sidepic.svg"
              alt=""
              width={2500}
              height={1500}
              priority
              className="h-auto w-full max-w-[min(48vw,900px)] object-contain"
              draggable={false}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
