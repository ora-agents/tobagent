import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface IconActionProps extends React.ComponentProps<typeof Button> {
  icon: React.ComponentType<{ className?: string }>
  active?: boolean
}

function IconAction({ className, icon: Icon, active = false, size = "icon", variant = "ghost", ...props }: IconActionProps) {
  return (
    <Button
      size={size}
      variant={variant}
      className={cn(
        "rounded-lg transition-all duration-200",
        active
          ? "border border-primary/20 bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className="h-5 w-5" />
    </Button>
  )
}

export { IconAction }
