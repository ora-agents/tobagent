"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  visibilityLabel?: string
  hiddenLabel?: string
}

function PasswordInput({
  className,
  visibilityLabel = "Show password",
  hiddenLabel = "Hide password",
  disabled,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false)
  const label = visible ? hiddenLabel : visibilityLabel
  const Icon = visible ? EyeOff : Eye

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-10", className)}
      />
      <Button
        type="button"
        variant="unstyled"
        className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
        onClick={() => setVisible((value) => !value)}
        disabled={disabled}
        aria-label={label}
        title={label}
      >
        <Icon />
      </Button>
    </div>
  )
}

export { PasswordInput }
