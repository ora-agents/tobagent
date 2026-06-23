"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ToolbarButtonProps = Omit<React.ComponentProps<typeof Button>, "variant"> & {
  active?: boolean
  destructive?: boolean
}

function ToolbarButton({
  className,
  active = false,
  destructive = false,
  size = "icon-sm",
  ...props
}: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size={size}
      className={cn(
        "rounded-md text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
        active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
        className
      )}
      {...props}
    />
  )
}

export { ToolbarButton }
