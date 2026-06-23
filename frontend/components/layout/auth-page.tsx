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
    <div className="flex h-screen items-center justify-center bg-background" aria-busy="true" role="status">
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
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto grid h-full w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_0.9fr]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-28 border-b border-border/80 bg-background-tint" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.028)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:linear-gradient(to_bottom,#000_0%,transparent_78%)]" />
        </div>

        <main className="relative hidden min-h-0 flex-col justify-between px-6 py-7 sm:px-10 lg:flex lg:px-14 lg:py-10">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" />
            <div>
              <div className="text-sm font-medium tracking-tight">{t.loginBrandName}</div>
              <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
            </div>
          </div>

          <section className="max-w-2xl py-8">
            <div className="mb-5 inline-flex rounded-full border border-primary/15 bg-primary-soft px-3 py-1.5 text-xs font-medium tracking-[0.12em] text-primary dark:bg-card">
              {t.loginBadge}
            </div>
            <h1 className="font-display text-[4.8rem] font-medium leading-[0.95] tracking-normal text-foreground">
              {t.loginHeadline}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">{t.loginDescription}</p>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            {[
              [t.loginMetricScene, t.loginMetricSceneDesc],
              [t.loginMetricKnowledge, t.loginMetricKnowledgeDesc],
              [t.loginMetricTools, t.loginMetricToolsDesc],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-depth-xs dark:bg-card">
                <div className="font-mono text-xs text-primary">{label}</div>
                <div className="mt-2 text-sm text-muted-foreground">{value}</div>
              </div>
            ))}
          </section>
        </main>

        <aside className="relative flex min-h-0 items-center justify-center px-5 py-5 sm:px-8 lg:px-12 lg:py-10">
          <div className="absolute inset-y-10 left-0 hidden w-px bg-border lg:block" />
          <div className="w-full max-w-[31rem] space-y-4">
            <div className="flex items-center gap-3 lg:hidden">
              <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" />
              <div>
                <div className="text-sm font-medium">{t.loginBrandName}</div>
                <div className="text-xs text-muted-foreground">{t.loginBrandSub}</div>
              </div>
            </div>

            <AuthPanel
              open={true}
              onOpenChange={() => {}}
              inline
              mode={mode}
              onModeChange={(nextMode) => router.push(nextMode === 'login' ? '/login' : '/register')}
              onAuthenticated={() => router.replace('/')}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
