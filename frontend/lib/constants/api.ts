import { getLangGraphApiUrl } from "@/lib/config/api-runtime"

const dynamicLangGraphApiUrl = new Proxy({}, {
  get(_target, prop) {
    if (prop === Symbol.toPrimitive) {
      return () => getLangGraphApiUrl()
    }
    if (prop === "toString" || prop === "valueOf") {
      return () => getLangGraphApiUrl()
    }
    const value = getLangGraphApiUrl()
    const member = value[prop as keyof string]
    return typeof member === "function" ? member.bind(value) : member
  },
  getPrototypeOf() {
    return String.prototype
  },
}) as string

export { getLangGraphApiUrl }
export const LANGGRAPH_API_URL = dynamicLangGraphApiUrl

// LangGraph Server API key (used for LangGraph client, not LangSmith)
// Note: This should be undefined in browser for security
// LangGraph Cloud deployments need auth disabled or custom auth configured
export const LANGSMITH_API_KEY = process.env.LANGSMITH_API_KEY
