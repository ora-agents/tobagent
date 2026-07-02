import { AppHeader, AppMain, AppShell, AppSidebar } from "@/components/ui/app-shell"
import { LoadingPlaceholder } from "@/components/ui/loading-placeholder"

export function DashboardFallback() {
  return (
    <AppShell aria-busy="true" aria-label="Loading dashboard" role="status">
      <AppSidebar className="w-56 bg-sidebar">
        <div className="flex h-16 items-center border-b border-border/60 px-3">
          <LoadingPlaceholder variant="button" className="h-9 w-9" />
        </div>
        <div className="flex flex-col gap-3 px-3 py-4">
          <LoadingPlaceholder variant="input" className="h-10 w-full" />
          <div className="flex flex-col gap-2 pt-2">
            <LoadingPlaceholder className="h-2.5 w-16" />
            <LoadingPlaceholder variant="thread" className="w-full" />
            <LoadingPlaceholder variant="thread" className="w-[92%]" />
            <LoadingPlaceholder variant="thread" className="w-[84%]" />
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-2 border-t border-border/40 px-3 py-3">
          <LoadingPlaceholder variant="button" className="h-9 w-full" />
          <LoadingPlaceholder variant="button" className="h-9 w-4/5" />
        </div>
      </AppSidebar>

      <AppMain className="flex flex-col">
        <AppHeader className="justify-between">
          <div className="flex items-center gap-3">
            <LoadingPlaceholder variant="button" className="h-9 w-9 md:hidden" />
            <LoadingPlaceholder className="h-4 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <LoadingPlaceholder variant="button" className="h-9 w-9" />
            <LoadingPlaceholder variant="button" className="h-9 w-24" />
          </div>
        </AppHeader>

        <main className="flex flex-1 items-center justify-center px-4">
          <div className="-mt-20 w-full max-w-3xl">
            <LoadingPlaceholder className="mx-auto mb-8 h-9 w-64 sm:h-12 sm:w-96" />
            <div className="rounded-xl bg-card p-3 shadow-depth-sm">
              <LoadingPlaceholder className="mb-3 h-4 w-3/4" />
              <div className="flex items-end gap-2">
                <LoadingPlaceholder variant="button" className="h-9 w-9 rounded-full" />
                <LoadingPlaceholder variant="input" className="h-11 flex-1 border-0" />
                <LoadingPlaceholder variant="button" className="h-9 w-20 rounded-full" />
              </div>
            </div>
            <div className="mt-3 flex gap-3 px-2">
              <LoadingPlaceholder variant="button" className="h-8 w-36" />
              <LoadingPlaceholder variant="button" className="h-8 w-32" />
            </div>
          </div>
        </main>
      </AppMain>
    </AppShell>
  )
}
