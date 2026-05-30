import { cn } from "@/lib/utils"

interface LoadingPlaceholderProps {
  className?: string
  label?: string
}

export function LoadingPlaceholder({ className, label }: LoadingPlaceholderProps) {
  return (
    <div
      className={cn(
        "loading-placeholder relative overflow-hidden rounded-md border border-border/70 bg-muted/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
        className
      )}
      aria-busy={label ? true : undefined}
      aria-label={label}
      role={label ? "status" : undefined}
    />
  )
}
