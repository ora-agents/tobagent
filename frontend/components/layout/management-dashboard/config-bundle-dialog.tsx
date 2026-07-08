"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, Download, LoaderCircle, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingsSwitch } from "@/components/ui/settings-switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { backendFetch } from "@/lib/api/backend-fetch"

type ResourceKey = "agents" | "skills" | "knowledgeBases" | "mcpServers" | "forms"
type ConflictPolicy = "copy" | "overwrite" | "skip"
type ResourceOption = { id: string; name: string }

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

interface InspectedFile {
  filename: string
  inspection: Inspection
}

export interface ConfigBundleImportResult {
  resources: Record<ResourceKey, string[]>
  resourceIdMap: Record<string, Record<string, string>>
  warnings: string[]
  jobs: string[]
}

interface ConfigBundleDialogProps {
  mode: "import" | "export" | null
  onOpenChange: (open: boolean) => void
  locale: "zh" | "en"
  authHeaders?: Record<string, string>
  resources: Record<ResourceKey, ResourceOption[]>
  initialSelection?: Partial<Record<ResourceKey, string[]>>
  onImported?: (results: ConfigBundleImportResult[]) => void | Promise<void>
}

const resourceKeys: ResourceKey[] = ["agents", "skills", "knowledgeBases", "mcpServers", "forms"]
const resourceLabels: Record<ResourceKey, { zh: string; en: string }> = {
  agents: { zh: "智能体", en: "Agents" },
  skills: { zh: "技能", en: "Skills" },
  knowledgeBases: { zh: "知识库", en: "Knowledge bases" },
  mcpServers: { zh: "MCP 服务", en: "MCP servers" },
  forms: { zh: "表单", en: "Forms" },
}

const emptySelection = (): Record<ResourceKey, string[]> => ({
  agents: [],
  skills: [],
  knowledgeBases: [],
  mcpServers: [],
  forms: [],
})
const checkboxClassName = "border-muted-foreground/50 bg-background shadow-xs"

export function ConfigBundleDialog({
  mode,
  onOpenChange,
  locale,
  authHeaders,
  resources,
  initialSelection,
  onImported,
}: ConfigBundleDialogProps) {
  const zh = locale === "zh"
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<Record<ResourceKey, string[]>>(emptySelection)
  const [expanded, setExpanded] = useState<Set<ResourceKey>>(new Set(["agents"]))
  const [includeDependencies, setIncludeDependencies] = useState(true)
  const [includeKnowledgeDocuments, setIncludeKnowledgeDocuments] = useState(false)
  const [includeFormRecords, setIncludeFormRecords] = useState(true)
  const [inspections, setInspections] = useState<InspectedFile[]>([])
  const [policy, setPolicy] = useState<ConflictPolicy>("copy")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (mode !== "export") return
    const next = emptySelection()
    for (const key of resourceKeys) {
      next[key] = initialSelection?.[key] ? [...(initialSelection[key] || [])] : []
    }
    setSelection(next)
  }, [initialSelection, mode, resources])

  const close = (open: boolean) => {
    if (!open) {
      setInspections([])
      setError("")
      setBusy(false)
    }
    onOpenChange(open)
  }

  const toggleResource = (key: ResourceKey, id: string) => {
    setSelection(current => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter(value => value !== id)
        : [...current[key], id],
    }))
  }

  const toggleCategory = (key: ResourceKey) => {
    setSelection(current => ({
      ...current,
      [key]: current[key].length === resources[key].length
        ? []
        : resources[key].map(item => item.id),
    }))
  }

  const exportBundle = async () => {
    if (!authHeaders) return
    setBusy(true)
    setError("")
    try {
      const response = await backendFetch("/api/config-bundles/export", {
        method: "POST",
        authHeaders,
        json: {
          selection,
          options: {
            includeDependencies,
            includeKnowledgeDocuments,
            includeFormRecords,
          },
        },
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

  const inspectFiles = async (files: File[]) => {
    if (!authHeaders || files.length === 0) return
    setBusy(true)
    setError("")
    setInspections([])
    try {
      const results: InspectedFile[] = []
      for (const file of files) {
        const form = new FormData()
        form.append("file", file)
        const response = await backendFetch("/api/config-bundles/inspect", {
          method: "POST",
          authHeaders,
          body: form,
        })
        if (!response.ok) {
          throw new Error(`${file.name}: ${await response.text()}`)
        }
        results.push({ filename: file.name, inspection: await response.json() })
      }
      setInspections(results)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const importBundles = async () => {
    if (!authHeaders || inspections.length === 0) return
    setBusy(true)
    setError("")
    try {
      const results: ConfigBundleImportResult[] = []
      for (const item of inspections) {
        const response = await backendFetch("/api/config-bundles/import", {
          method: "POST",
          authHeaders,
          json: {
            inspectionId: item.inspection.inspectionId,
            conflictPolicy: policy,
          },
        })
        if (!response.ok) {
          throw new Error(`${item.filename}: ${await response.text()}`)
        }
        results.push(await response.json())
      }
      await onImported?.(results)
      close(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  const selectedCount = resourceKeys.reduce((total, key) => total + selection[key].length, 0)
  const totals = inspections.reduce(
    (result, item) => {
      for (const key of resourceKeys) result.resources[key] += item.inspection.resources[key] || 0
      result.conflicts += item.inspection.conflicts.length
      result.missing += item.inspection.missingDependencies.length
      result.documents += item.inspection.knowledgeDocuments
      return result
    },
    {
      resources: {
        agents: 0,
        skills: 0,
        knowledgeBases: 0,
        mcpServers: 0,
        forms: 0,
      } as Record<ResourceKey, number>,
      conflicts: 0,
      missing: 0,
      documents: 0,
    },
  )

  return (
    <Dialog open={mode !== null} onOpenChange={close}>
      <DialogContent
        className={`flex flex-col overflow-hidden ${
          mode === "export"
            ? "h-[90dvh] sm:max-w-4xl"
            : "max-h-[90dvh] sm:max-w-2xl"
        }`}
      >
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="pr-3"
        >
        <div>
        <DialogHeader>
          <DialogTitle>
            {mode === "export"
              ? zh ? "导出配置" : "Export configuration"
              : zh ? "导入配置" : "Import configuration"}
          </DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? zh ? "逐项选择需要写入 .tobconfig 的配置。" : "Select the individual resources to include."
              : zh ? "可同时选择多个 .tobconfig 或 .config 文件，预检后依次导入。" : "Select multiple .tobconfig or .config files, inspect them, then import them in order."}
          </DialogDescription>
        </DialogHeader>

        {mode === "export" ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">{zh ? "已选择" : "Selected"}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{selectedCount}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{zh ? "可导出资源" : "Available resources"}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {resourceKeys.reduce((total, key) => total + resources[key].length, 0)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">{zh ? "资源类型" : "Resource types"}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{resourceKeys.length}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {resourceKeys.map(key => {
                const allSelected = resources[key].length > 0 && selection[key].length === resources[key].length
                const partiallySelected = selection[key].length > 0 && !allSelected
                const isExpanded = expanded.has(key)
                return (
                  <section key={key} className="overflow-hidden rounded-xl bg-card shadow-depth-xs">
                    <div className="flex items-center gap-2 bg-muted/70 p-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setExpanded(current => {
                          const next = new Set(current)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })}
                        aria-label={isExpanded ? zh ? "收起分类" : "Collapse category" : zh ? "展开分类" : "Expand category"}
                      >
                        {isExpanded ? <ChevronDown /> : <ChevronRight />}
                      </Button>
                      <Checkbox
                        className={checkboxClassName}
                        checked={allSelected ? true : partiallySelected ? "indeterminate" : false}
                        onCheckedChange={() => toggleCategory(key)}
                        disabled={resources[key].length === 0}
                        aria-label={`${resourceLabels[key][locale]} ${zh ? "全选" : "select all"}`}
                      />
                      <button
                        type="button"
                        onClick={() => setExpanded(current => {
                          const next = new Set(current)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-1 py-1 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{resourceLabels[key][locale]}</span>
                          <span className="block text-xs text-muted-foreground">
                            {zh
                              ? `${selection[key].length} / ${resources[key].length} 项已选择`
                              : `${selection[key].length} of ${resources[key].length} selected`}
                          </span>
                        </span>
                      </button>
                    </div>
                    {isExpanded && (
                      <ScrollArea className="h-48">
                      <div className="flex flex-col gap-1 p-2">
                        {resources[key].length === 0 ? (
                          <p className="px-2 py-1 text-xs text-muted-foreground">{zh ? "暂无配置" : "No resources"}</p>
                        ) : resources[key].map(item => {
                          const checked = selection[key].includes(item.id)
                          return (
                            <div
                              key={item.id}
                              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                              <Checkbox
                                className={checkboxClassName}
                                checked={checked}
                                onCheckedChange={() => toggleResource(key, item.id)}
                                aria-label={item.name}
                              />
                              <button
                                type="button"
                                onClick={() => toggleResource(key, item.id)}
                                className="min-w-0 flex-1 truncate text-left"
                              >
                                {item.name}
                              </button>
                              <span className="hidden max-w-48 truncate font-mono text-[10px] text-muted-foreground sm:block">{item.id}</span>
                            </div>
                          )
                        })}
                      </div>
                      </ScrollArea>
                    )}
                  </section>
                )
              })}
            </div>

            <div className="flex flex-col gap-2 rounded-xl bg-muted p-3">
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
          </div>
        ) : inspections.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {inspections.map(item => (
                <div key={item.inspection.inspectionId} className="rounded-xl bg-card p-3 shadow-depth-xs">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {resourceKeys.map(key => `${resourceLabels[key][locale]} ${item.inspection.resources[key] || 0}`).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 text-sm sm:grid-cols-3">
              {resourceKeys.map(key => (
                <div key={key} className="flex justify-between gap-3">
                  <span>{resourceLabels[key][locale]}</span>
                  <span className="text-muted-foreground">{totals.resources[key]}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <span>{zh ? "知识库文档" : "Knowledge documents"}</span>
                <span className="text-muted-foreground">{totals.documents}</span>
              </div>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{zh ? "全部文件的冲突策略" : "Conflict policy for all files"}</span>
              <Select
                value={policy}
                onValueChange={(value) => setPolicy(value as ConflictPolicy)}
              >
                <SelectTrigger className="h-10 w-full bg-muted px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="copy">{zh ? "创建副本（默认）" : "Create copies (default)"}</SelectItem>
                    <SelectItem value="overwrite">{zh ? "覆盖当前账户资源" : "Overwrite owned resources"}</SelectItem>
                    <SelectItem value="skip">{zh ? "跳过冲突" : "Skip conflicts"}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            {(totals.conflicts > 0 || totals.missing > 0 || inspections.some(item => item.inspection.warnings.length > 0)) && (
              <div className="flex flex-col gap-1 rounded-xl bg-warning/10 p-3 text-sm">
                <p>{zh ? `冲突：${totals.conflicts}` : `Conflicts: ${totals.conflicts}`}</p>
                <p>{zh ? `缺失依赖：${totals.missing}` : `Missing dependencies: ${totals.missing}`}</p>
                {inspections.flatMap(item => item.inspection.warnings.map(warning => `${item.filename}: ${warning}`)).map(warning => (
                  <p key={warning} className="text-muted-foreground">{warning}</p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl bg-muted text-sm hover:bg-muted/80"
          >
            {busy ? <LoaderCircle className="animate-spin text-primary" /> : <Upload className="text-primary" />}
            {zh ? "选择一个或多个配置包" : "Choose one or more configuration bundles"}
          </Button>
        )}

        <Input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".tobconfig,.config,application/zip,application/vnd.tob.config+zip"
          className="hidden"
          onChange={event => {
            const files = Array.from(event.target.files || [])
            if (files.length) void inspectFiles(files)
            event.currentTarget.value = ""
          }}
        />
        {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        </div>
        </ScrollArea>
        <DialogFooter className="shrink-0">
          {mode === "import" && inspections.length > 0 && (
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {zh ? "重新选择文件" : "Choose again"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            {zh ? "取消" : "Cancel"}
          </Button>
          {mode === "export" && (
            <Button onClick={exportBundle} disabled={busy || selectedCount === 0}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
              {zh ? `导出 ${selectedCount} 项` : `Export ${selectedCount}`}
            </Button>
          )}
          {mode === "import" && inspections.length > 0 && (
            <Button onClick={importBundles} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {zh ? `导入 ${inspections.length} 个文件` : `Import ${inspections.length} files`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
