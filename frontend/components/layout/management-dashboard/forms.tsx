import React, { useCallback, useEffect, useMemo, useState } from "react"
import * as ContextMenu from "@radix-ui/react-context-menu"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  FileText,
  GripVertical,
  Hash,
  ListChecks,
  Lock,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  Plus,
  Save,
  Search,
  ToggleLeft,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface CustomFormField {
  id: string
  label: string
  type: "text" | "number" | "date" | "boolean" | "select"
  required: boolean
  options: string[]
}

export interface CustomForm {
  id: string
  name: string
  description: string
  category: string
  fields: CustomFormField[]
  recordCount: number
  createdAt: string
  updatedAt: string
}

export interface CustomFormRecord {
  id: string
  formId: string
  data: Record<string, string | number | boolean | null>
  createdAt: string
  updatedAt: string
}

type CustomFormFieldType = CustomFormField["type"]

export type FormDefinitionState = {
  name: string
  description: string
  category: string
  fields: CustomFormField[]
}

export const SYSTEM_FORM_FIELDS: CustomFormField[] = [
  { id: "createdAt", label: "创建时间", type: "date", required: false, options: [] },
  { id: "updatedAt", label: "更新时间", type: "date", required: false, options: [] },
]

export const SYSTEM_FORM_FIELD_IDS = new Set(SYSTEM_FORM_FIELDS.map(field => field.id))
export const DRAFT_FORM_RECORD_ID_PREFIX = "draft_"

const FORM_FIELD_TYPES: Array<{
  type: CustomFormFieldType
  icon: React.ComponentType<{ className?: string }>
  zh: string
  en: string
}> = [
  { type: "text", icon: FileText, zh: "文本", en: "Text" },
  { type: "number", icon: Hash, zh: "数字", en: "Number" },
  { type: "date", icon: CalendarDays, zh: "日期", en: "Date" },
  { type: "boolean", icon: ToggleLeft, zh: "开关", en: "Boolean" },
  { type: "select", icon: ListChecks, zh: "单选", en: "Select" },
]

function getFieldTypeLabel(type: CustomFormFieldType, locale: string) {
  const item = FORM_FIELD_TYPES.find(fieldType => fieldType.type === type)
  return item ? (locale === "zh" ? item.zh : item.en) : type
}

function createDefaultField(type: CustomFormFieldType, locale: string, index: number): CustomFormField {
  const label = getFieldTypeLabel(type, locale)
  return {
    id: `field_${Date.now()}_${index}`,
    label: locale === "zh" ? `${label}字段` : `${label} field`,
    type,
    required: false,
    options: type === "select" ? (locale === "zh" ? ["选项 A", "选项 B"] : ["Option A", "Option B"]) : [],
  }
}

export function normalizeFieldValue(field: CustomFormField, value: string | number | boolean | null | undefined) {
  if (field.type === "number") {
    if (value === "" || value === null || value === undefined) return null
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  if (field.type === "boolean") {
    return Boolean(value)
  }
  return value ?? ""
}

function isMissingRequiredValue(field: CustomFormField, value: string | number | boolean | null | undefined) {
  if (!field.required) return false
  if (field.type === "boolean") return false
  if (value === null || value === undefined) return true
  if (typeof value === "string") return value.trim().length === 0
  return false
}

export function validateFormRecordData(
  fields: CustomFormField[],
  data: CustomFormRecord["data"],
  locale: string,
) {
  const errors: Record<string, string> = {}
  fields.forEach(field => {
    if (isMissingRequiredValue(field, data?.[field.id])) {
      errors[field.id] = locale === "zh" ? "必填字段不能为空" : "Required field cannot be empty"
    }
  })
  return errors
}

function getSystemFieldLabel(field: CustomFormField, locale: string) {
  if (field.id === "createdAt") return locale === "zh" ? "创建时间" : "Created at"
  if (field.id === "updatedAt") return locale === "zh" ? "更新时间" : "Updated at"
  return field.label
}

function formatRecordTimestamp(value: string, locale: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

interface FormFieldDesignerProps {
  locale: string
  definition: FormDefinitionState
  selectedFieldId: string | null
  onDefinitionChange: (definition: FormDefinitionState) => void
  onSelectedFieldChange: (fieldId: string | null) => void
}

export function FormFieldDesigner({
  locale,
  definition,
  selectedFieldId,
  onDefinitionChange,
  onSelectedFieldChange,
}: FormFieldDesignerProps) {
  const displayFields = [...definition.fields, ...SYSTEM_FORM_FIELDS]
  const selectedSystemField = SYSTEM_FORM_FIELDS.find(field => field.id === selectedFieldId) || null
  const selectedField = selectedSystemField || definition.fields.find(field => field.id === selectedFieldId) || definition.fields[0] || SYSTEM_FORM_FIELDS[0]
  const isSelectedSystemField = Boolean(selectedSystemField)

  const updateFields = (fields: CustomFormField[]) => {
    onDefinitionChange({ ...definition, fields })
  }

  const updateField = (fieldId: string, changes: Partial<CustomFormField>) => {
    updateFields(definition.fields.map(field => field.id === fieldId ? { ...field, ...changes } : field))
  }

  const addField = (type: CustomFormFieldType) => {
    const field = createDefaultField(type, locale, definition.fields.length + 1)
    updateFields([...definition.fields, field])
    onSelectedFieldChange(field.id)
  }

  const removeField = (fieldId: string) => {
    const nextFields = definition.fields.filter(field => field.id !== fieldId)
    updateFields(nextFields)
    onSelectedFieldChange(nextFields[0]?.id || null)
  }

  const moveField = (fieldId: string, direction: -1 | 1) => {
    if (SYSTEM_FORM_FIELD_IDS.has(fieldId)) return
    const index = definition.fields.findIndex(field => field.id === fieldId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= definition.fields.length) return
    const nextFields = [...definition.fields]
    const [field] = nextFields.splice(index, 1)
    nextFields.splice(nextIndex, 0, field)
    updateFields(nextFields)
  }

  const selectedFieldIndex = selectedField
    ? definition.fields.findIndex(field => field.id === selectedField.id)
    : -1
  const canMoveSelectedLeft = !isSelectedSystemField && selectedFieldIndex > 0
  const canMoveSelectedRight = !isSelectedSystemField && selectedFieldIndex >= 0 && selectedFieldIndex < definition.fields.length - 1

  return (
    <div className="grid min-h-[520px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <div className="rounded-xl bg-muted/35 p-3">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold">{locale === "zh" ? "表格字段" : "Table fields"}</h3>
              <p className="text-xs text-muted-foreground">
                {locale === "zh" ? "点击列头选择字段，使用列头操作调整顺序或删除。" : "Select a header to edit it. Use header actions to reorder or delete fields."}
              </p>
            </div>
            <Button size="sm" onClick={() => addField("text")} className="h-8 rounded-lg">
              <Plus className="h-3.5 w-3.5" />
              {locale === "zh" ? "添加文本列" : "Add text column"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {FORM_FIELD_TYPES.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => addField(item.type)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-background px-3 text-sm shadow-depth-xs transition hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20"
                >
                  <Icon className="h-4 w-4" />
                  <span>{locale === "zh" ? item.zh : item.en}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl bg-muted/35 p-3">
          <div className="overflow-x-auto rounded-lg bg-background shadow-depth-xs">
            <div className="min-w-[860px]">
              <div className="grid" style={{ gridTemplateColumns: `56px repeat(${Math.max(displayFields.length, 1)}, minmax(180px, 1fr))` }}>
                <div className="sticky left-0 z-20 flex items-center bg-muted px-3 py-3 text-xs font-semibold text-muted-foreground">#</div>
                {displayFields.length > 0 ? displayFields.map(field => {
                  const isSystemField = SYSTEM_FORM_FIELD_IDS.has(field.id)
                  const isSelected = selectedField?.id === field.id
                  const fieldIndex = definition.fields.findIndex(item => item.id === field.id)
                  return (
                    <div
                      key={field.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectedFieldChange(field.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onSelectedFieldChange(field.id)
                        }
                      }}
                      className={`group min-w-0 border-l px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/20 ${
                        isSelected
                          ? "border-primary/20 bg-primary-soft text-primary"
                          : "border-border/50 bg-muted hover:bg-primary/10"
                      }`}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2">
                          <GripVertical className={`mt-0.5 h-4 w-4 shrink-0 ${isSystemField ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {isSystemField && <Lock className="h-3.5 w-3.5 shrink-0" />}
                              <div className="truncate text-sm font-semibold">{isSystemField ? getSystemFieldLabel(field, locale) : field.label}</div>
                            </div>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="rounded bg-background/80 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                                {getFieldTypeLabel(field.type, locale)}
                              </span>
                              {field.required && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                  {locale === "zh" ? "必填" : "Required"}
                                </span>
                              )}
                              <span className="max-w-[120px] truncate font-mono text-[11px] opacity-75">{field.id}</span>
                            </div>
                          </div>
                        </div>
                        {!isSystemField && (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                moveField(field.id, -1)
                              }}
                              disabled={fieldIndex <= 0}
                              className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                              title={locale === "zh" ? "左移" : "Move left"}
                            >
                              <ArrowUp className="h-3.5 w-3.5 -rotate-90" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                moveField(field.id, 1)
                              }}
                              disabled={fieldIndex < 0 || fieldIndex >= definition.fields.length - 1}
                              className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                              title={locale === "zh" ? "右移" : "Move right"}
                            >
                              <ArrowDown className="h-3.5 w-3.5 -rotate-90" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                removeField(field.id)
                              }}
                              className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title={locale === "zh" ? "删除字段" : "Delete field"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }) : (
                  <div className="border-l border-border/50 bg-muted px-3 py-2 text-sm text-muted-foreground">
                    {locale === "zh" ? "从上方添加字段" : "Add fields above"}
                  </div>
                )}
                {[1, 2, 3].map(row => (
                  <React.Fragment key={row}>
                    <div className="sticky left-0 z-10 border-t border-border/40 bg-background px-3 py-2 font-mono text-xs text-muted-foreground">{row}</div>
                    {displayFields.map(field => (
                      <div
                        key={`${row}-${field.id}`}
                        className={`min-h-10 border-l border-t border-border/40 px-3 py-2 text-sm text-muted-foreground ${
                          selectedField?.id === field.id ? "bg-primary/5" : ""
                        }`}
                      >
                        {row === 1
                          ? SYSTEM_FORM_FIELD_IDS.has(field.id)
                            ? formatRecordTimestamp(new Date().toISOString(), locale)
                            : field.type === "select"
                              ? field.options[0] || ""
                              : field.type === "boolean" ? "false" : ""
                          : ""}
                      </div>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{locale === "zh" ? `${definition.fields.length} 个自定义字段，${SYSTEM_FORM_FIELDS.length} 个系统字段` : `${definition.fields.length} custom fields, ${SYSTEM_FORM_FIELDS.length} system fields`}</span>
            <span>{locale === "zh" ? "系统字段固定在记录末尾" : "System fields stay at the end"}</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-muted/45 p-4 xl:sticky xl:top-6 xl:self-start">
        {selectedField ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-muted-foreground">{locale === "zh" ? "字段属性" : "Field properties"}</div>
                <h3 className="mt-1 truncate text-base font-semibold">
                  {isSelectedSystemField ? getSystemFieldLabel(selectedField, locale) : selectedField.label}
                </h3>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{selectedField.id}</p>
              </div>
              {isSelectedSystemField ? (
                <div className="rounded-md bg-primary-soft p-1.5 text-primary" title={locale === "zh" ? "系统字段" : "System field"}>
                  <Lock className="h-4 w-4" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => removeField(selectedField.id)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title={locale === "zh" ? "删除字段" : "Delete field"}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="rounded-lg bg-background p-3">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={!canMoveSelectedLeft} onClick={() => moveField(selectedField.id, -1)} className="rounded-lg">
                  <ArrowUp className="h-3.5 w-3.5 -rotate-90" />
                  {locale === "zh" ? "左移" : "Move left"}
                </Button>
                <Button variant="outline" size="sm" disabled={!canMoveSelectedRight} onClick={() => moveField(selectedField.id, 1)} className="rounded-lg">
                  <ArrowDown className="h-3.5 w-3.5 -rotate-90" />
                  {locale === "zh" ? "右移" : "Move right"}
                </Button>
              </div>
            </div>
            <div className="space-y-4 rounded-lg bg-background p-3">
              <FormField label={locale === "zh" ? "字段名称" : "Label"}>
                <Input
                  value={isSelectedSystemField ? getSystemFieldLabel(selectedField, locale) : selectedField.label}
                  onChange={(event) => updateField(selectedField.id, { label: event.target.value })}
                  disabled={isSelectedSystemField}
                />
              </FormField>
              <FormField label={locale === "zh" ? "字段 ID" : "Field ID"}>
                <Input
                  value={selectedField.id}
                  onChange={(event) => updateField(selectedField.id, { id: event.target.value.trim() })}
                  disabled={isSelectedSystemField}
                  className="font-mono text-xs"
                />
              </FormField>
              <FormField label={locale === "zh" ? "字段类型" : "Type"}>
                <Select
                  value={selectedField.type}
                  disabled={isSelectedSystemField}
                  onValueChange={(value) => updateField(selectedField.id, {
                    type: value as CustomFormFieldType,
                    options: value === "select" ? selectedField.options : [],
                  })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORM_FIELD_TYPES.map(item => (
                      <SelectItem key={item.type} value={item.type}>
                        {locale === "zh" ? item.zh : item.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <label className="flex cursor-pointer items-center justify-between rounded-lg bg-muted/70 px-3 py-2 text-sm">
                <span>{locale === "zh" ? "必填" : "Required"}</span>
                <input
                  type="checkbox"
                  checked={selectedField.required}
                  onChange={(event) => updateField(selectedField.id, { required: event.target.checked })}
                  disabled={isSelectedSystemField}
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>
            {selectedField.type === "select" && (
              <div className="rounded-lg bg-background p-3">
                <FormField
                  label={locale === "zh" ? "选项" : "Options"}
                  description={locale === "zh" ? "每行一个选项。" : "One option per line."}
                >
                  <Textarea
                    value={selectedField.options.join("\n")}
                    onChange={(event) => updateField(selectedField.id, {
                      options: event.target.value.split("\n").map(item => item.trim()).filter(Boolean),
                    })}
                    className="min-h-32"
                  />
                </FormField>
              </div>
            )}
            {isSelectedSystemField && (
              <p className="rounded-lg bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {locale === "zh" ? "系统字段由平台自动维护，不能修改、删除或调整顺序。" : "System fields are maintained automatically and cannot be changed, deleted, or reordered."}
              </p>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            {locale === "zh" ? "选择一个字段进行配置。" : "Select a field to configure it."}
          </div>
        )}
      </div>
    </div>
  )
}

interface EditableRecordCellProps {
  field: CustomFormField
  value: string | number | boolean | null | undefined
  error?: string
  onCommit: (value: string | number | boolean | null) => void
}

function EditableRecordCell({ field, value, error, onCommit }: EditableRecordCellProps) {
  const [draft, setDraft] = useState(value ?? "")

  useEffect(() => {
    setDraft(value ?? "")
  }, [value])

  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onCommit(event.target.checked)}
        className="h-4 w-4 accent-primary"
        title={error}
      />
    )
  }

  if (field.type === "select") {
    return (
      <select
        value={String(value ?? "")}
        onChange={(event) => onCommit(event.target.value)}
        title={error}
        className={`h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none focus:ring-0 ${error ? "bg-destructive/10 text-destructive" : ""}`}
      >
        <option value=""></option>
        {field.options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={String(draft)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(normalizeFieldValue(field, draft))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur()
        }
      }}
      title={error}
      className={`h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none focus:ring-0 ${error ? "bg-destructive/10 text-destructive" : ""}`}
    />
  )
}

interface FormRecordsTableProps {
  locale: string
  form: CustomForm
  records: CustomFormRecord[]
  total: number
  page: number
  query: string
  dirtyRecordIds: Set<string>
  validationErrors: Record<string, Record<string, string>>
  onQueryChange: (query: string) => void
  onPageChange: (page: number) => void
  onAddRecord: () => void
  onDeleteRecord: (recordId: string) => void
  onUpdateCell: (record: CustomFormRecord, field: CustomFormField, value: string | number | boolean | null) => void
  onSaveDirtyRecords: () => Promise<void>
}

export function FormRecordsTable({
  locale,
  form,
  records,
  total,
  page,
  query,
  dirtyRecordIds,
  validationErrors,
  onQueryChange,
  onPageChange,
  onAddRecord,
  onDeleteRecord,
  onUpdateCell,
  onSaveDirtyRecords,
}: FormRecordsTableProps) {
  const rowColumnWidth = 56
  const recordColumnWidth = 192
  const stickyColumnOverlap = 1
  const [pinnedFieldIds, setPinnedFieldIds] = useState<Set<string>>(new Set())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const allRecordFields = useMemo(() => [...form.fields, ...SYSTEM_FORM_FIELDS], [form.fields])
  const orderedRecordFields = useMemo(() => {
    const pinnedFields = allRecordFields.filter(field => pinnedFieldIds.has(field.id))
    const unpinnedFields = allRecordFields.filter(field => !pinnedFieldIds.has(field.id))
    return [...pinnedFields, ...unpinnedFields]
  }, [allRecordFields, pinnedFieldIds])

  const togglePinnedField = useCallback((fieldId: string) => {
    setPinnedFieldIds(prev => {
      const next = new Set(prev)
      if (next.has(fieldId)) next.delete(fieldId)
      else next.add(fieldId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!isFullscreen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  const getStickyColumnStyle = (columnId: string): React.CSSProperties | undefined => {
    if (columnId === "_row") return { left: 0 }
    if (!pinnedFieldIds.has(columnId)) return undefined
    const pinnedIndex = allRecordFields
      .filter(field => pinnedFieldIds.has(field.id))
      .findIndex(field => field.id === columnId)
    if (pinnedIndex >= 0) return { left: rowColumnWidth + pinnedIndex * recordColumnWidth - stickyColumnOverlap }
    return undefined
  }

  const getStickyColumnClass = (columnId: string, isHeader = false) => {
    if (columnId === "_row" || pinnedFieldIds.has(columnId)) {
      return `sticky ${isHeader ? "z-30 bg-muted" : "z-20 bg-background group-hover/record:bg-primary/5"} shadow-[1px_0_0_var(--border)]`
    }
    return ""
  }

  const renderFieldHeader = useCallback((field: CustomFormField, isSystemField = false) => (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="min-w-0 cursor-context-menu">
          <div className="flex min-w-0 items-center gap-1.5">
            {isSystemField && <Lock className="h-3.5 w-3.5 shrink-0 text-primary" />}
            {pinnedFieldIds.has(field.id) && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
            <div className="truncate text-sm font-semibold">
              {isSystemField ? getSystemFieldLabel(field, locale) : field.label}
              {!isSystemField && field.required ? <span className="text-destructive"> *</span> : null}
            </div>
          </div>
          <div className="truncate font-mono text-[11px] font-normal text-muted-foreground">
            {isSystemField ? "system" : field.type}
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-50 min-w-44 rounded-md bg-popover p-1 text-popover-foreground shadow-depth-lg">
          <ContextMenu.Item
            onSelect={() => togglePinnedField(field.id)}
            className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent"
          >
            {pinnedFieldIds.has(field.id) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {pinnedFieldIds.has(field.id)
              ? (locale === "zh" ? "取消固定字段" : "Unpin field")
              : (locale === "zh" ? "固定字段" : "Pin field")}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  ), [locale, pinnedFieldIds, togglePinnedField])

  const columns = useMemo<ColumnDef<CustomFormRecord>[]>(() => {
    const recordColumns: ColumnDef<CustomFormRecord>[] = orderedRecordFields.map(field => {
      const isSystemField = SYSTEM_FORM_FIELD_IDS.has(field.id)
      return {
        id: field.id,
        header: () => renderFieldHeader(field, isSystemField),
        cell: ({ row }) => isSystemField ? (
          <span className="block truncate px-2 text-sm text-muted-foreground">
            {formatRecordTimestamp(field.id === "createdAt" ? row.original.createdAt : row.original.updatedAt, locale)}
          </span>
        ) : (
          <EditableRecordCell
            field={field}
            value={row.original.data?.[field.id]}
            error={validationErrors[row.original.id]?.[field.id]}
            onCommit={(value) => onUpdateCell(row.original, field, value)}
          />
        ),
      }
    })
    return [
      {
        id: "_row",
        header: "#",
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{(page - 1) * 25 + row.index + 1}</span>,
      },
      ...recordColumns,
    ]
  }, [locale, onUpdateCell, orderedRecordFields, page, renderFieldHeader, validationErrors])

  const table = useReactTable({
    data: records,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const dirtyCount = dirtyRecordIds.size
  const hasValidationErrors = Object.values(validationErrors).some(fields => Object.keys(fields).length > 0)
  const tableMinWidth = rowColumnWidth + orderedRecordFields.length * recordColumnWidth
  const showPagination = total > 25

  return (
    <div className={`min-h-0 ${isFullscreen ? "fixed inset-0 z-[100] flex flex-col rounded-none bg-background" : "rounded-xl bg-muted/35"}`}>
      <div className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between ${isFullscreen ? "bg-muted" : ""}`}>
        <div>
          <h3 className="text-sm font-semibold">{locale === "zh" ? "记录表格" : "Records table"}</h3>
          <p className="text-xs text-muted-foreground">
            {total} {locale === "zh"
              ? "条记录，编辑后点击保存并校验必填项；删除记录请在对应行点击右键。"
              : "records. Save edits to validate required fields; right-click a row to delete it."}
          </p>
          {hasValidationErrors && (
            <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {locale === "zh" ? "请补全标红的必填字段后再保存。" : "Complete highlighted required fields before saving."}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value)
                onPageChange(1)
              }}
              placeholder={locale === "zh" ? "搜索记录" : "Search records"}
              className="h-8 rounded-lg pl-8 text-xs"
            />
          </div>
          <Button size="sm" onClick={onAddRecord} className="h-8 rounded-lg">
            <Plus className="h-3.5 w-3.5" />
            {locale === "zh" ? "新增行" : "New row"}
          </Button>
          <Button
            size="sm"
            onClick={() => void onSaveDirtyRecords()}
            disabled={dirtyCount === 0}
            className="h-8 rounded-lg"
          >
            <Save className="h-3.5 w-3.5" />
            {locale === "zh" ? `保存 ${dirtyCount || ""}` : `Save ${dirtyCount || ""}`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(value => !value)}
            className="h-8 rounded-lg"
            title={isFullscreen
              ? (locale === "zh" ? "退出全屏（Esc）" : "Exit fullscreen (Esc)")
              : (locale === "zh" ? "全屏填写" : "Fill in fullscreen")}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {isFullscreen ? (locale === "zh" ? "退出全屏" : "Exit fullscreen") : (locale === "zh" ? "全屏" : "Fullscreen")}
          </Button>
        </div>
      </div>
      <ScrollArea
        className={`bg-background ${isFullscreen ? "min-h-0 flex-1" : "max-h-[560px] rounded-b-xl"}`}
        contentClassName="!w-full min-w-0"
        scrollbars="both"
        viewportClassName={isFullscreen ? undefined : "!h-auto max-h-[560px]"}
      >
        <table
          className="w-full table-fixed border-separate border-spacing-0"
          style={{ minWidth: tableMinWidth }}
        >
          <colgroup>
            <col style={{ width: rowColumnWidth }} />
            {orderedRecordFields.map(field => (
              <col key={field.id} style={{ width: recordColumnWidth }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-30">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="bg-muted">
                {headerGroup.headers.map(header => (
                  <th
                    key={header.id}
                    style={getStickyColumnStyle(header.id)}
                    className={`border-r border-border/50 px-3 py-2 text-left align-top ${header.id === "_row" ? "w-14" : "w-48"} ${getStickyColumnClass(header.id, true)}`}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length > 0 ? table.getRowModel().rows.map(row => (
              <ContextMenu.Root key={row.id}>
                <ContextMenu.Trigger asChild>
                  <tr className="group/record cursor-context-menu hover:bg-primary/5">
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        style={getStickyColumnStyle(cell.column.id)}
                        className={`h-11 border-r border-t border-border/40 px-2 py-1 align-middle ${getStickyColumnClass(cell.column.id)}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 min-w-44 rounded-md bg-popover p-1 text-popover-foreground shadow-depth-lg">
                    <ContextMenu.Item
                      onSelect={() => onDeleteRecord(row.original.id)}
                      className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none focus:bg-destructive/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      {locale === "zh" ? "删除记录" : "Delete record"}
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            )) : (
              <tr>
                <td colSpan={Math.max(1, columns.length)} className="h-28 text-center text-sm text-muted-foreground">
                  {locale === "zh" ? "暂无记录，点击新增行开始录入。" : "No records yet. Add a row to start."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
      {showPagination && (
        <div className="flex items-center justify-between p-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className="h-8 rounded-lg">
            {locale === "zh" ? "上一页" : "Previous"}
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" disabled={page * 25 >= total} onClick={() => onPageChange(page + 1)} className="h-8 rounded-lg">
            {locale === "zh" ? "下一页" : "Next"}
          </Button>
        </div>
      )}
    </div>
  )
}
