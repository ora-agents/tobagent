import * as React from "react"

import { cn } from "@/lib/utils"

interface PageSectionProps extends React.HTMLAttributes<HTMLElement> {
  tone?: "default" | "primary" | "soft" | "dark"
  density?: "default" | "compact" | "roomy"
}

const PageSection = React.forwardRef<HTMLElement, PageSectionProps>(
  ({ className, tone = "default", density = "default", ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "rounded-xl border",
        tone === "default" && "border-border/60 bg-card text-card-foreground",
        tone === "primary" && "border-primary/20 bg-primary/5 text-card-foreground",
        tone === "soft" && "border-border/45 bg-secondary/60 text-card-foreground",
        tone === "dark" && "border-border/25 bg-background-tint text-foreground",
        density === "compact" && "space-y-3 p-4",
        density === "default" && "space-y-4 p-5",
        density === "roomy" && "space-y-5 p-6",
        className,
      )}
      {...props}
    />
  ),
)
PageSection.displayName = "PageSection"

interface PageSectionTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  icon?: React.ComponentType<{ className?: string }>
  compact?: boolean
}

function PageSectionTitle({
  className,
  icon: Icon,
  compact = false,
  children,
  ...props
}: PageSectionTitleProps) {
  return (
    <h3
      className={cn(
        "flex items-center gap-1.5 font-bold text-muted-foreground",
        compact ? "text-xs uppercase tracking-wider" : "text-base",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={cn(compact ? "h-3.5 w-3.5" : "h-5 w-5", "text-primary")} />}
      {children}
    </h3>
  )
}

export { PageSection, PageSectionTitle }
