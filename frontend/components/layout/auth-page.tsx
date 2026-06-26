'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AuthPanel } from '@/components/layout/auth-panel'
import { useAuth } from '@/components/providers/auth-provider'
import { LoadingPlaceholder } from '@/components/ui/loading-placeholder'
import { useT } from '@/lib/i18n'

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

export function AuthPage({ mode }: AuthPageProps) {
  const t = useT()
  const router = useRouter()
  const { user, loading } = useAuth()

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
            <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" draggable={false} />
            <div>
              <div className="text-sm font-medium tracking-tight">{t.loginBrandName}</div>
              <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
            </div>
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
