import { cn } from "@/lib/utils"

interface LoadingPlaceholderProps {
  className?: string
  label?: string
}

export function LoadingPlaceholder({ className, label }: LoadingPlaceholderProps) {
  return (
    <div
      className={cn(
        "loading-placeholder relative overflow-hidden rounded-md border border-border/60 bg-muted/70",
        className
      )}
      aria-label={label}
      role={label ? "status" : undefined}
    />
  )
}
