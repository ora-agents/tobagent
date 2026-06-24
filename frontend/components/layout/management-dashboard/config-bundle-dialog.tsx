"use client"

import { useRef, useState } from "react"
import { Download, LoaderCircle, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingsSwitch } from "@/components/ui/settings-switch"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

type ResourceKey = "agents" | "skills" | "knowledgeBases" | "mcpServers" | "forms"
type ConflictPolicy = "copy" | "overwrite" | "skip"

interface Inspection {
  inspectionId: string
  formatVersion: number
  exportedAt: string
  resources: Record<ResourceKey, number>
  conflicts: { resourceType: string; sourceName: string; reason: string }[]
  missingDependencies: { agentId: string; resourceType: string; resourceId: string }[]
  warnings: string[]
  knowledgeDocuments: number
  knowledgeDocumentBytes: number
}

interface ConfigBundleDialogProps {
  mode: "import" | "export" | null
  onOpenChange: (open: boolean) => void
  locale: "zh" | "en"
  authHeaders?: Record<string, string>
  resourceIds: Record<ResourceKey, string[]>
}

const resourceLabels: Record<ResourceKey, { zh: string; en: string }> = {
  agents: { zh: "智能体", en: "Agents" },
  skills: { zh: "技能", en: "Skills" },
  knowledgeBases: { zh: "知识库", en: "Knowledge bases" },
  mcpServers: { zh: "MCP 服务", en: "MCP servers" },
  forms: { zh: "表单", en: "Forms" },
}

export function ConfigBundleDialog({
  mode,
  onOpenChange,
  locale,
  authHeaders,
  resourceIds,
}: ConfigBundleDialogProps) {
  const zh = locale === "zh"
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [includeDependencies, setIncludeDependencies] = useState(true)
  const [includeKnowledgeDocuments, setIncludeKnowledgeDocuments] = useState(false)
  const [includeFormRecords, setIncludeFormRecords] = useState(true)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [policy, setPolicy] = useState<ConflictPolicy>("copy")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const close = (open: boolean) => {
    if (!open) {
      setInspection(null)
      setError("")
      setBusy(false)
    }
    onOpenChange(open)
  }

  const exportBundle = async () => {
    if (!authHeaders) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`${LANGGRAPH_API_URL}/api/config-bundles/export`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: resourceIds,
          options: {
            includeDependencies,
            includeKnowledgeDocuments,
            includeFormRecords,
          },
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `tob-config-${new Date().toISOString().slice(0, 10)}.tobconfig`
      link.click()
      URL.revokeObjectURL(url)
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const inspectFile = async (file: File) => {
    if (!authHeaders) return
    setBusy(true)
    setError("")
    setInspection(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const response = await fetch(`${LANGGRAPH_API_URL}/api/config-bundles/inspect`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      })
      if (!response.ok) throw new Error(await response.text())
      setInspection(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const importBundle = async () => {
    if (!authHeaders || !inspection) return
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`${LANGGRAPH_API_URL}/api/config-bundles/import`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionId: inspection.inspectionId,
          conflictPolicy: policy,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "export"
              ? zh ? "导出配置" : "Export configuration"
              : zh ? "导入配置" : "Import configuration"}
          </DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? zh ? "生成统一的 .tobconfig 配置包。" : "Create a unified .tobconfig bundle."
              : zh ? "先预检配置包，确认冲突和安全提示后再写入。" : "Inspect the bundle before applying any changes."}
          </DialogDescription>
        </DialogHeader>

        {mode === "export" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-3 text-sm">
              {(Object.keys(resourceIds) as ResourceKey[]).map(key => (
                <div key={key} className="flex justify-between gap-3">
                  <span>{resourceLabels[key][locale]}</span>
                  <span className="text-muted-foreground">{resourceIds[key].length}</span>
                </div>
              ))}
            </div>
            <SettingsSwitch
              checked={includeDependencies}
              onCheckedChange={setIncludeDependencies}
              label={zh ? "包含智能体关联资源" : "Include agent dependencies"}
            />
            <SettingsSwitch
              checked={includeKnowledgeDocuments}
              onCheckedChange={setIncludeKnowledgeDocuments}
              label={zh ? "包含知识库原始文档" : "Include knowledge documents"}
              description={zh ? "导入后会异步重新解析和建立索引。" : "Documents are parsed and reindexed asynchronously after import."}
            />
            <SettingsSwitch
              checked={includeFormRecords}
              onCheckedChange={setIncludeFormRecords}
              label={zh ? "包含表单记录" : "Include form records"}
            />
          </div>
        ) : inspection ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-3 text-sm">
              {(Object.keys(inspection.resources) as ResourceKey[]).map(key => (
                <div key={key} className="flex justify-between gap-3">
                  <span>{resourceLabels[key][locale]}</span>
                  <span className="text-muted-foreground">{inspection.resources[key]}</span>
                </div>
              ))}
              <div className="col-span-2 flex justify-between border-t border-border/60 pt-2">
                <span>{zh ? "知识库文档" : "Knowledge documents"}</span>
                <span className="text-muted-foreground">{inspection.knowledgeDocuments}</span>
              </div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{zh ? "冲突策略" : "Conflict policy"}</span>
              <select
                value={policy}
                onChange={event => setPolicy(event.target.value as ConflictPolicy)}
                className="h-10 rounded-lg border border-border bg-background px-3"
              >
                <option value="copy">{zh ? "创建副本（默认）" : "Create copies (default)"}</option>
                <option value="overwrite">{zh ? "覆盖当前账户资源" : "Overwrite owned resources"}</option>
                <option value="skip">{zh ? "跳过冲突" : "Skip conflicts"}</option>
              </select>
            </label>
            {(inspection.conflicts.length > 0 || inspection.missingDependencies.length > 0 || inspection.warnings.length > 0) && (
              <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                <p>{zh ? `冲突：${inspection.conflicts.length}` : `Conflicts: ${inspection.conflicts.length}`}</p>
                <p>{zh ? `缺失依赖：${inspection.missingDependencies.length}` : `Missing dependencies: ${inspection.missingDependencies.length}`}</p>
                {inspection.warnings.map(warning => <p key={warning} className="text-muted-foreground">{warning}</p>)}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-secondary/50 text-sm hover:bg-secondary"
          >
            <Upload className="h-6 w-6 text-primary" />
            {zh ? "选择 .tobconfig 文件" : "Choose a .tobconfig file"}
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".tobconfig,application/zip,application/vnd.tob.config+zip"
          className="hidden"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) void inspectFile(file)
            event.currentTarget.value = ""
          }}
        />
        {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {zh ? "取消" : "Cancel"}
          </Button>
          {mode === "export" && (
            <Button onClick={exportBundle} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
              {zh ? "导出" : "Export"}
            </Button>
          )}
          {mode === "import" && inspection && (
            <Button onClick={importBundle} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {zh ? "确认导入" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
