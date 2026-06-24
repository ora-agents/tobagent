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
        "rounded-xl",
        tone === "default" && "bg-card text-card-foreground shadow-depth-xs",
        tone === "primary" && "bg-primary-soft text-card-foreground dark:bg-card",
        tone === "soft" && "bg-secondary text-card-foreground",
        tone === "dark" && "bg-background-tint text-foreground",
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
        "flex items-center gap-2 font-semibold text-foreground",
        compact ? "text-base" : "text-lg",
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={cn(compact ? "h-4 w-4" : "h-5 w-5", "text-primary")} />}
      {children}
    </h3>
  )
}

export { PageSection, PageSectionTitle }
