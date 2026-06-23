import * as React from "react"

import { cn } from "@/lib/utils"

interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ComponentType<{ className?: string }>
  active?: boolean
  collapsed?: boolean
  label?: React.ReactNode
}

function NavItem({
  className,
  icon: Icon,
  active = false,
  collapsed = false,
  label,
  children,
  ...props
}: NavItemProps) {
  return (
    <button
      className={cn(
        "group rounded-lg border text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
        collapsed
          ? "inline-flex h-10 w-10 items-center justify-center"
          : "flex w-full items-center gap-3 px-3 py-2 text-left",
        active
          ? "border-primary/20 bg-primary/15 font-medium text-primary"
          : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent/30 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          className={cn(
            collapsed ? "h-5 w-5" : "h-4 w-4",
            "shrink-0 text-muted-foreground/80 transition-colors group-hover:text-primary",
            active && "text-primary",
          )}
        />
      )}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label ?? children}</span>}
      {collapsed ? children : null}
    </button>
  )
}

export { NavItem }
