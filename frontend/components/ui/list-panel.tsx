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
        "flex max-h-[42dvh] min-h-0 w-full flex-shrink-0 flex-col border-b border-border/50 bg-background/50 md:max-h-none md:w-[300px] md:border-b-0 md:border-r",
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
