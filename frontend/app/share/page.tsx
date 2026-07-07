import { Suspense } from "react"

import { AgentShareLandingPageFromSearch } from "@/components/marketing/agent-share-landing-page"
import { DashboardFallback } from "@/components/layout/dashboard-fallback"

export default function SharePage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <AgentShareLandingPageFromSearch />
    </Suspense>
  )
}
