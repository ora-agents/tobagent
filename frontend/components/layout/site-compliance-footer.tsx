"use client"

import { useEffect, useState } from "react"

import { ICP_RECORD } from "@/lib/constants/site"
import { isTauriRuntime } from "@/lib/config/api-runtime"
import { cn } from "@/lib/utils"

interface SiteComplianceFooterProps {
  className?: string
}

export function SiteComplianceFooter({ className }: SiteComplianceFooterProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(!isTauriRuntime())
  }, [])

  if (!visible) return null

  return (
    <footer
      aria-label="网站备案"
      className={cn("site-compliance-footer flex shrink-0 justify-center px-4", className)}
    >
      <p className="px-2 py-1 text-[11px] leading-none text-muted-foreground">
        <a
          href={ICP_RECORD.url}
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {ICP_RECORD.number}
        </a>
      </p>
    </footer>
  )
}
