"use client"

import * as React from "react"

import { FormField } from "@/components/ui/form-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface SelectFieldOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

interface SelectFieldProps
  extends Omit<React.ComponentProps<typeof Select>, "children"> {
  label: React.ReactNode
  options: SelectFieldOption[]
  placeholder?: string
  description?: React.ReactNode
  error?: React.ReactNode
  className?: string
  triggerClassName?: string
}

function SelectField({
  label,
  options,
  placeholder,
  description,
  error,
  className,
  triggerClassName,
  ...props
}: SelectFieldProps) {
  return (
    <FormField label={label} description={description} error={error} className={className}>
      <Select {...props}>
        <SelectTrigger
          aria-invalid={Boolean(error) || undefined}
          className={cn("w-full rounded-lg border-border/80 bg-background", triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export { SelectField }
