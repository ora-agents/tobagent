"use client"

import { useEffect, useState } from "react"

import { ICP_RECORD } from "@/lib/constants/site"
import { isTauriRuntime } from "@/lib/config/api-runtime"

export function SiteComplianceFooter() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(!isTauriRuntime())
  }, [])

  if (!visible) return null

  return (
    <footer
      aria-label="网站备案"
      className="site-compliance-footer pointer-events-none fixed inset-x-0 bottom-2 z-50 flex justify-center px-4"
    >
      <p className="rounded-md bg-background/85 px-2 py-1 text-[11px] leading-none text-muted-foreground shadow-depth-xs backdrop-blur">
        <a
          href={ICP_RECORD.url}
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {ICP_RECORD.number}
        </a>
      </p>
    </footer>
  )
}
