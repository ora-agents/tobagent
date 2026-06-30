import * as React from "react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ListPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
}

function ListPanel({ title, action, children, className, contentClassName, ...props }: ListPanelProps) {
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
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn("flex flex-col gap-2 p-3", contentClassName)}>{children}</div>
      </ScrollArea>
    </aside>
  )
}

export { ListPanel }
