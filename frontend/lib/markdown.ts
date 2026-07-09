export function markdownToPlainText(markdown: string | null | undefined): string {
  if (!markdown) return ""

  return markdown
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?|```/g, " "))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function truncatePlainText(value: string | null | undefined, maxLength = 120): string {
  const text = markdownToPlainText(value)
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}
