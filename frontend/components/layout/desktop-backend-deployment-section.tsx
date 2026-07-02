"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Archive,
  Download,
  FileUp,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Save,
  ServerCog,
  Square,
} from "lucide-react"

import { ActionButton } from "@/components/ui/action-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PageSection, PageSectionTitle } from "@/components/ui/page-section"
import { StatusNotice } from "@/components/ui/status-notice"
import { Textarea } from "@/components/ui/textarea"
import { normalizeLangGraphApiUrl, useApiConfig } from "@/lib/config/api-config"
import { cn } from "@/lib/utils"

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

interface DesktopBackendStatus {
  dataDir: string
  deployDir: string
  envPath: string
  downloadDir: string
  packagePath: string | null
  binaryPath: string | null
  running: boolean
  deployed: boolean
  localUrl: string
}

interface DesktopBackendDeploymentSectionProps {
  zh: boolean
  sectionRef?: (el: HTMLElement | null) => void
  density?: "default" | "compact" | "roomy"
  compactTitle?: boolean
  className?: string
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  return (invoke as InvokeFn)<T>(cmd, args)
}

function compactPath(path: string | null | undefined) {
  if (!path) return "-"
  const normalized = path.replace(/\\/g, "/")
  const parts = normalized.split("/")
  if (parts.length <= 4) return path
  return `.../${parts.slice(-3).join("/")}`
}

export function DesktopBackendDeploymentSection({
  zh,
  sectionRef,
  density = "default",
  compactTitle = false,
  className,
}: DesktopBackendDeploymentSectionProps) {
  const { apiUrl, setApiUrl, isDesktopRuntime } = useApiConfig()
  const [status, setStatus] = useState<DesktopBackendStatus | null>(null)
  const [envDraft, setEnvDraft] = useState("")
  const [downloadUrl, setDownloadUrl] = useState("")
  const [showDownloadUrlInput, setShowDownloadUrlInput] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const localUrl = status?.localUrl || "http://127.0.0.1:2026"
  const usingLocalBackend = useMemo(() => {
    try {
      return normalizeLangGraphApiUrl(apiUrl) === normalizeLangGraphApiUrl(localUrl)
    } catch {
      return false
    }
  }, [apiUrl, localUrl])

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime) return
    const nextStatus = await tauriInvoke<DesktopBackendStatus>("desktop_backend_status")
    setStatus(nextStatus)
  }, [isDesktopRuntime])

  const loadEnv = useCallback(async () => {
    if (!isDesktopRuntime) return
    const content = await tauriInvoke<string>("desktop_backend_read_env")
    setEnvDraft(content)
  }, [isDesktopRuntime])

  useEffect(() => {
    if (!isDesktopRuntime) return
    let cancelled = false
    async function load() {
      try {
        const [nextStatus, content] = await Promise.all([
          tauriInvoke<DesktopBackendStatus>("desktop_backend_status"),
          tauriInvoke<string>("desktop_backend_read_env"),
        ])
        if (cancelled) return
        setStatus(nextStatus)
        setEnvDraft(content)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isDesktopRuntime])

  if (!isDesktopRuntime) return null

  const runAction = async (name: string, action: () => Promise<string | null | void>) => {
    setBusyAction(name)
    setError(null)
    setMessage(null)
    try {
      const nextMessage = await action()
      await refresh()
      if (nextMessage) setMessage(nextMessage)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  const saveEnv = () =>
    runAction("save-env", async () => {
      await tauriInvoke("desktop_backend_write_env", { content: envDraft })
      return zh ? ".env 已保存" : ".env saved"
    })

  const initializeDeployment = () =>
    runAction("initialize", async () => {
      const nextStatus = await tauriInvoke<DesktopBackendStatus>("desktop_backend_initialize")
      setStatus(nextStatus)
      await loadEnv()
      return zh ? "本地部署目录已准备好" : "Local deployment directory is ready"
    })

  const downloadPackage = () =>
    runAction("download", async () => {
      if (!showDownloadUrlInput) {
        setShowDownloadUrlInput(true)
        return null
      }
      if (!downloadUrl.trim()) {
        throw new Error(zh ? "请先填写安装包下载地址" : "Enter a package download URL first")
      }
      const path = await tauriInvoke<string>("desktop_backend_download_package", { url: downloadUrl })
      return zh ? `已下载到 ${path}` : `Downloaded to ${path}`
    })

  const selectPackage = () =>
    runAction("select-package", async () => {
      const path = await tauriInvoke<string | null>("desktop_backend_select_package")
      return path ? (zh ? `已选择 ${path}` : `Selected ${path}`) : null
    })

  const importPackage = () =>
    runAction("import-package", async () => {
      await tauriInvoke<DesktopBackendStatus>("desktop_backend_import_package", { packagePath: status?.packagePath || null })
      return zh ? "本地后端包已导入" : "Local backend package imported"
    })

  const runInstaller = () =>
    runAction("installer", async () => {
      await tauriInvoke("desktop_backend_run_installer", { packagePath: status?.packagePath || null })
      return zh ? "已调用系统安装器" : "Installer opened"
    })

  const openDeployDir = () =>
    runAction("open-dir", async () => {
      await tauriInvoke("desktop_backend_open_deploy_dir")
      return zh ? "已打开部署目录" : "Deploy directory opened"
    })

  const startBackend = () =>
    runAction("start", async () => {
      await tauriInvoke<DesktopBackendStatus>("desktop_backend_start")
      return zh ? "本地后端已启动" : "Local backend started"
    })

  const stopBackend = () =>
    runAction("stop", async () => {
      await tauriInvoke<DesktopBackendStatus>("desktop_backend_stop")
      return zh ? "本地后端已停止" : "Local backend stopped"
    })

  const useLocalBackend = () =>
    runAction("use-local", async () => {
      await setApiUrl(localUrl)
      return zh ? `已切换到 ${localUrl}` : `Switched to ${localUrl}`
    })

  const isBusy = (name: string) => busyAction === name

  return (
    <PageSection
      id="section-desktop-backend"
      ref={sectionRef}
      density={density}
      className={cn(className)}
    >
      <PageSectionTitle icon={ServerCog} compact={compactTitle}>
        {zh ? "本地后端部署" : "Local Backend Deployment"}
      </PageSectionTitle>

      {error && <StatusNotice tone="error">{error}</StatusNotice>}
      {message && <StatusNotice tone="success">{message}</StatusNotice>}

      <div className="grid gap-3 rounded-lg bg-secondary p-3.5 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{zh ? "运行状态" : "Status"}</div>
          <div>{status?.running ? (zh ? "运行中" : "Running") : (zh ? "未运行" : "Stopped")}</div>
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{zh ? "当前后端" : "Current backend"}</div>
          <div className="truncate">{apiUrl}</div>
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground">Local URL</div>
          <div className="truncate">{localUrl}</div>
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-foreground">{zh ? "后端程序" : "Backend binary"}</div>
          <div className="truncate" title={status?.binaryPath || undefined}>{compactPath(status?.binaryPath)}</div>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <div className="font-semibold text-foreground">{zh ? "部署目录" : "Deploy directory"}</div>
          <div className="truncate" title={status?.deployDir || undefined}>{status?.deployDir || "-"}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ActionButton type="button" variant="outline" size="sm" onClick={initializeDeployment} disabled={Boolean(busyAction)}>
          {isBusy("initialize") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FolderOpen data-icon="inline-start" />}
          {zh ? "准备部署目录" : "Prepare"}
        </ActionButton>
        <ActionButton type="button" variant="outline" size="sm" onClick={openDeployDir} disabled={Boolean(busyAction)}>
          {isBusy("open-dir") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FolderOpen data-icon="inline-start" />}
          {zh ? "打开目录" : "Open folder"}
        </ActionButton>
        <ActionButton type="button" variant={status?.running ? "outline" : "default"} size="sm" onClick={status?.running ? stopBackend : startBackend} disabled={Boolean(busyAction)}>
          {isBusy("start") || isBusy("stop") ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : status?.running ? (
            <Square data-icon="inline-start" />
          ) : (
            <Play data-icon="inline-start" />
          )}
          {status?.running ? (zh ? "停止后端" : "Stop") : (zh ? "启动后端" : "Start")}
        </ActionButton>
        <ActionButton type="button" variant={usingLocalBackend ? "outline" : "default"} size="sm" onClick={useLocalBackend} disabled={Boolean(busyAction) || usingLocalBackend}>
          {isBusy("use-local") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
          {usingLocalBackend ? (zh ? "已使用本地" : "Using local") : (zh ? "切换到本地" : "Use local")}
        </ActionButton>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3.5">
        <Label htmlFor="desktop-backend-download-url" className="text-xs font-semibold text-muted-foreground">
          {zh ? "安装包或后端二进制" : "Installer, package, or backend binary"}
        </Label>
        {showDownloadUrlInput && (
          <Input
            id="desktop-backend-download-url"
            value={downloadUrl}
            onChange={(event) => setDownloadUrl(event.target.value)}
            placeholder="https://example.com/tobagent-backend-installer.exe"
            className="bg-background text-sm"
          />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" size="sm" onClick={downloadPackage} disabled={Boolean(busyAction)} className="shrink-0 rounded-lg">
            {isBusy("download") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
            {showDownloadUrlInput ? (zh ? "开始下载" : "Start download") : (zh ? "下载" : "Download")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={selectPackage} disabled={Boolean(busyAction)} className="shrink-0 rounded-lg">
            {isBusy("select-package") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileUp data-icon="inline-start" />}
            {zh ? "选择文件" : "Select file"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={importPackage} disabled={Boolean(busyAction) || !status?.packagePath} className="shrink-0 rounded-lg">
            {isBusy("import-package") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Archive data-icon="inline-start" />}
            {zh ? "导入/解压" : "Import"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={runInstaller} disabled={Boolean(busyAction) || !status?.packagePath} className="shrink-0 rounded-lg">
            {isBusy("installer") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
            {zh ? "执行安装" : "Install"}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {zh
            ? `最近文件：${compactPath(status?.packagePath)}。zip、tar.gz、tgz、tar 会解压到部署目录；单个文件会复制为后端程序。`
            : `Latest file: ${compactPath(status?.packagePath)}. zip, tar.gz, tgz, and tar files are extracted into the deploy directory; a single file is copied as the backend binary.`}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="desktop-backend-env" className="text-xs font-semibold text-muted-foreground">
            {zh ? ".env 环境变量" : ".env variables"}
          </Label>
          <Button type="button" variant="outline" size="sm" onClick={saveEnv} disabled={Boolean(busyAction)} className="h-8 rounded-lg">
            {isBusy("save-env") ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
            {zh ? "保存 .env" : "Save .env"}
          </Button>
        </div>
        <Textarea
          id="desktop-backend-env"
          value={envDraft}
          onChange={(event) => setEnvDraft(event.target.value)}
          spellCheck={false}
          className="min-h-72 resize-y bg-secondary font-mono text-xs leading-5"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {zh
            ? `保存路径：${status?.envPath || "-"}。修改端口后请保存并重启本地后端。`
            : `Saved at ${status?.envPath || "-"}. Save and restart the local backend after changing ports.`}
        </p>
      </div>
    </PageSection>
  )
}
