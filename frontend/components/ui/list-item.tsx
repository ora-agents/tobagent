import * as React from "react"

import { cn } from "@/lib/utils"

interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  selected?: boolean
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  onSelect?: () => void
}

function ListItem({
  selected = false,
  title,
  description,
  icon,
  meta,
  actions,
  className,
  children,
  onClick,
  onSelect,
  onKeyDown,
  ...props
}: ListItemProps) {
  const interactive = Boolean(onClick || onSelect)

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onSelect?.()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!interactive || event.defaultPrevented) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect?.()
        }
      }}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-lg border p-3 pr-20 text-left outline-none transition-colors",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
        selected
          ? "border-primary/50 bg-primary/5 text-foreground"
          : "border-border/70 bg-background/40 text-foreground hover:border-primary/30 hover:bg-muted/20",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {description && (
          <span className="mt-1 block truncate text-xs text-muted-foreground">{description}</span>
        )}
        {meta && <span className="mt-2 flex flex-wrap gap-1">{meta}</span>}
        {children}
      </span>
      {actions && (
        <span
          className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      )}
    </div>
  )
}

export { ListItem }
