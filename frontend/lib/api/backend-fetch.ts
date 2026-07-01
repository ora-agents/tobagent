import { getLangGraphApiUrl } from "@/lib/constants/api"
import { getDesktopSessionToken } from "@/lib/config/api-runtime"

type HeaderSource = HeadersInit | null | undefined

export interface BackendFetchInit extends Omit<RequestInit, "body"> {
  authHeaders?: HeaderSource
  workspaceHeaders?: HeaderSource
  json?: unknown
  body?: BodyInit | null
  anonymous?: boolean
}

function appendHeaders(target: Headers, source: HeaderSource) {
  if (!source) return
  new Headers(source).forEach((value, key) => {
    target.set(key, value)
  })
}

export function backendUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = getLangGraphApiUrl().replace(/\/+$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}

export function backendFetch(path: string, init: BackendFetchInit = {}) {
  const {
    authHeaders,
    workspaceHeaders,
    headers,
    json,
    body,
    anonymous = false,
    ...requestInit
  } = init

  const mergedHeaders = new Headers()
  const desktopSessionToken = anonymous ? null : getDesktopSessionToken()
  if (desktopSessionToken) {
    mergedHeaders.set("Authorization", `Bearer ${desktopSessionToken}`)
  }
  appendHeaders(mergedHeaders, authHeaders)
  appendHeaders(mergedHeaders, workspaceHeaders)
  appendHeaders(mergedHeaders, headers)

  let requestBody = body
  if (json !== undefined) {
    if (!mergedHeaders.has("Content-Type")) {
      mergedHeaders.set("Content-Type", "application/json")
    }
    requestBody = JSON.stringify(json)
  }

  return fetch(backendUrl(path), {
    credentials: "include",
    ...requestInit,
    headers: mergedHeaders,
    body: requestBody,
  })
}
