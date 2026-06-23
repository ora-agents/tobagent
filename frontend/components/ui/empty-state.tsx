import * as React from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/40 p-6 text-center",
        className
      )}
      {...props}
    >
      <div className="max-w-sm">
        {icon && <div className="mx-auto mb-3 flex justify-center text-muted-foreground/45">{icon}</div>}
        {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
        {children}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

export { EmptyState }
