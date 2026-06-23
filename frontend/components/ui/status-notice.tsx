import * as React from "react"
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
}

interface StatusNoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof icons
  compact?: boolean
  icon?: React.ComponentType<{ className?: string }>
}

function StatusNotice({
  className,
  tone = "info",
  compact = false,
  icon,
  children,
  ...props
}: StatusNoticeProps) {
  const Icon = icon ?? icons[tone]

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border font-medium",
        compact ? "px-3 py-2 text-sm" : "p-3 text-sm",
        tone === "info" && "border-primary/20 bg-primary/5 text-primary",
        tone === "success" && "border-success/20 bg-success/10 text-success",
        tone === "warning" && "border-warning/25 bg-warning/10 text-warning",
        tone === "error" && "border-destructive/20 bg-destructive/10 text-destructive",
        className,
      )}
      {...props}
    >
      <Icon className={cn(compact ? "h-4 w-4" : "h-4 w-4", "shrink-0")} />
      <div className="min-w-0 truncate">{children}</div>
    </div>
  )
}

export { StatusNotice }
