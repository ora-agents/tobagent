"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface SettingsSwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: React.ReactNode
  description?: React.ReactNode
  size?: "default" | "lg"
}

function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  className,
  size = "default",
  disabled,
  ...props
}: SettingsSwitchProps) {
  const isLarge = size === "lg"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-background/60 text-left outline-none transition-colors",
        "border-border/60 hover:border-primary/35 hover:bg-background focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
        "disabled:pointer-events-none disabled:opacity-50",
        checked && "border-primary/35 bg-primary/5",
        isLarge ? "p-5" : "p-3.5",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "relative mt-0.5 shrink-0 overflow-hidden rounded-full transition-colors",
          isLarge ? "h-8 w-14" : "h-5 w-9",
          checked ? "bg-primary" : "bg-muted-foreground/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 rounded-full bg-background shadow-sm transition-transform",
            isLarge ? "h-7 w-7" : "h-4 w-4",
            checked
              ? isLarge
                ? "translate-x-6"
                : "translate-x-4"
              : "translate-x-0.5"
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-semibold text-foreground", isLarge ? "text-lg" : "text-sm")}>
          {label}
        </span>
        {description && (
          <span
            className={cn(
              "mt-1 block text-muted-foreground",
              isLarge ? "text-base leading-7" : "text-xs leading-relaxed"
            )}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  )
}

export { SettingsSwitch }
