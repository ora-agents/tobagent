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
name: 我的技能
description: 描述这个技能的用途、触发场景、主要能力和重要约束。
license: Apache-2.0
compatibility: 需要 Python 3.11+、bash 和可用的网络访问
metadata:
  author: 你的团队
  version: "1.0.0"
  category: 业务流程
allowed-tools: Bash Read Write Edit
---

# 目的

这个技能帮助智能体稳定、一致地完成某类特定任务。

适合在以下情况使用：
- 用户提出了与该技能直接相关的任务。
- 任务符合 \`description\` 中描述的触发条件。
- 任务需要遵循这里定义的流程、约束或输出格式。

不适合在以下情况使用：
- 用户请求与该技能无关。
- 当前环境不满足该技能的运行要求。
- 另一个更专门的技能更适合处理该任务。

# 范围

该技能负责：
- 任务 A
- 任务 B
- 任务 C

该技能不负责：
- 外部审批
- 只能在管理后台手动完成的操作
- 需要未授权工具的任务

# 输入

预期输入可能包括：
- 用户目标
- 源文件
- 环境约束
- 期望输出格式

开始前请确认：
1. 用户希望产出什么结果。
2. 哪些文件或输入已经可用。
3. 是否有工具、格式或风格约束。

# 工作流程

1. 理解用户目标。
2. 识别所需文件、参数和约束。
3. 根据下方决策规则选择处理方式。
4. 按必要顺序执行任务。
5. 验证输出结果。
6. 按期望格式返回结果。

# 决策规则

| 场景 | 动作 |
|---|---|
| 输入不完整 | 追问完成任务所需的最少信息 |
| 存在多种可行方案 | 选择满足约束的最简单方案 |
| 缺少必要依赖 | 停止并说明缺少什么 |
| 操作存在风险或破坏性 | 先请求确认 |

# 约束

始终遵循以下规则：
- 优先使用确定、可重复的步骤。
- 不假设不可用工具存在。
- 不编造文件、结果或外部状态。
- 除非用户明确要求，否则保留用户数据。
- 尽早说明阻塞问题。

# 输出要求

最终结果应当：
- 符合用户要求的格式
- 只包含必要解释
- 在返回前完成验证
- 标明重要假设或限制

# 验证清单

结束前确认：
- 输出完整
- 格式正确
- 已满足任务要求
- 未执行禁止操作
- 已说明重要注意事项

# 边界情况

谨慎处理以下情况：
- 输入缺失
- 文件格式无效
- 部分成功
- 用户指令冲突
- 环境不支持

# 常见错误

避免：
- 使用已废弃的文件或 API
- 跳过必要验证
- 选择当前环境不允许使用的工具
- 在需要简洁输出时返回冗长内容

# 参考资料

如需详细指导，请查看：
- [参考指南](references/REFERENCE.md)
- [示例](references/EXAMPLES.md)

# 脚本

如有需要，可使用：
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
    name: name || "未命名技能",
    description: description || "暂无描述。"
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
    blocks.push({ type: "paragraph", text: cleanSkillInlineText(paragraphLines.join("\n")) })
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
    <ScrollArea className="min-h-0 flex-1 bg-background/60">
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
            {parsed.sections.map((section, sectionIndex) => (
              <section key={`${section.title}-${sectionIndex}`} className="rounded-xl bg-muted/25 p-3.5">
                <h5 className="text-sm font-semibold text-foreground">{section.title}</h5>
                <div className="mt-2 space-y-2.5">
                  {section.blocks.map((block, index) => (
                    <SkillBlockView key={`${section.title}-${sectionIndex}-${index}`} block={block} />
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
    return <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground/85">{block.text}</p>
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
    <div className="w-full overflow-hidden rounded-lg bg-background/70">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {block.headers.map((header, index) => (
              <th key={`${header}-${index}`} className="break-words px-3 py-2 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border/30">
              {block.headers.map((_, cellIndex) => (
                <td key={cellIndex} className="break-words px-3 py-2 align-top text-foreground/85">
                  {row[cellIndex] || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
