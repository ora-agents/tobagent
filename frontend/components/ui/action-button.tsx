"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ActionButtonProps = React.ComponentProps<typeof Button>

function ActionButton({
  className,
  variant = "default",
  size = "default",
  ...props
}: ActionButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "rounded-lg font-medium shadow-none",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary-active",
        variant === "outline" &&
          "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        variant === "destructive" &&
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        className
      )}
      {...props}
    />
  )
}

export { ActionButton }
