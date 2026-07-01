export const DESKTOP_LANGGRAPH_API_URL = 'https://gen.wsiri.cn'

const STORE_FILE = 'settings.json'
const API_URL_STORE_KEY = 'langgraphApiUrl'

type TauriWindow = Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

let runtimeLangGraphApiUrl = getDefaultLangGraphApiUrl()

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const tauriWindow = window as TauriWindow
  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__)
}

export function normalizeLangGraphApiUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Backend URL is required')
  }

  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Backend URL must start with http:// or https://')
  }

  return parsed.toString().replace(/\/+$/, '')
}

export function getDefaultLangGraphApiUrl(): string {
  if (isTauriRuntime()) {
    return DESKTOP_LANGGRAPH_API_URL
  }

  const configuredUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL_EXTERNAL
  let url = configuredUrl

  if (
    typeof window !== 'undefined' &&
    process.env.NODE_ENV === 'development' &&
    !configuredUrl
  ) {
    const hostname = window.location.hostname
    const isLocalAddress =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)

    if (isLocalAddress) {
      url = `http://${hostname}:2025`
    }
  }

  if (!url) {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol
      url = `${protocol}//${window.location.hostname}:2025`
    } else {
      url = 'http://127.0.0.1:2025'
    }
  }

  return normalizeLangGraphApiUrl(url)
}

export function getLangGraphApiUrl(): string {
  return runtimeLangGraphApiUrl
}

export function setRuntimeLangGraphApiUrl(url: string): string {
  runtimeLangGraphApiUrl = normalizeLangGraphApiUrl(url)
  if (process.env.NODE_ENV === 'development') {
    console.info('[LangGraph] Runtime routing to:', runtimeLangGraphApiUrl)
  }
  return runtimeLangGraphApiUrl
}

export async function loadStoredDesktopApiUrl(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load(STORE_FILE)
  const stored = await store.get<string>(API_URL_STORE_KEY)
  return typeof stored === 'string' && stored.trim() ? stored : null
}

export async function saveStoredDesktopApiUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) return
  const { Store } = await import('@tauri-apps/plugin-store')
  const store = await Store.load(STORE_FILE)
  await store.set(API_URL_STORE_KEY, url)
  await store.save()
}
