"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

type ToolbarButtonProps = Omit<ActionButtonProps, "variant"> & {
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

interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  id?: string
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactNode
  labelClassName?: string
}

function FormField({
  id,
  label,
  description,
  error,
  required = false,
  children,
  className,
  labelClassName,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <Label
        htmlFor={id}
        className={cn("text-xs font-semibold text-muted-foreground", labelClassName)}
      >
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

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

interface ListPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}

function ListPanel({ title, action, children, className, ...props }: ListPanelProps) {
  return (
    <aside
      className={cn(
        "flex w-[300px] flex-shrink-0 flex-col border-r border-border/50 bg-background/50",
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

interface ListItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  selected?: boolean
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  onSelect?: () => void
}

function ListItem({
  selected = false,
  title,
  description,
  icon,
  meta,
  actions,
  className,
  children,
  onClick,
  onSelect,
  onKeyDown,
  ...props
}: ListItemProps) {
  const interactive = Boolean(onClick || onSelect)

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onSelect?.()
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!interactive || event.defaultPrevented) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect?.()
        }
      }}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-lg border p-3 pr-20 text-left outline-none transition-colors",
        "focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15",
        selected
          ? "border-primary/50 bg-primary/5 text-foreground"
          : "border-border/70 bg-background/40 text-foreground hover:border-primary/30 hover:bg-muted/20",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {description && (
          <span className="mt-1 block truncate text-xs text-muted-foreground">{description}</span>
        )}
        {meta && <span className="mt-2 flex flex-wrap gap-1">{meta}</span>}
        {children}
      </span>
      {actions && (
        <span
          className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      )}
    </div>
  )
}

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-secondary/40 p-6 text-center",
        className
      )}
      {...props}
    >
      <div className="max-w-sm">
        {icon && <div className="mx-auto mb-3 flex justify-center text-muted-foreground/45">{icon}</div>}
        {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
        {children}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

function ListDisclosureIcon({ className }: { className?: string }) {
  return <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground", className)} />
}

export {
  ActionButton,
  EmptyState,
  FormField,
  InputField,
  ListDisclosureIcon,
  ListItem,
  ListPanel,
  SelectField,
  SettingsSwitch,
  ToolbarButton,
}
