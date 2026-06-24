import { ScrollArea } from "@/components/ui/scroll-area"

export interface Skill {
  id: string
  name: string
  description: string
  content: string
  createdAt: string
  updatedAt: string
}

export const DEFAULT_SKILL_TEMPLATE = `---
name: my-skill
description: Describe what this skill does and when to use it. Include clear trigger situations, major capabilities, and important constraints.
license: Apache-2.0
compatibility: Requires Python 3.11+, bash, and internet access
metadata:
  author: your-org
  version: "1.0.0"
  category: engineering
allowed-tools: Bash Read Write Edit
---

# Purpose

This skill helps the agent perform a specific task reliably and consistently.

Use this skill when:
- The user asks for this exact kind of task.
- The task matches the trigger conditions described in \`description\`.
- The task requires the conventions, constraints, or workflows defined here.

Do not use this skill when:
- The request is unrelated.
- The environment requirements are not available.
- Another specialized skill is a better match.

# Scope

This skill is responsible for:
- Task A
- Task B
- Task C

This skill is not responsible for:
- External approvals
- Manual dashboard-only operations
- Tasks requiring unsupported tools

# Inputs

Expected inputs may include:
- User goal
- Source files
- Environment constraints
- Desired output format

Before starting, confirm:
1. What the user wants produced.
2. Which files or inputs are available.
3. Any constraints on tools, format, or style.

# Workflow

1. Understand the user's objective.
2. Identify required files, parameters, and constraints.
3. Choose the correct approach using the decision rules below.
4. Execute the task in the required order.
5. Validate the output.
6. Return results in the expected format.

# Decision rules

| Situation | Action |
|---|---|
| Input is incomplete | Ask for the missing minimum details |
| Multiple valid strategies exist | Choose the simplest one that satisfies constraints |
| A required dependency is missing | Stop and explain what is missing |
| A step is risky or destructive | Ask for confirmation first |

# Constraints

Always follow these rules:
- Prefer deterministic, repeatable steps.
- Do not assume unavailable tools.
- Do not fabricate files, results, or external states.
- Preserve user data unless explicitly told to modify it.
- Surface blocking issues early.

# Output requirements

The final result should:
- Match the requested format
- Include only necessary explanation
- Be validated before returning
- Highlight any assumptions or limitations

# Validation checklist

Before finishing, verify:
- The output is complete
- The format is correct
- The task requirements were satisfied
- No forbidden action was taken
- Any important caveats were stated

# Edge cases

Handle these carefully:
- Missing inputs
- Invalid file formats
- Partial success
- Conflicting user instructions
- Unsupported environments

# Common mistakes

Avoid:
- Using deprecated files or APIs
- Skipping required validation
- Choosing tools not allowed in this environment
- Producing verbose output when concise output is expected

# References

For detailed guidance, see:
- [Reference guide](references/REFERENCE.md)
- [Examples](references/EXAMPLES.md)

# Scripts

If needed, use:
- \`scripts/run.sh\`
- \`scripts/process.py\`
`

export function parseSkillFrontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let name = ""
  let description = ""
  
  if (match) {
    const yamlContent = match[1]
    const nameMatch = yamlContent.match(/^name:\s*(.+)$/m)
    const descMatch = yamlContent.match(/^description:\s*(.+)$/m)
    if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
    if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '')
  }
  
  return {
    name: name || "Untitled Skill",
    description: description || "No description provided."
  }
}

type SkillSectionBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }

export interface ParsedSkillView {
  frontmatter: Record<string, string>
  metadata: Record<string, string>
  allowedTools: string[]
  sections: Array<{
    title: string
    blocks: SkillSectionBlock[]
  }>
  fallbackBlocks: SkillSectionBlock[]
}

const stripYamlValue = (value: string) => value.trim().replace(/^['"]|['"]$/g, "")

export function parseSkillForView(content: string): ParsedSkillView {
  const frontmatter: Record<string, string> = {}
  const metadata: Record<string, string> = {}
  let allowedTools: string[] = []
  let body = content.trim()
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)

  if (match) {
    body = content.slice(match[0].length).trim()
    const lines = match[1].split(/\r?\n/)
    let nestedKey: string | null = null

    for (const line of lines) {
      if (!line.trim()) continue

      const nestedListMatch = line.match(/^\s*-\s+(.+)$/)
      if (nestedListMatch && nestedKey === "allowed-tools") {
        allowedTools.push(stripYamlValue(nestedListMatch[1]))
        continue
      }

      const nestedMatch = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/)
      if (nestedMatch && nestedKey === "metadata") {
        metadata[nestedMatch[1]] = stripYamlValue(nestedMatch[2])
        continue
      }

      const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
      if (!keyMatch) continue

      const key = keyMatch[1]
      const value = stripYamlValue(keyMatch[2])
      nestedKey = value ? null : key

      if (key === "metadata") continue
      if (key === "allowed-tools") {
        allowedTools = value
          .split(/[,\s]+/)
          .map(tool => tool.trim())
          .filter(Boolean)
      } else {
        frontmatter[key] = value
      }
    }
  }

  const sections = parseSkillSections(body)
  const fallbackBlocks = sections.length === 0 ? parseSkillBlocks(body) : []

  return { frontmatter, metadata, allowedTools, sections, fallbackBlocks }
}

function parseSkillSections(body: string): ParsedSkillView["sections"] {
  const sections: ParsedSkillView["sections"] = []
  let currentTitle = ""
  let currentLines: string[] = []

  const flush = () => {
    if (!currentTitle && currentLines.every(line => !line.trim())) return
    sections.push({
      title: currentTitle || "Overview",
      blocks: parseSkillBlocks(currentLines.join("\n")),
    })
  }

  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      flush()
      currentTitle = heading[1].trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  flush()
  return sections
}

function parseSkillBlocks(text: string): SkillSectionBlock[] {
  const blocks: SkillSectionBlock[] = []
  const lines = text.split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()

    if (!line) {
      index += 1
      continue
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index].trim())
        index += 1
      }
      const table = parseSkillTable(tableLines)
      if (table) blocks.push(table)
      continue
    }

    const listMatch = line.match(/^([-*]|\d+\.)\s+(.+)$/)
    if (listMatch) {
      const ordered = /^\d+\./.test(listMatch[1])
      const items: string[] = []
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(/^([-*]|\d+\.)\s+(.+)$/)
        if (!itemMatch || /^\d+\./.test(itemMatch[1]) !== ordered) break
        items.push(cleanSkillInlineText(itemMatch[2]))
        index += 1
      }
      blocks.push({ type: "list", ordered, items })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index].trim()
      if (!current) break
      if (current.startsWith("|") || /^([-*]|\d+\.)\s+/.test(current)) break
      paragraphLines.push(current)
      index += 1
    }
    blocks.push({ type: "paragraph", text: cleanSkillInlineText(paragraphLines.join(" ")) })
  }

  return blocks
}

function parseSkillTable(lines: string[]): SkillSectionBlock | null {
  const rows = lines
    .map(line => line.replace(/^\||\|$/g, "").split("|").map(cell => cleanSkillInlineText(cell.trim())))
    .filter(row => row.some(Boolean))

  if (rows.length < 2) return null
  const [, ...bodyRows] = rows
  const filteredRows = bodyRows.filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)))
  return {
    type: "table",
    headers: rows[0],
    rows: filteredRows,
  }
}

function cleanSkillInlineText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim()
}

export function SkillStructuredView({
  skill,
  parsed,
  locale,
}: {
  skill: Skill
  parsed: ParsedSkillView
  locale: "zh" | "en"
}) {
  const frontmatterEntries = Object.entries(parsed.frontmatter).filter(
    ([key, value]) => value && !["name", "description"].includes(key)
  )
  const hasMetadata = Object.keys(parsed.metadata).length > 0
  const hasStandardContent = parsed.sections.length > 0 || parsed.fallbackBlocks.length > 0
  const labels = {
    standardView: locale === "zh" ? "技能标准视图" : "Skill standard view",
    updated: locale === "zh" ? "更新于" : "Updated",
    frontmatter: locale === "zh" ? "标准字段" : "Standard fields",
    metadata: locale === "zh" ? "元数据" : "Metadata",
    allowedTools: locale === "zh" ? "允许工具" : "Allowed tools",
    body: locale === "zh" ? "技能正文" : "Skill body",
    empty: locale === "zh" ? "暂无可展示的标准字段。" : "No standard fields to display.",
  }

  return (
    <ScrollArea className="min-h-0 flex-1 bg-background/60" scrollbars="both">
      <div className="space-y-4 p-4">
        <div className="rounded-xl bg-muted/30 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
                {labels.standardView}
              </p>
              <h3 className="mt-1 break-words text-base font-semibold text-foreground">
                {parsed.frontmatter.name || skill.name}
              </h3>
              <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
                {parsed.frontmatter.description || skill.description}
              </p>
            </div>
            <span className="shrink-0 rounded-md bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground">
              {labels.updated} {new Date(skill.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        {(frontmatterEntries.length > 0 || parsed.allowedTools.length > 0) && (
          <div className="grid gap-3 lg:grid-cols-2">
            {frontmatterEntries.length > 0 && (
              <div className="rounded-xl bg-muted/25 p-3.5">
                <h4 className="mb-2 text-xs font-semibold text-foreground">{labels.frontmatter}</h4>
                <div className="space-y-2">
                  {frontmatterEntries.map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 text-sm">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{key}</span>
                      <span className="min-w-0 break-words text-right text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {parsed.allowedTools.length > 0 && (
              <div className="rounded-xl bg-muted/25 p-3.5">
                <h4 className="mb-2 text-xs font-semibold text-foreground">{labels.allowedTools}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.allowedTools.map(tool => (
                    <span
                      key={tool}
                      className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {hasMetadata && (
          <div className="rounded-xl bg-muted/25 p-3.5">
            <h4 className="mb-2 text-xs font-semibold text-foreground">{labels.metadata}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(parsed.metadata).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-background/70 px-3 py-2">
                  <div className="font-mono text-[10px] text-muted-foreground">{key}</div>
                  <div className="mt-0.5 break-words text-sm text-foreground">{value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasStandardContent ? (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-foreground">{labels.body}</h4>
            {parsed.sections.map(section => (
              <section key={section.title} className="rounded-xl bg-muted/25 p-3.5">
                <h5 className="text-sm font-semibold text-foreground">{section.title}</h5>
                <div className="mt-2 space-y-2.5">
                  {section.blocks.map((block, index) => (
                    <SkillBlockView key={`${section.title}-${index}`} block={block} />
                  ))}
                </div>
              </section>
            ))}
            {parsed.fallbackBlocks.length > 0 && (
              <section className="rounded-xl bg-muted/25 p-3.5">
                <div className="space-y-2.5">
                  {parsed.fallbackBlocks.map((block, index) => (
                    <SkillBlockView key={index} block={block} />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl bg-muted/25 p-4 text-sm text-muted-foreground">{labels.empty}</div>
        )}
      </div>
    </ScrollArea>
  )
}

function SkillBlockView({ block }: { block: SkillSectionBlock }) {
  if (block.type === "paragraph") {
    return <p className="break-words text-sm leading-relaxed text-foreground/85">{block.text}</p>
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul"
    return (
      <ListTag className={`space-y-1 pl-5 text-sm leading-relaxed text-foreground/85 ${block.ordered ? "list-decimal" : "list-disc"}`}>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`} className="break-words">
            {item}
          </li>
        ))}
      </ListTag>
    )
  }

  return (
    <ScrollArea className="w-full rounded-lg bg-background/70" scrollbars="horizontal">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {block.headers.map((header, index) => (
              <th key={`${header}-${index}`} className="px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border/30">
              {block.headers.map((_, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top text-foreground/85">
                  {row[cellIndex] || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  )
}
