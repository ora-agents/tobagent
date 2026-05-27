/**
 * UUID generation utility with secure context fallback.
 *
 * `crypto.randomUUID()` is only available in secure contexts (HTTPS or localhost).
 * When accessing via LAN IP (e.g., http://192.168.x.x:3000), it is undefined.
 * This utility falls back to a random string generator in non-secure contexts.
 */

/**
 * Generate a UUID v4 string.
 * Uses `crypto.randomUUID()` when available (secure contexts),
 * otherwise falls back to a `Math.random()`-based implementation.
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  // Fallback: RFC 4122 v4 UUID using Math.random
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
