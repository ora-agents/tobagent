import * as React from "react"

import { cn } from "@/lib/utils"

type AppShellProps = React.HTMLAttributes<HTMLDivElement>

function AppShell({ className, ...props }: AppShellProps) {
  return (
    <div
      className={cn("flex h-dvh overflow-hidden bg-background text-foreground", className)}
      {...props}
    />
  )
}

function AppMain({ className, ...props }: AppShellProps) {
  return <main className={cn("min-w-0 flex-1 overflow-hidden", className)} {...props} />
}

function AppHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <header
      className={cn(
        "flex h-16 shrink-0 items-center border-b border-border/60 bg-background/95 px-4 backdrop-blur sm:px-6",
        className,
      )}
      {...props}
    />
  )
}

function AppSidebar({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border/60 text-sidebar-foreground md:flex",
        className,
      )}
      {...props}
    />
  )
}

export { AppHeader, AppMain, AppShell, AppSidebar }
