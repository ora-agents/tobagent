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
  const configuredUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL_EXTERNAL
  let url = configuredUrl

  if (
    typeof window !== "undefined" &&
    process.env.NODE_ENV === "development" &&
    !configuredUrl
  ) {
    const hostname = window.location.hostname
    const isLocalAddress =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)

    if (isLocalAddress) {
      url = `http://${hostname}:2025`
    }
  }

  if (!url) {
    if (typeof window !== "undefined") {
      const protocol = window.location.protocol
      url = `${protocol}//${window.location.hostname}:2025`
    } else {
      url = "http://127.0.0.1:2025"
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
