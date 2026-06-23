import * as React from "react"

import { cn } from "@/lib/utils"

interface ListPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

function ListPanel({ title, action, children, className, ...props }: ListPanelProps) {
  return (
    <aside
      className={cn(
        "flex w-[300px] flex-shrink-0 flex-col border-r border-border/50 bg-background/50",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {action}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">{children}</div>
    </aside>
  )
}

export { ListPanel }
