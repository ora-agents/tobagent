import type * as React from "react"

import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer"
import { AppMain, AppShell } from "@/components/ui/app-shell"
import { cn } from "@/lib/utils"

interface DashboardWorkspaceProps {
  children: React.ReactNode
  className?: string
  mobileSidebar?: React.ReactNode
  sidebar?: React.ReactNode
}

export function DashboardWorkspace({ children, className, mobileSidebar, sidebar }: DashboardWorkspaceProps) {
  return (
    <AppShell className={className}>
      {sidebar}
      {mobileSidebar}
      <AppMain className="flex min-h-0 flex-col bg-background">
        {children}
        <SiteComplianceFooter className="border-t border-border/60 bg-background py-2" />
      </AppMain>
    </AppShell>
  )
}

interface DashboardViewPaneProps {
  active?: boolean
  children: React.ReactNode
  className?: string
}

export function DashboardViewPane({ active = true, children, className }: DashboardViewPaneProps) {
  return (
    <div
      className={cn(active ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 flex-col", className)}
      aria-hidden={!active}
    >
      {children}
    </div>
  )
}
