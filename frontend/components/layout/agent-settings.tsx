"use client"

import { useState, useEffect, useCallback } from "react"
import { Settings, Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  fetchAvailableModels,
  getDefaultModel,
  getModelDisplayName,
  type ModelOption,
  type AgentType,
} from "@/lib/config/deployment-config"
import { useT } from "@/lib/i18n"

/** Available codebase repositories organized by category */
export const CODEBASE_REPOS = {
  langchain: {
    label: "LangChain",
    repos: [
      { name: "langchain", private: false },
      { name: "langchain-mcp-adapters", private: false },
      { name: "deepagents", private: false },
    ],
  },
  langgraph: {
    label: "LangGraph",
    repos: [
      { name: "langgraph", private: false },
      { name: "langgraphjs", private: false },
      { name: "helm", private: false },
      { name: "langgraph-api", private: true },
      { name: "lgp-operator", private: true },
    ],
  },
  langsmith: {
    label: "LangSmith",
    repos: [
      { name: "langsmith-sdk", private: false },
      { name: "langchainplus", private: true },
    ],
  },
} as const

type CodebaseCategory = keyof typeof CODEBASE_REPOS

const getRepos = (category: CodebaseCategory, includePrivate: boolean) =>
  CODEBASE_REPOS[category].repos.filter(r => includePrivate || !r.private)

const getCategoryPaths = (category: CodebaseCategory, includePrivate: boolean): string[] =>
  getRepos(category, includePrivate).map(r => `${category}/${r.name}`)

const getAllPaths = (includePrivate: boolean): string[] =>
  Object.keys(CODEBASE_REPOS).flatMap(cat => getCategoryPaths(cat as CodebaseCategory, includePrivate))

export interface AgentConfig {
  model: string
  modelTemperature: number
  recursionLimit: number
  agentType: AgentType
  /** Selected repos for codebase_agent (empty = all repos). Format: "category/repo" */
  repos?: string[]
}

interface AgentSettingsProps {
  config: AgentConfig
  onConfigChange: (config: AgentConfig) => void
  onShowShortcuts?: () => void
  forceShowTooltip?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fixedModel?: string | null
}

export function AgentSettings({ config, onConfigChange, onShowShortcuts, forceShowTooltip, open, onOpenChange, fixedModel }: AgentSettingsProps) {
  const t = useT()
  const [recursionLimitInput, setRecursionLimitInput] = useState((config.recursionLimit ?? 100).toString())
  const [temperatureInput, setTemperatureInput] = useState((config.modelTemperature ?? 1).toString())
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)

  // Fetch models from OpenAI-compatible API on mount
  useEffect(() => {
    fetchAvailableModels().then((models) => {
      setAvailableModels(models)
      setModelsLoading(false)
    })
  }, [])

  // Force show tooltip when forceShowTooltip changes
  useEffect(() => {
    if (forceShowTooltip && forceShowTooltip > 0) {
      setTooltipOpen(true)
      const timer = setTimeout(() => setTooltipOpen(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [forceShowTooltip])

  // Sync recursionLimitInput when config prop changes
  useEffect(() => {
    setRecursionLimitInput((config.recursionLimit ?? 100).toString())
  }, [config.recursionLimit])

  useEffect(() => {
    setTemperatureInput((config.modelTemperature ?? 1).toString())
  }, [config.modelTemperature])

  const lockedModel = fixedModel?.trim() || null
  const displayedModel = lockedModel || config.model

  // Once models are loaded, ensure the persisted global model is in the list.
  // Agent-specific fixed models intentionally do not mutate the global setting.
  useEffect(() => {
    if (lockedModel) return
    if (modelsLoading || availableModels.length === 0) return
    if (!availableModels.includes(config.model as ModelOption)) {
      const defaultModel = getDefaultModel() || availableModels[0]
      if (defaultModel) {
        console.warn(`Model ${config.model} not available. Resetting to ${defaultModel}`)
        onConfigChange({ ...config, model: defaultModel })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoading, availableModels, lockedModel])

  const handleModelChange = useCallback((model: string) => {
    if (lockedModel) return
    onConfigChange({ ...config, model })
  }, [config, lockedModel, onConfigChange])

  const handleTemperatureChange = useCallback((value: string) => {
    setTemperatureInput(value)
    const temperature = Number(value)
    if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) {
      onConfigChange({ ...config, modelTemperature: temperature })
    }
  }, [config, onConfigChange])

  const handleRecursionLimitChange = useCallback((value: string) => {
    // Allow typing and deleting
    setRecursionLimitInput(value)

    // Only update config if it's a valid number
    const limit = parseInt(value, 10)
    if (!isNaN(limit) && limit > 0) {
      onConfigChange({ ...config, recursionLimit: limit })
    }
  }, [config, onConfigChange])

  // Repo selection handlers
  const selectedRepos = config.repos ?? []
  const isPublicOnly = false
  const showRepoSelector = false
  const includePrivate = false

  const updateRepos = useCallback((repos: string[]) => {
    onConfigChange({ ...config, repos })
  }, [config, onConfigChange])

  const toggleRepo = useCallback((repoPath: string) => {
    const current = config.repos ?? []
    updateRepos(current.includes(repoPath) ? current.filter(r => r !== repoPath) : [...current, repoPath])
  }, [config.repos, updateRepos])

  const selectCategory = useCallback((category: CodebaseCategory) => {
    updateRepos([...new Set([...selectedRepos, ...getCategoryPaths(category, includePrivate)])])
  }, [selectedRepos, updateRepos, includePrivate])

  const deselectCategory = useCallback((category: CodebaseCategory) => {
    const paths = getCategoryPaths(category, includePrivate)
    updateRepos(selectedRepos.filter(r => !paths.includes(r)))
  }, [selectedRepos, updateRepos, includePrivate])

  return (
    <TooltipProvider delayDuration={0}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hover:bg-primary/10 hover:text-primary"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1 text-xs">
              <div><span className="font-semibold">{t.model}:</span> {getModelDisplayName(displayedModel as ModelOption)}</div>
              <div><span className="font-semibold">{t.modelTemperatureLabel}:</span> {config.modelTemperature ?? 1}</div>
              <div><span className="font-semibold">{t.recursionLimitLabel}:</span> {config.recursionLimit ?? 100}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t.agentSettings}</DialogTitle>
          <DialogDescription>
            {t.configureAgent}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {showRepoSelector && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Repositories{isPublicOnly && ' (public only)'}</Label>
                <div className="flex gap-2 text-[10px]">
                  <Button variant="unstyled" type="button" onClick={() => updateRepos(getAllPaths(includePrivate))} className="text-primary hover:underline">
                    Select all
                  </Button>
                  <Button variant="unstyled" type="button" onClick={() => updateRepos([])} className="text-muted-foreground hover:underline">
                    Clear
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {(Object.entries(CODEBASE_REPOS) as [CodebaseCategory, typeof CODEBASE_REPOS[CodebaseCategory]][]).map(([category, { label }]) => {
                  const repos = getRepos(category, includePrivate)
                  if (repos.length === 0) return null
                  const paths = getCategoryPaths(category, includePrivate)
                  const allSelected = paths.every(p => selectedRepos.includes(p))
                  const anySelected = paths.some(p => selectedRepos.includes(p))
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-1 text-[10px]">
                        <span className="font-medium text-muted-foreground">{label}</span>
                        {anySelected && (
                          <Button variant="unstyled" type="button" onClick={() => deselectCategory(category)} className="text-primary/70 hover:text-primary hover:underline">
                            clear
                          </Button>
                        )}
                        {!allSelected && (
                          <Button variant="unstyled" type="button" onClick={() => selectCategory(category)} className="text-primary/70 hover:text-primary hover:underline">
                            all
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {repos.map(({ name }) => {
                          const path = `${category}/${name}`
                          const selected = selectedRepos.includes(path)
                          return (
                            <label key={path} onClick={() => toggleRepo(path)} className="flex items-center gap-1.5 cursor-pointer group">
                              <span className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
                                selected ? 'bg-primary border-primary' : 'border-muted-foreground/40 group-hover:border-primary/50'
                              }`}>
                                {selected && (
                                  <svg className="w-2 h-2 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </span>
                              <span className="text-xs">{name}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {selectedRepos.length === 0 ? 'No filter (searches all)' : `${selectedRepos.length} selected`}
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="model">{t.model}</Label>
            <Select value={displayedModel} onValueChange={handleModelChange} disabled={modelsLoading || !!lockedModel}>
              <SelectTrigger id="model">
                <SelectValue placeholder={modelsLoading ? t.loadingModels : t.selectModel} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {lockedModel && !availableModels.includes(lockedModel as ModelOption) && (
                    <SelectItem value={lockedModel}>
                      {getModelDisplayName(lockedModel as ModelOption)}
                    </SelectItem>
                  )}
                  {availableModels.map((modelId) => (
                    <SelectItem key={modelId} value={modelId}>
                      {getModelDisplayName(modelId)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model-temperature">{t.modelTemperature}</Label>
            <Input
              id="model-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperatureInput}
              onChange={(e) => handleTemperatureChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.modelTemperatureDesc}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recursion-limit">{t.recursionLimit}</Label>
            <Input
              id="recursion-limit"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={recursionLimitInput}
              onChange={(e) => handleRecursionLimitChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t.recursionLimitDesc}
            </p>
          </div>
        </div>
        {onShowShortcuts && (
          <div className="border-t pt-3 mt-0">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground active:text-black"
              onClick={onShowShortcuts}
            >
              <Keyboard className="w-4 h-4" />
              {t.viewKeyboardShortcuts}
            </Button>
          </div>
        )}
      </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
