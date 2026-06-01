import { cn } from "@/lib/utils"

interface LoadingPlaceholderProps {
  className?: string
  label?: string
  variant?: "text" | "button" | "avatar" | "thread" | "input" | "card"
}

const variantClasses: Record<NonNullable<LoadingPlaceholderProps["variant"]>, string> = {
  text: "h-3 rounded-full",
  button: "h-9 rounded-lg",
  avatar: "size-8 rounded-full",
  thread: "h-10 rounded-lg",
  input: "h-10 rounded-lg",
  card: "rounded-xl",
}

export function LoadingPlaceholder({ className, label, variant = "text" }: LoadingPlaceholderProps) {
  return (
    <div
      className={cn(
        "loading-placeholder relative overflow-hidden border border-border/60 bg-muted/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]",
        variantClasses[variant],
        className
      )}
      aria-busy={label ? true : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
    />
  )
}

export function ThreadSkeleton({ label }: { label?: string }) {
  return (
    <div
      className="flex h-10 items-center gap-2.5 rounded-lg border border-transparent px-3"
      aria-busy={label ? true : undefined}
      aria-label={label}
      role={label ? "status" : undefined}
    >
      <LoadingPlaceholder variant="avatar" className="size-5 flex-shrink-0 opacity-80" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <LoadingPlaceholder className="h-2.5 w-full" />
        <LoadingPlaceholder className="h-2 w-2/3 opacity-70" />
      </div>
    </div>
  )
}

export function ComboboxSkeleton({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 min-w-36 items-center gap-2 rounded-md border border-border/60 bg-background/75 px-2.5 shadow-sm",
        className
      )}
      aria-busy={label ? true : undefined}
      aria-label={label}
      role={label ? "status" : undefined}
    >
      <LoadingPlaceholder className="h-2.5 w-9 flex-shrink-0 opacity-65" />
      <LoadingPlaceholder className="h-2.5 w-16 flex-1" />
      <LoadingPlaceholder className="size-3 flex-shrink-0 rounded-sm opacity-55" />
    </div>
  )
}
