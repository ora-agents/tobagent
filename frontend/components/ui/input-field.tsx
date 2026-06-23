import * as React from "react"

import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type InputFieldProps = Omit<React.ComponentProps<typeof Input>, "id"> & {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  leadingIcon?: React.ReactNode
  fieldClassName?: string
  labelClassName?: string
}

function InputField({
  id,
  label,
  description,
  error,
  required,
  leadingIcon,
  fieldClassName,
  labelClassName,
  className,
  ...props
}: InputFieldProps) {
  return (
    <FormField
      id={id}
      label={label}
      description={description}
      error={error}
      required={required}
      className={fieldClassName}
      labelClassName={labelClassName}
    >
      <div className={cn("relative", leadingIcon && "group")}>
        {leadingIcon && (
          <span className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/75 transition-colors group-focus-within:text-primary">
            {leadingIcon}
          </span>
        )}
        <Input
          id={id}
          aria-invalid={Boolean(error) || undefined}
          className={cn(
            "h-10 rounded-lg border-border/80 bg-background text-sm focus-visible:border-primary",
            leadingIcon && "pl-9",
            className
          )}
          {...props}
        />
      </div>
    </FormField>
  )
}

export { InputField }
