/**
 * Content Extraction and Formatting Utilities
 *
 * Functions for extracting and formatting message content from various formats.
 */

import type { ImageAttachment } from "../../types"

/**
 * Extract text content from various message content formats.
 * Handles:
 * - String content
 * - Array content with text objects
 * - Mixed content types
 */
export const extractTextFromContent = (content: any): string => {
  if (typeof content === "string") return content

  if (Array.isArray(content)) {
    return content
      .filter((c: any) => typeof c === "string" || c?.type === "text")
      .map((c: any) => (typeof c === "string" ? c : c.text || ""))
      .join("\n\n")
  }

  return ""
}

const dataUrlPattern = /^data:([^;,]+);base64,([\s\S]+)$/
const attachedFilePattern = /^\*\*File:\s*(.+?)\*\*\s*\n```/m

const getImageUrl = (block: any): string | undefined => {
  const imageUrl = block?.image_url
  if (typeof imageUrl === "string") return imageUrl
  if (imageUrl && typeof imageUrl.url === "string") return imageUrl.url
  if (typeof block?.url === "string") return block.url
  return undefined
}

/**
 * Extract displayable attachments from stored multimodal message content.
 *
 * Locally-sent messages keep attachments in Message.images. After a refresh,
 * LangGraph returns the persisted BaseMessage content instead, so the UI needs
 * to reconstruct attachment cards from content blocks.
 */
export const extractAttachmentsFromContent = (content: any): ImageAttachment[] => {
  if (!Array.isArray(content)) return []

  const attachments: ImageAttachment[] = []

  content.forEach((block: any, index: number) => {
    if (!block || typeof block !== "object") return

    if (block.type === "image_url" || block.image_url) {
      const url = getImageUrl(block)
      if (!url) return

      const dataUrlMatch = url.match(dataUrlPattern)
      const mimeType = dataUrlMatch?.[1] || "image/*"
      const base64 = dataUrlMatch?.[2]

      attachments.push({
        id: `history-attachment-${index}`,
        url,
        base64,
        mimeType,
        name: block.name || "Image",
      })
      return
    }

    if (block.type === "text" && typeof block.text === "string") {
      const fileMatch = block.text.match(attachedFilePattern)
      if (!fileMatch) return

      attachments.push({
        id: `history-attachment-${index}`,
        mimeType: "text/plain",
        name: fileMatch[1],
      })
    }
  })

  return attachments
}
