import type * as React from "react"

import { AppMain, AppShell } from "@/components/ui/app-shell"
import { cn } from "@/lib/utils"

interface DashboardWorkspaceProps {
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
  mobileSidebar?: React.ReactNode
  sidebar?: React.ReactNode
}

export function DashboardWorkspace({ children, className, footer, mobileSidebar, sidebar }: DashboardWorkspaceProps) {
  return (
    <AppShell className={className}>
      {sidebar}
      {mobileSidebar}
      <AppMain className="flex min-h-0 flex-col bg-background">
        {children}
        {footer}
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
