"use client"

import { useState, useMemo, memo, useCallback, useEffect } from "react"
import Image from "next/image"
import { Trash2, PanelLeftClose, PanelLeft, Search, X, Wrench, Bot, Database, Sun, Moon, Cpu, LayoutDashboard, User, LogIn, LogOut, Settings, ChevronDown, BookOpenText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingPlaceholder, ThreadSkeleton } from "@/components/ui/loading-placeholder"
import type { Thread } from "@/lib/hooks/threads"
import { useT, useI18n } from "@/lib/i18n"
import { useTheme } from "next-themes"
import { useAuth } from "@/components/providers/auth-provider"
import { AuthPanel } from "./auth-panel"

const scrollbarStyles = `
  .custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
  }
  .custom-scrollbar:hover {
    scrollbar-color: rgba(22, 65, 153, 0.4) transparent;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 3px;
  }
  .custom-scrollbar:hover::-webkit-scrollbar-thumb {
    background: rgba(22, 65, 153, 0.4);
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(22, 65, 153, 0.6);
  }
`

const DEFAULT_ADMIN_URL = "http://114.55.10.54:8000/static/admin.html"

function openAdminDashboard() {
  const url = process.env.NEXT_PUBLIC_ADMIN_URL || DEFAULT_ADMIN_URL
  if ((window as any).__TOB_ROBOT_ENV__?.enabled) {
    window.location.assign(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  threads: Thread[]
  currentThreadId: string
  onSelectThread: (threadId: string) => void
  onDeleteThread: (threadId: string) => void
  isLoading?: boolean
  currentView?: string
  onViewChange?: (view: "chat" | "skills" | "agents" | "knowledge" | "mcp" | "settings" | "developer-manual") => void
}

function getRelativeTime(date: Date, lang: "zh" | "en" = "zh"): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (lang === "zh") {
    if (diffMins < 1) return "刚刚"
    if (diffMins < 60) return `${diffMins} 分钟前`
    if (diffHours < 24) return `${diffHours} 小时前`
    if (diffDays === 1) return "昨天"
    if (diffDays < 7) return `${diffDays} 天前`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`
    return `${Math.floor(diffDays / 30)} 个月前`
  }
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`
  return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? "s" : ""} ago`
}

function groupThreads(threads: Thread[]) {
  const now = new Date()
  const today: Thread[] = []
  const yesterday: Thread[] = []
  const last7Days: Thread[] = []
  const older: Thread[] = []

  threads.forEach((thread) => {
    // Use updated_at from LangGraph thread
    const threadDate = new Date(thread.updated_at || thread.created_at)
    const diffMs = now.getTime() - threadDate.getTime()
    const diffHours = diffMs / 3600000
    const diffDays = diffMs / 86400000

    if (diffHours < 24) {
      today.push(thread)
    } else if (diffDays < 2) {
      yesterday.push(thread)
    } else if (diffDays < 7) {
      last7Days.push(thread)
    } else {
      older.push(thread)
    }
  })

  return { today, yesterday, last7Days, older }
}

interface UserProfileSectionProps {
  isCollapsed: boolean
  onOpenAuth: () => void
  onOpenSettings: () => void
}

const UserProfileSection = memo(function UserProfileSection({
  isCollapsed,
  onOpenAuth,
  onOpenSettings,
}: UserProfileSectionProps) {
  const { user, logout } = useAuth()
  const { locale } = useI18n()

  if (!user) {
    if (isCollapsed) {
      return (
        <button
          onClick={onOpenAuth}
          className="p-2.5 rounded-lg border border-transparent text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground transition-all duration-200 cursor-pointer"
          title="Sign In"
        >
          <User className="w-5 h-5" />
        </button>
      )
    }
    return (
      <button
        onClick={onOpenAuth}
        className="flex items-center justify-center gap-2 px-3 py-2 text-sm w-full font-medium rounded-lg text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-primary-foreground shadow-depth-xs hover:shadow-depth-hover transition-all duration-200 cursor-pointer"
      >
        <LogIn className="w-4 h-4" />
        <span>Sign In</span>
      </button>
    )
  }

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center">
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm hover:opacity-80 transition-all duration-200 cursor-pointer"
          style={{ backgroundColor: user.avatarColor || '#164199' }}
          title={`${user.username} (${locale === "zh" ? "设置" : "Settings"})`}
        >
          {user.username.charAt(0).toUpperCase()}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-sidebar-accent/15 border border-border/40 gap-3 group/profile">
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80 transition-all duration-200 cursor-pointer text-left"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm flex-shrink-0"
          style={{ backgroundColor: user.avatarColor || '#164199' }}
        >
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold truncate text-foreground">{user.username}</span>
          <span className="text-[10px] text-muted-foreground truncate">{user.email || 'No email'}</span>
        </div>
      </button>
      <button
        onClick={logout}
        className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all duration-200 cursor-pointer"
        title="Sign Out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  )
})

export const Sidebar = memo(function Sidebar({
  isCollapsed,
  onToggle,
  threads,
  currentThreadId,
  onSelectThread,
  onDeleteThread,
  isLoading = false,
  currentView = "chat",
  onViewChange,
}: SidebarProps) {
  const t = useT()
  const { locale } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [searchQuery, setSearchQuery] = useState('')
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isConfigOpen, setIsConfigOpen] = useState(true)
  const isConfigView = currentView === "skills" || currentView === "agents" || currentView === "knowledge" || currentView === "mcp"

  // Filter threads based on search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads

    const query = searchQuery.toLowerCase()
    return threads.filter(thread => {
      const title = thread.metadata?.title?.toLowerCase() || ''
      const lastMessage = thread.metadata?.lastMessage?.toLowerCase() || ''
      return title.includes(query) || lastMessage.includes(query)
    })
  }, [threads, searchQuery])

  // Memoize grouped threads to avoid recalculating on every render
  const groupedThreads = useMemo(() => groupThreads(filteredThreads), [filteredThreads])
  const { today, yesterday, last7Days, older } = groupedThreads

  // Memoize event handlers to prevent unnecessary re-renders
  const handleSelectThread = useCallback((threadId: string) => {
    onSelectThread(threadId)
    onViewChange?.("chat")
  }, [onSelectThread, onViewChange])

  const handleDeleteThread = useCallback((threadId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onDeleteThread(threadId)
  }, [onDeleteThread])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
  }, [])

  // Memoize renderThreadGroup to prevent recreation on every render
  // IMPORTANT: Must be defined before any conditional returns (Rules of Hooks)
  const renderThreadGroup = useCallback((groupThreads: Thread[], label: string) => {
    if (groupThreads.length === 0) return null

    return (
      <div className="mt-3 px-3 first:mt-0">
        <h3 className="px-3 text-xs font-semibold text-sidebar-accent-foreground uppercase tracking-wider mb-1 shadow-inset-light">{label}</h3>
        <div className="space-y-1">
          {groupThreads.map((thread) => {
            const title = thread.metadata?.title || "New conversation"

            return (
              <div
                key={thread.thread_id}
                className={`group flex items-center gap-2 px-3 py-1.5 text-sm w-full rounded-lg transition-all duration-200 cursor-pointer border ${
                  thread.thread_id === currentThreadId
                    ? "bg-primary/15 text-sidebar-foreground border-primary/30"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
                }`}
                onClick={() => handleSelectThread(thread.thread_id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{title}</div>
                </div>
                <button
                  onClick={(e) => handleDeleteThread(thread.thread_id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-all duration-200 p-1 rounded-md hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }, [currentThreadId, handleSelectThread, handleDeleteThread])

  // Early return for collapsed state (after all hooks)
  if (isCollapsed) {
    return (
      <aside className="hidden md:flex w-16 bg-gradient-to-b from-sidebar via-sidebar-light to-sidebar border-r border-border/60 flex-col justify-between shadow-depth-sm h-screen">
        <div className="px-3 py-4 border-b border-border/60 h-16 flex items-center justify-center">
          <Button variant="ghost" size="icon" onClick={onToggle} className="hover:bg-sidebar-primary/10 hover:text-sidebar-primary transition-all duration-200 shadow-depth-xs hover:shadow-depth-hover rounded-lg">
            <PanelLeft className="w-5 h-5" />
          </Button>
        </div>

        {/* Collapsed bottom shortcuts */}
        <div className="flex flex-col items-center gap-3.5 pb-6">
          <button
            onClick={() => setIsConfigOpen((open) => !open)}
            className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
              isConfigView
                ? "bg-primary/15 text-primary border-primary/20"
                : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
            }`}
            title={isConfigOpen ? t.collapseConfiguration : t.expandConfiguration}
            aria-label={isConfigOpen ? t.collapseConfiguration : t.expandConfiguration}
            aria-expanded={isConfigOpen}
          >
            <Settings className="w-5 h-5" />
          </button>
          {isConfigOpen && (
            <div className="flex flex-col items-center gap-3.5">
              <button
                onClick={() => onViewChange?.("skills")}
                className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  currentView === "skills"
                    ? "bg-primary/15 text-primary border-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
                }`}
                title={t.skills}
              >
                <Wrench className="w-5 h-5" />
              </button>
              <button
                onClick={() => onViewChange?.("agents")}
                className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  currentView === "agents"
                    ? "bg-primary/15 text-primary border-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
                }`}
                title={t.agents}
              >
                <Bot className="w-5 h-5" />
              </button>
              <button
                onClick={() => onViewChange?.("knowledge")}
                className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  currentView === "knowledge"
                    ? "bg-primary/15 text-primary border-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
                }`}
                title={t.knowledgeBase}
              >
                <Database className="w-5 h-5" />
              </button>
              <button
                onClick={() => onViewChange?.("mcp")}
                className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  currentView === "mcp"
                    ? "bg-primary/15 text-primary border-primary/20"
                    : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
                }`}
                title={t.mcpServers}
              >
                <Cpu className="w-5 h-5" />
              </button>
            </div>
          )}
          <button
            onClick={openAdminDashboard}
            className="p-2.5 rounded-lg border transition-all duration-200 cursor-pointer text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
            title={t.backend}
          >
            <LayoutDashboard className="w-5 h-5" />
          </button>
          <button
            onClick={() => onViewChange?.("developer-manual")}
            className={`p-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
              currentView === "developer-manual"
                ? "bg-primary/15 text-primary border-primary/20"
                : "text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
            }`}
            title={t.developerManual}
          >
            <BookOpenText className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="p-2.5 rounded-lg border transition-all duration-200 cursor-pointer text-muted-foreground hover:bg-sidebar-accent/30 hover:text-foreground border-transparent"
            title={mounted && resolvedTheme === "dark" ? t.lightMode : t.darkMode}
          >
            {mounted && resolvedTheme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <div className="w-8 border-t border-border/40 my-1 flex-shrink-0" />
          
          <UserProfileSection isCollapsed={true} onOpenAuth={() => setIsAuthOpen(true)} onOpenSettings={() => onViewChange?.("settings")} />
        </div>
      </aside>
    )
  }

  return (
    <>
      <style>{scrollbarStyles}</style>
      <aside className="hidden md:flex w-56 bg-gradient-to-b from-sidebar via-sidebar-light to-sidebar-lighter border-r border-border/60 flex-col shadow-depth-md">
        <div className="px-3 pt-[13px] pb-[14px] border-b border-border/60 bg-gradient-to-r from-sidebar-accent/20 via-sidebar-accent/10 to-transparent">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={onToggle} className="hover:bg-sidebar-primary/10 hover:text-sidebar-primary transition-all duration-200 shadow-depth-xs hover:shadow-depth-hover rounded-lg">
              <PanelLeftClose className="w-5 h-5" />
            </Button>
            <Image
              src="/logo.png"
              alt="WSIRI"
              width={957}
              height={613}
              className="h-10 w-auto max-w-[128px] object-contain"
              priority
            />
          </div>
        </div>

      {/* Search Bar */}
      <div className="px-3 py-2 bg-gradient-to-r from-sidebar-accent/5 via-transparent to-transparent">
        <div className="relative group">
          <div className="absolute left-3 top-1/2 transform -translate-y-1/2 z-10">
            <Search className="w-4 h-4 text-muted-foreground/70 group-focus-within:text-primary transition-all duration-200" />
          </div>
          <Input
            type="text"
            placeholder={t.searchThreads}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-8 h-10 text-sm bg-background/80 backdrop-blur-sm border-border/40 focus:border-primary/60 focus:bg-background/90 focus:shadow-sm transition-all duration-200 shadow-sm hover:shadow-md hover:bg-background/90 rounded-lg"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 z-10 text-muted-foreground/60 hover:text-foreground transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-full p-0.5 hover:bg-muted/50"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-2 bg-gradient-to-b from-sidebar-accent/5 via-transparent to-sidebar-accent/10 custom-scrollbar">
        {isLoading ? (
          <div className="mt-3 px-3">
            <div className="px-3 mb-1.5">
              <LoadingPlaceholder className="h-2.5 w-24" label={t.loadingConversations} />
            </div>
            <div className="space-y-1">
              <ThreadSkeleton />
              <ThreadSkeleton />
              <ThreadSkeleton />
            </div>
            <div className="px-3 mb-1.5 mt-4">
              <LoadingPlaceholder className="h-2.5 w-20" />
            </div>
            <div className="space-y-1">
              <ThreadSkeleton />
              <ThreadSkeleton />
              <ThreadSkeleton />
            </div>
          </div>
        ) : searchQuery && filteredThreads.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground bg-gradient-to-br from-card/10 via-card/5 to-transparent rounded-lg mx-3 shadow-depth-xs">
            <div className="font-medium mb-1">{t.noResultsFound}</div>
            <div className="text-xs">{t.tryDifferentSearch}</div>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground bg-gradient-to-br from-card/10 via-card/5 to-transparent rounded-lg mx-3 shadow-depth-xs">
            <div className="font-medium mb-1">{t.noConversationsYet}</div>
            <div className="text-xs">{t.startChatting}</div>
          </div>
        ) : (
          <>
            {renderThreadGroup(today, t.today)}
            {renderThreadGroup(yesterday, t.yesterday)}
            {renderThreadGroup(last7Days, t.previous7Days)}
            {renderThreadGroup(older, t.older)}
          </>
        )}
      </nav>

      {/* Bottom Management Navigation */}
      <div className="px-3 py-2 border-t border-border/40 bg-gradient-to-b from-transparent to-sidebar-accent/10 flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={() => setIsConfigOpen((open) => !open)}
          className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
            isConfigView
              ? "bg-primary/15 text-primary border-primary/20 font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
          }`}
          aria-expanded={isConfigOpen}
        >
          <Settings className="w-4 h-4 flex-shrink-0 text-muted-foreground/80" />
          <span className="truncate flex-1 text-left">{t.configuration}</span>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 text-muted-foreground/80 transition-transform duration-200 ${isConfigOpen ? "rotate-180" : ""}`} />
        </button>
        {isConfigOpen && (
          <div className="flex flex-col gap-1 pl-3">
            <button
              onClick={() => onViewChange?.("skills")}
              className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
                currentView === "skills"
                  ? "bg-primary/15 text-primary border-primary/20 font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
              }`}
            >
              <Wrench className="w-4 h-4 flex-shrink-0 text-muted-foreground/80 group-hover:text-primary" />
              <span className="truncate">{t.skills}</span>
            </button>
            <button
              onClick={() => onViewChange?.("agents")}
              className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
                currentView === "agents"
                  ? "bg-primary/15 text-primary border-primary/20 font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
              }`}
            >
              <Bot className="w-4 h-4 flex-shrink-0 text-muted-foreground/80 group-hover:text-primary" />
              <span className="truncate">{t.agents}</span>
            </button>
            <button
              onClick={() => onViewChange?.("knowledge")}
              className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
                currentView === "knowledge"
                  ? "bg-primary/15 text-primary border-primary/20 font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
              }`}
            >
              <Database className="w-4 h-4 flex-shrink-0 text-muted-foreground/80 group-hover:text-primary" />
              <span className="truncate">{t.knowledgeBase}</span>
            </button>
            <button
              onClick={() => onViewChange?.("mcp")}
              className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
                currentView === "mcp"
                  ? "bg-primary/15 text-primary border-primary/20 font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
              }`}
            >
              <Cpu className="w-4 h-4 flex-shrink-0 text-muted-foreground/80 group-hover:text-primary" />
              <span className="truncate">{t.mcpServers}</span>
            </button>
          </div>
        )}
        <button
          onClick={openAdminDashboard}
          className="flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent hover:text-foreground group"
        >
          <LayoutDashboard className="w-4 h-4 flex-shrink-0 text-muted-foreground/80 group-hover:text-primary" />
          <span className="truncate">{t.backend}</span>
        </button>
        <button
          onClick={() => onViewChange?.("developer-manual")}
          className={`flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer ${
            currentView === "developer-manual"
              ? "bg-primary/15 text-primary border-primary/20 font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent hover:text-foreground"
          }`}
        >
          <BookOpenText className="w-4 h-4 flex-shrink-0 text-muted-foreground/80" />
          <span className="truncate">{t.developerManual}</span>
        </button>
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="flex items-center gap-3 px-3 py-2 text-sm w-full rounded-lg transition-all duration-200 border cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent/30 border-transparent"
        >
          {mounted && resolvedTheme === "dark" ? (
            <Sun className="w-4 h-4 flex-shrink-0 text-muted-foreground/80" />
          ) : (
            <Moon className="w-4 h-4 flex-shrink-0 text-muted-foreground/80" />
          )}
          <span className="truncate">
            {mounted && resolvedTheme === "dark" ? t.lightMode : t.darkMode}
          </span>
        </button>
      </div>

      <div className="pt-2 pb-3 px-3">
        <UserProfileSection isCollapsed={false} onOpenAuth={() => setIsAuthOpen(true)} onOpenSettings={() => onViewChange?.("settings")} />
      </div>

      <AuthPanel open={isAuthOpen} onOpenChange={setIsAuthOpen} />
    </aside>
    </>
  )
})
