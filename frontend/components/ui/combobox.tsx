"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  triggerClassName?: string
  menuClassName?: string
  prefix?: string
  autoFocusSearch?: boolean
  disabled?: boolean
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  className,
  triggerClassName,
  menuClassName,
  prefix,
  autoFocusSearch = true,
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const containerRef = React.useRef<HTMLDivElement>(null)

  const selectedOption = options.find((option) => option.value === value)

  // Close when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Filter options based on search query
  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options
    const query = search.toLowerCase()
    return options.filter((option) =>
      option.label.toLowerCase().includes(query) ||
      option.value.toLowerCase().includes(query)
    )
  }, [options, search])

  // Reset search when opening/closing
  React.useEffect(() => {
    if (!open) {
      setSearch("")
    }
  }, [open])

  return (
    <div ref={containerRef} className={cn("relative inline-block text-left", className)}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return
          setOpen(!open)
        }}
        disabled={disabled}
        className={cn(
          "h-8 text-sm bg-muted/70 hover:bg-muted px-3 gap-1 rounded-md transition-all duration-200 font-medium flex items-center justify-between text-foreground min-w-[140px]",
          open && "bg-background ring-2 ring-primary/20",
          disabled && "cursor-not-allowed opacity-70 hover:bg-muted/70",
          triggerClassName
        )}
      >
        <span className="flex items-center truncate">
          {prefix && <span className="text-muted-foreground mr-1">{prefix}</span>}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        {!disabled && <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />}
      </button>

      {open && !disabled && (
        <div className={cn(
          "absolute left-0 mt-1 z-50 min-w-[200px] max-w-[280px] rounded-lg bg-popover text-popover-foreground shadow-depth-lg animate-in fade-in-50 slide-in-from-top-1 duration-200",
          menuClassName
        )}>
          <div className="flex items-center bg-muted/50 px-2.5 py-1.5">
            <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-7 w-full rounded-md bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus={autoFocusSearch}
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground/75">
                {emptyText}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredOptions.map((option) => {
                  const isSelected = option.value === value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onValueChange(option.value)
                        setOpen(false)
                      }}
                      className={cn(
                        "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pl-8 pr-3 text-xs text-left outline-none hover:bg-primary/10 hover:text-primary transition-colors font-medium",
                        isSelected && "bg-primary/5 text-primary"
                      )}
                    >
                      <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
