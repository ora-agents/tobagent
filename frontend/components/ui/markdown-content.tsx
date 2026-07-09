"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

interface MarkdownContentProps {
  value: string
  className?: string
  compact?: boolean
}

export function MarkdownContent({ value, className, compact = false }: MarkdownContentProps) {
  return (
    <div
      className={cn(
        "prose max-w-none break-words text-sm text-muted-foreground [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:break-words [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto",
        compact && "text-xs leading-relaxed",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {value}
      </ReactMarkdown>
    </div>
  )
}
