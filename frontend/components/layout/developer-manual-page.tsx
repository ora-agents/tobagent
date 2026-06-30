"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowLeft,
  BookOpenText,
  Boxes,
  Code2,
  Database,
  ExternalLink,
  KeyRound,
  Menu,
  Mic,
  Network,
  ServerCog,
  TerminalSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NavActionButton } from "@/components/ui/nav-action-button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"
import { LANGGRAPH_API_URL } from "@/lib/constants/api"

interface DeveloperManualPageProps {
  onBackToChat: () => void
  onOpenSidebar?: () => void
}

interface ManualSection {
  id: string
  icon: ComponentType<{ className?: string }>
  title: string
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-lg bg-[#181715] p-4 text-xs leading-6 text-[#faf9f5]">
      <code>{children}</code>
    </pre>
  )
}

function EndpointGroup({
  title,
  description,
  endpoints,
}: {
  title: string
  description: string
  endpoints: string[]
}) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary p-4">
      <h4 className="text-base font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {endpoints.map((endpoint) => (
          <div
            key={endpoint}
            className="min-w-0 break-all rounded-md bg-sidebar-accent px-3 py-2 font-mono text-xs leading-5 text-foreground"
          >
            {endpoint}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DeveloperManualPage({ onBackToChat, onOpenSidebar }: DeveloperManualPageProps) {
  const { locale } = useI18n()
  const zh = locale === "zh"
  const [activeSection, setActiveSection] = useState("section-overview")
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())
  const apiBase = LANGGRAPH_API_URL
  const swaggerDocsUrl = `${apiBase.replace(/\/$/, "")}/docs`
  const redocUrl = `${apiBase.replace(/\/$/, "")}/redoc`

  const sections: ManualSection[] = useMemo(
    () => [
      { id: "section-overview", icon: BookOpenText, title: zh ? "调用前准备" : "Before Calling" },
      { id: "section-sdk", icon: Code2, title: "LangGraph SDK" },
      { id: "section-http", icon: TerminalSquare, title: "Server HTTP API" },
      { id: "section-backend", icon: ServerCog, title: zh ? "后端 API 与功能" : "Backend APIs" },
      { id: "section-auth", icon: KeyRound, title: zh ? "认证与约定" : "Auth Rules" },
    ],
    [zh],
  )

  const registerSectionRef = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      if (node) {
        sectionRefs.current.set(id, node)
      } else {
        sectionRefs.current.delete(id)
      }
    },
    [],
  )

  const updateActiveSectionFromScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const maxScrollTop = container.scrollHeight - container.clientHeight
    if (container.scrollTop <= 2) {
      setActiveSection(sections[0].id)
      return
    }
    if (maxScrollTop - container.scrollTop <= 2) {
      setActiveSection(sections[sections.length - 1].id)
      return
    }

    const containerTop = container.getBoundingClientRect().top
    const activationY = containerTop + Math.min(container.clientHeight * 0.28, 180)
    let nextActive = sections[0].id

    for (const section of sections) {
      const el = sectionRefs.current.get(section.id)
      if (!el) continue
      if (el.getBoundingClientRect().top <= activationY) {
        nextActive = section.id
      } else {
        break
      }
    }

    setActiveSection(nextActive)
  }, [sections])

  useEffect(() => {
    updateActiveSectionFromScroll()
  }, [updateActiveSectionFromScroll])

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id)
    const el = sectionRefs.current.get(id) || document.getElementById(id)
    const container = scrollContainerRef.current
    if (!el || !container) return

    const containerTop = container.getBoundingClientRect().top
    const sectionTop = el.getBoundingClientRect().top
    container.scrollTo({
      top: container.scrollTop + sectionTop - containerTop,
      behavior: "smooth",
    })
  }, [])

  const sdkExample = `import { Client } from "@langchain/langgraph-sdk"

const client = new Client({
  apiUrl: "${apiBase}",
  defaultHeaders: {
    Authorization: "Bearer tob_xxx_or_user_id",
  },
})

const assistantId = "generic_agent"
const agentId = "your-agent-profile-id"

const thread = await client.threads.create({
  metadata: { agent_id: agentId },
})

const stream = client.runs.stream(thread.thread_id, assistantId, {
  input: {
    messages: [{ role: "user", content: "帮我总结这份产品资料" }],
  },
  context: {
    agent_id: agentId,
  },
  streamMode: ["messages", "updates", "values"],
})

for await (const event of stream) {
  console.log(event.event, event.data)
}`

  const httpExample = `export LANGGRAPH_API_URL="${apiBase}"
export API_KEY="tob_xxx_or_user_id"
export AGENT_ID="your-agent-profile-id"

THREAD_ID=$(curl -sS -X POST "$LANGGRAPH_API_URL/threads" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"metadata":{"agent_id":"'"$AGENT_ID"'"}}' | jq -r '.thread_id')

curl -N -X POST "$LANGGRAPH_API_URL/threads/$THREAD_ID/runs/stream" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "assistant_id": "generic_agent",
    "input": {
      "messages": [{"role": "user", "content": "查询知识库里的售后政策"}]
    },
    "context": {
      "agent_id": "'"$AGENT_ID"'"
    },
    "stream_mode": ["messages", "updates", "values"]
  }'`

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {onOpenSidebar ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSidebar}
              className="h-9 w-9 flex-shrink-0 rounded-lg md:hidden"
              aria-label={zh ? "打开菜单" : "Open menu"}
            >
              <Menu className="h-5 w-5" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h1 className="font-display flex min-w-0 items-center gap-1.5 text-base font-semibold tracking-wide">
              <span className="truncate">{zh ? "开发手册" : "Developer Manual"}</span>
            </h1>
            <p className="hidden text-[11px] leading-none text-muted-foreground/80 sm:block">
              {zh
                ? "通过 LangGraph SDK 或 LangGraph Server API 调用自定义 Agent，并了解后端能力。"
                : "Call custom agents through the LangGraph SDK or Server API, and review backend capabilities."}
            </p>
          </div>
        </div>
        <NavActionButton
          variant="outline"
          onClick={onBackToChat}
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{zh ? "返回对话" : "Back to Chat"}</span>
          <span className="sm:hidden">{zh ? "返回" : "Back"}</span>
        </NavActionButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="w-full flex-shrink-0 overflow-hidden border-b border-border/60 md:w-[208px] md:border-b-0 md:border-r">
          <ScrollArea className="h-14 w-full md:h-full" scrollbars="both">
          <nav className="flex gap-1 p-2 md:sticky md:top-0 md:block md:space-y-1 md:p-4">
            <div className="hidden md:mb-3 md:block md:px-3 md:text-xs md:font-semibold md:text-muted-foreground">
              {zh ? "手册目录" : "Manual"}
            </div>
            {sections.map(({ id, icon: Icon, title }) => (
              <Button variant="unstyled"
                key={id}
                onClick={() => scrollToSection(id)}
                className={`flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm transition-colors md:w-full ${
                  activeSection === id
                    ? "bg-primary-soft font-semibold text-primary dark:bg-primary dark:text-primary-foreground"
                    : "text-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{title}</span>
              </Button>
            ))}
          </nav>
          </ScrollArea>
        </aside>

        <ScrollArea
          className="min-h-0 min-w-0 flex-1 bg-background"
          viewportRef={scrollContainerRef}
          onViewportScroll={updateActiveSectionFromScroll}
        >
          <main className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">

            <div
              id="section-overview"
              ref={registerSectionRef("section-overview")}
              className="scroll-mt-4 space-y-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <BookOpenText className="h-5 w-5 text-primary" />
                {zh ? "调用前准备" : "Before Calling"}
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <div className="text-sm font-semibold">{zh ? "服务地址" : "Base URL"}</div>
                  <div className="mt-2 break-all rounded-md bg-sidebar-accent px-3 py-2 font-mono text-xs">{apiBase}</div>
                </div>
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <div className="text-sm font-semibold">assistant_id</div>
                  <div className="mt-2 rounded-md bg-sidebar-accent px-3 py-2 font-mono text-xs">generic_agent</div>
                </div>
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <div className="text-sm font-semibold">context.agent_id</div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {zh
                      ? "传入后台“角色管理”里创建的角色 ID。真正决定调用哪个自定义 Agent 的字段是 context.agent_id。"
                      : "Pass the agent profile ID from Agent Management. The custom agent is selected by context.agent_id."}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{zh ? "完整接口文档" : "Full API Reference"}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {zh
                      ? "本页是调用说明和常用端点概览；完整请求体、响应模型和调试入口以 FastAPI 自动生成文档为准。"
                      : "This page is a calling guide and common endpoint overview. Use the generated FastAPI docs for complete schemas and interactive testing."}
                  </p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                  <a
                    href={swaggerDocsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-medium text-foreground transition-colors hover:bg-sidebar-accent hover:text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Swagger
                  </a>
                  <a
                    href={redocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-secondary px-3 text-sm font-medium text-foreground transition-colors hover:bg-sidebar-accent hover:text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    ReDoc
                  </a>
                </div>
              </div>
              <p className="text-sm leading-7 text-muted-foreground">
                {zh
                  ? "外部调用方可以使用用户设置里的 API Key，也可以在内部前端场景继续使用用户 ID 作为 Bearer token。普通外部调用建议始终使用 API Key，并在每次 run 中带上 context.agent_id。"
                  : "External callers should use an API key from User Settings. Internal frontend flows may still use the user ID bearer token. Always include context.agent_id for custom agent runs."}
              </p>
            </div>

            <div
              id="section-sdk"
              ref={registerSectionRef("section-sdk")}
              className="scroll-mt-4 space-y-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Code2 className="h-5 w-5 text-primary" />
                LangGraph SDK
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                {zh
                  ? "适合 Node.js、Next.js 服务端、脚本任务等 TypeScript/JavaScript 调用方。先创建 thread，再对 generic_agent 发起 stream 或 wait run。"
                  : "Use this from Node.js, Next.js server code, or scripts. Create a thread, then run generic_agent with stream or wait."}
              </p>
              <CodeBlock>{sdkExample}</CodeBlock>
              <div className="rounded-lg bg-secondary p-4 text-sm leading-7 text-muted-foreground">
                {zh
                  ? "读取输出时，messages 事件适合实时展示 token，values 事件通常包含最终 state，可从 messages 数组里取最后一条 assistant 消息。"
                  : "Use messages events for realtime display. Values events usually contain final state; read the last assistant message from the messages array."}
              </div>
            </div>

            <div
              id="section-http"
              ref={registerSectionRef("section-http")}
              className="scroll-mt-4 space-y-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <TerminalSquare className="h-5 w-5 text-primary" />
                LangGraph Server HTTP API
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                {zh
                  ? "适合任何 HTTP 客户端。流式接口返回 SSE；如果调用方不需要流式输出，可以把路径换成 /threads/{thread_id}/runs/wait。"
                  : "Works from any HTTP client. The stream endpoint returns SSE; use /threads/{thread_id}/runs/wait when streaming is not needed."}
              </p>
              <CodeBlock>{httpExample}</CodeBlock>
            </div>

            <div
              id="section-backend"
              ref={registerSectionRef("section-backend")}
              className="scroll-mt-4 space-y-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <ServerCog className="h-5 w-5 text-primary" />
                {zh ? "后端 API 与功能" : "Backend APIs"}
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                <EndpointGroup
                  title={zh ? "认证与用户" : "Auth and Users"}
                  description={zh ? "注册、登录、个人资料更新和外部调用 API Key 管理。" : "Registration, login, profile updates, and external API key management."}
                  endpoints={[
                    "POST /api/auth/register",
                    "POST /api/auth/login",
                    "GET /api/auth/users/{user_id}",
                    "PUT /api/auth/users/{user_id}",
                    "GET/POST /api/auth/api-keys",
                    "DELETE /api/auth/api-keys/{key_id}",
                  ]}
                />
                <EndpointGroup
                  title={zh ? "角色、技能、知识库" : "Agents, Skills, Knowledge"}
                  description={zh ? "管理自定义 Agent、系统提示词、工具开关、技能文本、共享知识库和文档向量化。" : "Manage custom agents, prompts, tool switches, skills, shared knowledge bases, and document ingestion."}
                  endpoints={[
                    "GET/POST /api/agent-profiles",
                    "PUT/DELETE /api/agent-profiles/{id}",
                    "POST /api/agent-profiles/{id}/share",
                    "GET /api/agent-shares/{token}",
                    "POST /api/agent-shares/{token}/import",
                    "GET/POST /api/skills",
                    "PUT/DELETE /api/skills/{id}",
                    "GET/POST /api/knowledge-bases",
                    "POST /api/knowledge-bases/{kb_id}/upload",
                    "DELETE /api/knowledge-bases/{kb_id}/files/{filename}",
                  ]}
                />
                <EndpointGroup
                  title={zh ? "工具与运行能力" : "Tools and Runtime"}
                  description={zh ? "配置 MCP 服务端、代理模型列表，并提供旧版 Agent RAG 上传兼容接口。" : "Configure MCP servers, proxy model listings, and support legacy agent RAG upload endpoints."}
                  endpoints={[
                    "GET/POST /api/mcp-servers",
                    "PUT/DELETE /api/mcp-servers/{id}",
                    "GET /api/models",
                    "GET /api/client-profiles/{id}",
                    "POST /api/client-profiles",
                    "POST /agents/{agent_id}/upload",
                    "GET /agents/{agent_id}/rag-status",
                    "POST /generate-title",
                    "GET /health",
                  ]}
                />
                <EndpointGroup
                  title={zh ? "表单开放接口" : "Form APIs"}
                  description={zh ? "使用用户 API Key 浏览表单定义，并对表单记录执行增删改查。" : "Browse form definitions and manage records with a user API key."}
                  endpoints={[
                    "GET/POST /api/forms",
                    "GET/PUT/DELETE /api/forms/{form_id}",
                    "GET/POST /api/forms/{form_id}/records",
                    "PUT/DELETE /api/forms/{form_id}/records/{record_id}",
                  ]}
                />
                <EndpointGroup
                  title={zh ? "语音与机器人" : "Voice and Robot"}
                  description={zh ? "语音识别、语音会话、TTS、声纹绑定/验证，以及机器人点位和指令结果上报。" : "ASR, voice sessions, TTS, voiceprint enrollment/verification, robot points, and command result reporting."}
                  endpoints={[
                    "POST /api/asr/transcribe",
                    "WS /ws/voice/asr",
                    "WS /ws/voice/session",
                    "WS /ws/voice/tts",
                    "GET /api/speaker-profiles/sample-text",
                    "GET/POST /api/user-voiceprints",
                    "POST /api/speaker-profiles/verify",
                    "POST /api/voice/telemetry",
                    "GET/POST/PUT/DELETE /api/robot-points",
                    "GET /api/robot/sse",
                    "POST /api/robot/commands/{command_id}/result",
                  ]}
                />
              </div>
            </div>

            <div
              id="section-auth"
              ref={registerSectionRef("section-auth")}
              className="scroll-mt-4 space-y-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
            >
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <KeyRound className="h-5 w-5 text-primary" />
                {zh ? "认证与使用约定" : "Auth Rules"}
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <Network className="mb-3 h-5 w-5 text-primary" />
                  <h4 className="text-sm font-semibold">{zh ? "请求头" : "Headers"}</h4>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">Authorization: Bearer {"<api-key>"}</p>
                </div>
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <Boxes className="mb-3 h-5 w-5 text-primary" />
                  <h4 className="text-sm font-semibold">{zh ? "角色归属" : "Agent Ownership"}</h4>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {zh ? "API Key 只能调用所属用户拥有的 agent_id。" : "An API key can only call agent IDs owned by that user."}
                  </p>
                </div>
                <div className="min-w-0 rounded-lg bg-secondary p-4">
                  <Database className="mb-3 h-5 w-5 text-primary" />
                  <h4 className="text-sm font-semibold">{zh ? "知识库作用域" : "Knowledge Scope"}</h4>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {zh ? "运行时会按用户、角色绑定的知识库和技能加载上下文。" : "Runtime context is loaded from the user and the agent's linked knowledge bases and skills."}
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-secondary p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Mic className="h-4 w-4 text-primary" />
                  {zh ? "语音能力说明" : "Voice Capabilities"}
                </h4>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {zh
                    ? "声纹先通过 /api/user-voiceprints 绑定到用户，再在角色设置中启用说话人验证并绑定 userVoiceprintId。语音会话接口会根据当前角色配置执行 ASR、Agent 调用和 TTS。"
                    : "Enroll user voiceprints through /api/user-voiceprints, then enable speaker verification on an agent and bind userVoiceprintId. Voice session sockets combine ASR, agent runs, and TTS according to the selected agent configuration."}
                </p>
              </div>
            </div>
          </div>
          </main>
        </ScrollArea>
      </div>
    </div>
  )
}
