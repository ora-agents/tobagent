/**
 * LangGraph Client Factory
 *
 * Creates authenticated LangGraph SDK clients for API requests.
 * Browser clients authenticate with the HttpOnly session cookie.
 */

import { Client } from "@langchain/langgraph-sdk"
import { getLangGraphApiUrl, LANGSMITH_API_KEY } from "@/lib/constants/api"
import { getDesktopSessionToken } from "@/lib/config/api-runtime"

/**
 * Create a LangGraph client instance with authentication.
 *
 * @param userId - Current logged-in user id, used to delay client creation until auth is ready
 * @throws Error if userId is not provided
 *
 * @example
 * ```typescript
 * const client = createLangGraphClient(userId)
 * const threads = await client.threads.search({ metadata: { user_id: userId } })
 * ```
 */
export function createLangGraphClient(
  userId: string | undefined,
  extraHeaders: Record<string, string> = {},
): Client {
  if (!userId) {
    throw new Error(
      "User ID required for authentication. Ensure user is logged in before making requests."
    )
  }

  const desktopSessionToken = getDesktopSessionToken()
  const headers: Record<string, string> = {
    ...(desktopSessionToken ? { Authorization: `Bearer ${desktopSessionToken}` } : {}),
    ...extraHeaders,
  }

  // Optional X-Auth-Key for LangGraph debugging or deployment-level gating.
  const authKey = process.env.NEXT_PUBLIC_LANGGRAPH_AUTH_KEY
  if (authKey) {
    headers["X-Auth-Key"] = authKey
  }

  return new Client({
    apiUrl: getLangGraphApiUrl(),
    apiKey: LANGSMITH_API_KEY,
    defaultHeaders: headers,
    onRequest: (_url, init) => ({ ...init, credentials: "include" }),
  })
}
