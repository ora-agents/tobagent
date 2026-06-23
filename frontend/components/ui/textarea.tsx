import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full rounded-md bg-muted/70 px-3 py-2 text-base shadow-none transition-[background-color,color,box-shadow] outline-none focus-visible:bg-background focus-visible:ring-ring/35 focus-visible:ring-[3px] aria-invalid:bg-destructive/10 aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/60 dark:aria-invalid:ring-destructive/40 md:text-sm",
          className
        )}
        {...props}
      />
    )
  }
)

Textarea.displayName = "Textarea"

export { Textarea }
