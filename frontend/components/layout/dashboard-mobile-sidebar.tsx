import type * as React from "react"

import { Button } from "@/components/ui/button"
import { Sidebar } from "@/components/layout/sidebar"

type SidebarProps = React.ComponentProps<typeof Sidebar>

interface DashboardMobileSidebarProps {
  open: boolean
  sidebarProps: SidebarProps
  onClose: () => void
}

export function DashboardMobileSidebar({ open, sidebarProps, onClose }: DashboardMobileSidebarProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="菜单">
      <Button
        variant="unstyled"
        type="button"
        className="absolute inset-0 bg-foreground/35"
        onClick={onClose}
        aria-label="关闭菜单"
      />
      <div className="relative h-full">
        <Sidebar {...sidebarProps} isMobileDrawer onMobileClose={onClose} />
      </div>
    </div>
  )
}
