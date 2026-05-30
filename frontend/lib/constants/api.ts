/**
 * API Constants
 *
 * Configuration constants for API endpoints and keys.
 */

/**
 * Get the public Chat LangChain LangGraph API URL.
 *
 * NEXT_PUBLIC_LANGGRAPH_API_URL points to the public docs-agent deployment.
 * NEXT_PUBLIC_LANGGRAPH_API_URL_EXTERNAL is supported for compatibility with
 * the existing Chat-LangChain-Frontend Vercel deployment.
 */
function getLangGraphApiUrl(): string {
  let url =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL_EXTERNAL

  if (!url && process.env.NODE_ENV === "development") {
    if (typeof window !== "undefined") {
      // In the browser, dynamically route to the host IP/domain we are accessing it from
      url = `http://${window.location.hostname}:2024`
    } else {
      // On the server side (SSR), local loopback is fine
      url = "http://127.0.0.1:2024"
    }
  }

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_LANGGRAPH_API_URL is not defined for public Chat LangChain"
    )
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[LangGraph] Public deployment routing to:", url)
  }

  return url
}

export const LANGGRAPH_API_URL = getLangGraphApiUrl()

// LangGraph Server API key (used for LangGraph client, not LangSmith)
// Note: This should be undefined in browser for security
// LangGraph Cloud deployments need auth disabled or custom auth configured
export const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY

export const USER_RUNTIME_API_KEY_STORAGE = "tobagent-runtime-api-key"

export function getUserRuntimeApiKey(): string | null {
  if (typeof window === "undefined") return null
  const value = window.localStorage.getItem(USER_RUNTIME_API_KEY_STORAGE)
  return value?.trim() || null
}

export function setUserRuntimeApiKey(value: string | null) {
  if (typeof window === "undefined") return
  if (value?.trim()) {
    window.localStorage.setItem(USER_RUNTIME_API_KEY_STORAGE, value.trim())
  } else {
    window.localStorage.removeItem(USER_RUNTIME_API_KEY_STORAGE)
  }
  window.dispatchEvent(new Event("tobagent-runtime-api-key-change"))
}
