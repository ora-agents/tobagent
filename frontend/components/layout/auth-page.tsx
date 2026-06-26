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
            <Image src="/logo.png" alt="威思瑞 WSIRI" width={126} height={80} priority className="h-12 w-auto" />
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
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.026)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
          <div className="relative flex h-full items-center justify-center p-12">
            <section className="w-full max-w-xl space-y-8">
              <div className="inline-flex rounded-full bg-primary-soft px-3 py-1.5 text-xs font-medium text-primary">
                {t.loginBadge}
              </div>

              <div className="space-y-5">
                <h1 className="max-w-lg font-display text-6xl font-medium leading-[1.02] tracking-normal text-foreground">
                  {t.loginHeadline}
                </h1>
                <p className="max-w-lg text-base leading-7 text-muted-foreground">{t.loginDescription}</p>
              </div>

              <div className="rounded-2xl bg-card p-4 shadow-depth-md">
                <div className="rounded-xl bg-secondary p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{t.loginBrandName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t.loginBrandSub}</div>
                    </div>
                    <Image src="/logo.png" alt="" width={96} height={62} className="h-9 w-auto" />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      [t.loginMetricScene, t.loginMetricSceneDesc],
                      [t.loginMetricKnowledge, t.loginMetricKnowledgeDesc],
                      [t.loginMetricTools, t.loginMetricToolsDesc],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-card p-3">
                        <div className="font-mono text-xs text-primary">{label}</div>
                        <div className="mt-2 text-sm leading-5 text-muted-foreground">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}
