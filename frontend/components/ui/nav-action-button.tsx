"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NavActionButtonProps = React.ComponentProps<typeof Button>

function NavActionButton({
  className,
  variant = "outline",
  size = "default",
  ...props
}: NavActionButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(
        "h-9 min-w-9 flex-shrink-0 rounded-lg px-2.5 text-sm font-medium shadow-depth-xs transition-all duration-200 sm:min-w-[7.5rem] sm:px-3",
        "gap-2 border-border/80 hover:bg-primary/10 hover:text-primary",
        className
      )}
      {...props}
    />
  )
}

export { NavActionButton }
