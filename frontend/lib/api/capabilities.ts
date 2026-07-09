import { backendFetch } from "@/lib/api/backend-fetch"

export interface RuntimeCapabilities {
  smsAuth: boolean
  langfuseTracing: boolean
  localDevBypass: boolean
  modules: Record<string, RuntimeModuleCapability>
}

export interface RuntimeModuleCapability {
  enabled: boolean
  category: string
  label: string
  description: string
  requiredEnv: string[]
  optionalEnv: string[]
  defaults: Record<string, unknown>
}

export const DEFAULT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  smsAuth: false,
  langfuseTracing: false,
  localDevBypass: false,
  modules: {},
}

export async function fetchRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const resp = await backendFetch("/api/capabilities", { anonymous: true })
  if (!resp.ok) {
    throw new Error(`Failed to load capabilities: HTTP ${resp.status}`)
  }
  const data = await resp.json()
  const modules = typeof data?.modules === "object" && data.modules !== null
    ? Object.fromEntries(
        Object.entries(data.modules).map(([key, value]) => {
          const moduleData = value as Partial<RuntimeModuleCapability> | null
          return [
            key,
            {
              enabled: moduleData?.enabled === true,
              category: typeof moduleData?.category === "string" ? moduleData.category : "",
              label: typeof moduleData?.label === "string" ? moduleData.label : key,
              description: typeof moduleData?.description === "string" ? moduleData.description : "",
              requiredEnv: Array.isArray(moduleData?.requiredEnv) ? moduleData.requiredEnv.filter((item): item is string => typeof item === "string") : [],
              optionalEnv: Array.isArray(moduleData?.optionalEnv) ? moduleData.optionalEnv.filter((item): item is string => typeof item === "string") : [],
              defaults: typeof moduleData?.defaults === "object" && moduleData.defaults !== null ? moduleData.defaults : {},
            },
          ]
        }),
      )
    : {}

  return {
    smsAuth: data?.smsAuth === true,
    langfuseTracing: data?.langfuseTracing === true,
    localDevBypass: data?.localDevBypass === true,
    modules,
  }
}
