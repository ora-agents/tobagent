"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowLeft,
  Bot,
  BookOpenText,
  Boxes,
  Cpu,
  Database,
  FileText,
  KeyRound,
  Menu,
  MessageSquareText,
  Mic,
  Settings,
  Share2,
  TableProperties,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NavActionButton } from "@/components/ui/nav-action-button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useI18n } from "@/lib/i18n"

interface UserManualPageProps {
  onBackToChat: () => void
  onOpenSidebar?: () => void
}

interface ManualSection {
  id: string
  icon: ComponentType<{ className?: string }>
  title: string
}

interface StepItem {
  title: string
  description: string
}

function StepList({ items }: { items: StepItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <div key={item.title} className="flex gap-3 rounded-lg bg-secondary p-4">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary dark:bg-primary dark:text-primary-foreground">
            {index + 1}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function FeatureTile({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary p-4">
      <Icon className="mb-3 h-5 w-5 text-primary" />
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  )
}

function InteractionBlock({
  title,
  items,
}: {
  title: string
  items: string[]
}) {
  return (
    <div className="rounded-lg bg-secondary p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function UserManualPage({ onBackToChat, onOpenSidebar }: UserManualPageProps) {
  const { locale } = useI18n()
  const zh = locale === "zh"
  const [activeSection, setActiveSection] = useState("section-start")
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const sections: ManualSection[] = useMemo(
    () => [
      { id: "section-start", icon: BookOpenText, title: zh ? "快速开始" : "Quick Start" },
      { id: "section-chat", icon: MessageSquareText, title: zh ? "对话与文件" : "Chat and Files" },
      { id: "section-skills", icon: Wrench, title: zh ? "技能模块" : "Skills" },
      { id: "section-agent", icon: Bot, title: zh ? "角色模块" : "Agents" },
      { id: "section-knowledge", icon: Database, title: zh ? "知识库模块" : "Knowledge" },
      { id: "section-forms", icon: TableProperties, title: zh ? "表单模块" : "Forms" },
      { id: "section-mcp", icon: Cpu, title: zh ? "MCP 模块" : "MCP" },
      { id: "section-voice", icon: Mic, title: zh ? "语音使用" : "Voice" },
      { id: "section-settings", icon: Settings, title: zh ? "账号与设置" : "Account and Settings" },
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

  const startSteps: StepItem[] = zh
    ? [
        { title: "登录平台", description: "使用手机号或账号登录后，平台会保存你的对话、角色、知识库、表单和个人设置。" },
        { title: "选择或创建角色", description: "默认角色可以直接聊天；需要固定业务口径时，在角色管理里创建专属角色并配置模型、提示词、工具和知识库。" },
        { title: "开始对话", description: "回到对话页输入问题，也可以上传图片、代码或日志文件，让当前角色结合上下文处理任务。" },
      ]
    : [
        { title: "Sign in", description: "After signing in, the platform saves your conversations, agents, knowledge bases, forms, and personal settings." },
        { title: "Choose or create an agent", description: "Use the default agent for general chat, or create a dedicated agent with its own model, prompt, tools, and knowledge bases." },
        { title: "Start chatting", description: "Return to Chat, send a message, or attach images, code, and logs for the selected agent to process with context." },
      ]

  const agentSteps: StepItem[] = zh
    ? [
        { title: "创建角色", description: "在配置里的角色管理中填写名称、描述、系统提示词，并选择模型、Temperature 和递归深度。" },
        { title: "配置工具与技能", description: "按需开启联网、文件、知识库或 MCP 工具；把可复用的工作规范写成技能，再绑定到角色。" },
        { title: "分享或复用", description: "角色可生成分享链接供其他人导入；需要修改时可以继续编辑并保留版本记录。" },
      ]
    : [
        { title: "Create an agent", description: "In Agent Management, set its name, description, system prompt, model, temperature, and recursion limit." },
        { title: "Configure tools and skills", description: "Enable web, file, knowledge, or MCP tools as needed. Put reusable operating instructions into skills and attach them to the agent." },
        { title: "Share or reuse", description: "Generate a share link for others to import the agent. You can keep editing it and use version history when needed." },
      ]

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
              <span className="truncate">{zh ? "用户手册" : "User Manual"}</span>
            </h1>
            <p className="hidden text-[11px] leading-none text-muted-foreground/80 sm:block">
              {zh ? "了解如何使用对话、角色、技能、知识库、表单、语音和账号设置。" : "Learn how to use chat, agents, skills, knowledge bases, forms, voice, and account settings."}
            </p>
          </div>
        </div>
        <NavActionButton variant="outline" onClick={onBackToChat}>
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{zh ? "返回对话" : "Back to Chat"}</span>
          <span className="sm:hidden">{zh ? "返回" : "Back"}</span>
        </NavActionButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="w-full flex-shrink-0 overflow-hidden border-b border-border/60 md:w-[208px] md:border-b-0 md:border-r">
          <ScrollArea className="h-14 w-full md:h-full" scrollbars="both">
            <nav className="flex gap-1 p-2 md:sticky md:top-0 md:flex-col md:gap-1 md:p-4">
              <div className="hidden md:mb-2 md:block md:px-3 md:text-xs md:font-semibold md:text-muted-foreground">
                {zh ? "手册目录" : "Manual"}
              </div>
              {sections.map(({ id, icon: Icon, title }) => (
                <Button
                  variant="unstyled"
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
            <div className="mx-auto flex max-w-4xl flex-col gap-5 sm:gap-6">
              <section
                id="section-start"
                ref={registerSectionRef("section-start")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <BookOpenText className="h-5 w-5 text-primary" />
                    {zh ? "快速开始" : "Quick Start"}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {zh
                      ? "平台由对话工作区和配置中心组成。日常使用从选择角色开始；需要让平台处理固定业务流程时，再配置技能、知识库和工具。"
                      : "The platform combines a chat workspace with a configuration center. Start by selecting an agent; configure skills, knowledge, and tools when you need repeatable business workflows."}
                  </p>
                  <StepList items={startSteps} />
                  <InteractionBlock
                    title={zh ? "左侧导航的交互逻辑" : "Sidebar interaction logic"}
                    items={
                      zh
                        ? [
                            "点击对话记录会切回对话页并加载该线程；移动端会同时关闭侧边栏。",
                            "搜索框按标题和最近消息过滤对话；清除按钮会恢复完整列表。",
                            "配置分组可展开或收起，技能、角色、知识库、表单和 MCP 都从这里进入。",
                            "用户手册、开发手册、轨迹页面和主题切换位于侧边栏底部；头像入口进入用户设置。",
                          ]
                        : [
                            "Selecting a thread returns to Chat and loads that thread; on mobile the drawer closes at the same time.",
                            "The search box filters by title and latest message; the clear button restores the full list.",
                            "The Configuration group expands or collapses and opens Skills, Agents, Knowledge, Forms, and MCP.",
                            "User Manual, Developer Manual, traces, theme switching, and profile settings live at the bottom of the sidebar.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-chat"
                ref={registerSectionRef("section-chat")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <MessageSquareText className="h-5 w-5 text-primary" />
                    {zh ? "对话与文件" : "Chat and Files"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FeatureTile
                      icon={MessageSquareText}
                      title={zh ? "新建对话" : "New chat"}
                      description={zh ? "点击新对话开始独立任务。左侧记录会按时间分组，搜索框可快速找回历史上下文。" : "Start a separate task with New Chat. Threads are grouped by time, and search helps you recover prior context."}
                    />
                    <FeatureTile
                      icon={FileText}
                      title={zh ? "上传附件" : "Attach files"}
                      description={zh ? "在输入框添加图片、代码、日志或文档片段，让角色基于附件回答、分析或改写。" : "Attach images, code, logs, or document excerpts so the agent can answer, analyze, or rewrite from the material."}
                    />
                    <FeatureTile
                      icon={Boxes}
                      title={zh ? "继续上下文" : "Continue context"}
                      description={zh ? "同一对话会保留上下文；如果要切换任务或避免旧信息干扰，请新建对话。" : "A thread keeps its context. Create a new chat when switching tasks or avoiding old information."}
                    />
                  </div>
                  <InteractionBlock
                    title={zh ? "对话页的交互逻辑" : "Chat interaction logic"}
                    items={
                      zh
                        ? [
                            "输入框内容会按当前对话保存草稿，切换线程后会恢复该线程的未发送内容。",
                            "发送前如没有线程，前端会先创建新线程，再把用户消息追加到消息区并开始流式请求。",
                            "AI 回复中再次发送消息时，新消息会进入队列；当前回复结束后按顺序继续处理。",
                            "点击停止会中断当前流式回复；语音打断触发停止时，不会把打断语音错误地排入等待队列。",
                            "上传、粘贴或拖入文件后，附件会显示在输入区；删除附件会同步释放可输入字数。",
                            "历史消息加载失败或线程无权限时，页面会回退到空对话并通知外层选择可访问线程。",
                          ]
                        : [
                            "The input draft is saved per thread and restored when you switch back to that thread.",
                            "If no thread exists, sending first creates one, appends the user message, then starts the streaming request.",
                            "Messages sent while the assistant is replying are queued and processed in order after the current reply finishes.",
                            "Stop interrupts the active stream; voice interruptions do not accidentally queue the interruption transcript.",
                            "Uploaded, pasted, or dropped files appear near the input; removing them also frees input length budget.",
                            "If history cannot load or the thread is inaccessible, the view falls back to an empty chat and asks the shell to select an accessible thread.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-skills"
                ref={registerSectionRef("section-skills")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Wrench className="h-5 w-5 text-primary" />
                    {zh ? "技能模块" : "Skills"}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {zh
                      ? "技能用于沉淀可复用的工作规则，例如输出格式、审核标准、业务 SOP 和工具调用习惯。"
                      : "Skills store reusable operating rules such as output formats, review criteria, SOPs, and tool-use habits."}
                  </p>
                  <InteractionBlock
                    title={zh ? "技能管理的交互逻辑" : "Skill management interaction logic"}
                    items={
                      zh
                        ? [
                            "进入技能模块后，左侧按分类展示技能；点击技能只进入查看态，不会立即编辑。",
                            "点击新建会清空当前选择并打开默认模板；从角色编辑器里新建技能时，保存后会自动回到该角色并完成关联。",
                            "点击编辑会把技能内容载入 Markdown 编辑器；保存时系统从 frontmatter 解析名称和描述。",
                            "删除需要先点删除图标进入确认态，再点确认删除；删除后列表会自动选择剩余的第一个技能。",
                            "在受管工作区中，如果当前账号没有直接管理权限，保存或删除可能转为审批中的变更请求。",
                          ]
                        : [
                            "The skill list is grouped by category. Selecting a skill opens read mode and does not immediately edit it.",
                            "New clears the current selection and opens the default template. If created from the agent editor, saving returns to that agent and links it.",
                            "Edit loads the skill into the Markdown editor. Save parses the name and description from frontmatter.",
                            "Delete first enters confirmation state; confirming removes it and selects the first remaining skill when available.",
                            "In managed workspaces, users without direct manage permission may create pending change requests instead of applying changes immediately.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-agent"
                ref={registerSectionRef("section-agent")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Bot className="h-5 w-5 text-primary" />
                    {zh ? "角色模块" : "Agents"}
                  </h3>
                  <StepList items={agentSteps} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <FeatureTile
                      icon={Wrench}
                      title={zh ? "技能适合写规则" : "Use skills for rules"}
                      description={zh ? "把写作格式、审核标准、业务 SOP、工具调用习惯写进技能，多个角色可以复用。" : "Store writing formats, review criteria, SOPs, and tool-use habits in skills that multiple agents can reuse."}
                    />
                    <FeatureTile
                      icon={Share2}
                      title={zh ? "分享前先检查权限" : "Check permissions before sharing"}
                      description={zh ? "分享角色前确认其绑定的技能、工具和知识库是否适合被接收方使用。" : "Before sharing an agent, review whether its attached skills, tools, and knowledge bases are appropriate for recipients."}
                    />
                    <FeatureTile
                      icon={TableProperties}
                      title={zh ? "宏工具适合固化表单操作" : "Use macro tools for fixed form operations"}
                      description={zh ? "在角色编辑页的自定义宏工具中，把一组查询、新增、更新或删除表单记录的步骤暴露成 agent 可调用的 toolcall。" : "In Custom Macro Tools, expose a fixed sequence of form query, create, update, or delete steps as an agent-callable tool."}
                    />
                  </div>
                  <InteractionBlock
                    title={zh ? "自定义宏工具配置方法" : "Custom macro tool setup"}
                    items={
                      zh
                        ? [
                            "先在角色编辑器中关联需要操作的表单，并为每个表单配置读取、新增、更新或删除权限；宏步骤只能使用已关联的表单。",
                            "在关联表单数据下方点击自定义宏工具的新增宏，填写宏名称和描述；描述会作为 agent 判断何时调用该 toolcall 的依据。",
                            "参数 JSON 用数组定义入参，例如 [{\"name\":\"customerName\",\"description\":\"客户名称\",\"type\":\"string\",\"required\":true}]。",
                            "步骤 JSON 用数组定义表单操作，支持 action 为 query、create、update 或 delete；字段值可用 {{customerName}} 引用参数。",
                            "保存角色后，对话运行时会自动注入 macro_ 开头的工具；当用户请求匹配宏名称或描述时，agent 可直接调用该宏完成预定义表单操作。",
                            "分享角色或导入 TOML 配置时，宏配置会一起保留；复制表单资源时，宏步骤中的表单 ID 会自动改写为新表单 ID。",
                          ]
                        : [
                            "First link the forms the agent may operate on, then grant read, create, update, or delete permissions. Macro steps can only target linked forms.",
                            "Under Link Forms, add a Custom Macro Tool, then set its name and description. The description helps the agent decide when to call the tool.",
                            "Arguments JSON defines inputs, for example [{\"name\":\"customerName\",\"description\":\"Customer name\",\"type\":\"string\",\"required\":true}].",
                            "Steps JSON defines form operations. action supports query, create, update, and delete. Values can reference arguments with {{customerName}}.",
                            "After saving the agent, runtime injects a macro_ tool. When a user request matches the macro name or description, the agent can call it directly.",
                            "Shared agents and TOML imports keep macro configuration. When form resources are copied, form IDs inside macro steps are rewritten automatically.",
                          ]
                    }
                  />
                  <InteractionBlock
                    title={zh ? "角色配置的交互逻辑" : "Agent configuration interaction logic"}
                    items={
                      zh
                        ? [
                            "角色列表只展示可配置角色；隐藏角色不会出现在对话页的角色切换器中。",
                            "点击角色进入详情态；点击编辑后才会出现可修改表单、资源勾选区和保存/取消操作。",
                            "应用角色模板会覆盖名称、描述、系统提示词、工具、人格风格、边界模式和默认语音，并自动匹配同名技能。",
                            "勾选知识库会自动启用检索工具；勾选表单读写权限会自动启用查询或管理表单数据的工具。",
                            "资源列表中的跳转按钮可直接打开对应知识库、技能、MCP、表单或子角色配置；保存后回到对话页。",
                            "分享链接会按勾选项打包角色、技能、知识库、MCP、表单和多角色依赖，并自动复制到剪贴板。",
                            "版本记录可恢复历史版本；恢复后该角色会重新成为当前选中的对话角色。",
                          ]
                        : [
                            "The list shows configurable agents. Hidden agents are kept out of the chat agent switcher.",
                            "Selecting an agent opens detail mode; Edit enables the form, resource selectors, and Save/Cancel actions.",
                            "Applying a role template overwrites name, description, system prompt, tools, persona style, boundary mode, and default voice, then matches skills by name.",
                            "Selecting knowledge bases automatically enables retrieval. Form read/write permissions automatically enable query or manage form-data tools.",
                            "Jump buttons in linked resource lists open the matching Knowledge, Skill, MCP, Form, or child Agent editor; saving returns to Chat.",
                            "Share links package the selected dependencies and are copied to the clipboard automatically.",
                            "Version history can restore an older version; the restored agent becomes the active chat agent.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-knowledge"
                ref={registerSectionRef("section-knowledge")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Database className="h-5 w-5 text-primary" />
                    {zh ? "知识库模块" : "Knowledge"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    <FeatureTile
                      icon={Database}
                      title={zh ? "知识库" : "Knowledge bases"}
                      description={zh ? "上传业务资料、政策、FAQ 或项目文档后，把知识库绑定到角色。提问时角色会检索相关内容作为依据。" : "Upload business materials, policies, FAQs, or project documents, then attach the knowledge base to an agent for retrieval-grounded answers."}
                    />
                    <FeatureTile
                      icon={TableProperties}
                      title={zh ? "后台表单" : "Backend forms"}
                      description={zh ? "表单适合管理结构化数据，例如客户线索、工单、产品清单或审批记录，并可通过开放接口读写。" : "Forms manage structured data such as leads, tickets, product lists, or approval records, and can be read or written through APIs."}
                    />
                  </div>
                  <div className="rounded-lg bg-secondary p-4 text-sm leading-7 text-muted-foreground">
                    {zh
                      ? "建议把长期稳定的业务知识放入知识库，把需要严格执行的步骤写成技能，把可增删改查的数据放到表单。"
                      : "A practical split: put stable business knowledge in knowledge bases, strict operating steps in skills, and editable records in forms."}
                  </div>
                  <InteractionBlock
                    title={zh ? "知识库管理的交互逻辑" : "Knowledge management interaction logic"}
                    items={
                      zh
                        ? [
                            "点击知识库进入详情态；系统知识库只能查看，普通知识库可以编辑名称、描述和文件。",
                            "新建知识库会打开空表单，保存后自动选中新知识库。",
                            "上传文件通过当前知识库的上传按钮触发，上传过程中按钮进入加载态；成功后文件列表和导入状态会刷新。",
                            "文件删除只影响当前知识库；删除知识库前会进入确认态，删除后自动选择列表中的下一个知识库。",
                            "导入中的知识库会被定时刷新状态，直到索引完成或失败。",
                          ]
                        : [
                            "Selecting a knowledge base opens detail mode. System knowledge bases are read-only; regular ones can edit metadata and files.",
                            "New opens a blank form and selects the created knowledge base after saving.",
                            "Upload uses the active knowledge base upload button, shows loading state, then refreshes files and import status.",
                            "File deletion only affects the active knowledge base. Deleting a knowledge base requires confirmation and then selects the next item.",
                            "Knowledge bases in importing state are polled until indexing completes or fails.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-forms"
                ref={registerSectionRef("section-forms")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <TableProperties className="h-5 w-5 text-primary" />
                    {zh ? "表单模块" : "Forms"}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {zh
                      ? "表单用于管理结构化业务数据，并可绑定到角色，让角色按权限查询、新增或更新记录。"
                      : "Forms manage structured business records and can be linked to agents so they can query, create, or update records according to permissions."}
                  </p>
                  <InteractionBlock
                    title={zh ? "表单设计与数据表的交互逻辑" : "Form designer and records interaction logic"}
                    items={
                      zh
                        ? [
                            "左侧表单按分类展示；点击表单会加载字段定义、Hook 配置和记录表格。",
                            "新建表单默认带一个名称字段；字段 ID 不能重复，也不能使用 createdAt 或 updatedAt 系统字段。",
                            "字段设计器支持文本、数字、日期、布尔和下拉选项；保存前会校验字段和 Hook 条件。",
                            "Hook 需要选择有效字段、匹配条件和 http(s) 地址；满足条件的记录会按配置调用外部接口。",
                            "新增记录会先出现在表格顶部并标记为未保存；修改单元格后需要保存该行或保存全部变更。",
                            "记录保存前会按字段必填、类型和选项做校验；草稿记录删除只移除本地行，已保存记录删除会调用后端。",
                            "从角色编辑器中创建表单时，保存后会返回该角色并自动关联，同时默认授予读取权限。",
                          ]
                        : [
                            "The form list is grouped by category. Selecting one loads its fields, hooks, and records table.",
                            "New forms start with a Name field. Field IDs must be unique and cannot use createdAt or updatedAt.",
                            "The designer supports text, number, date, boolean, and select fields; fields and hooks are validated before saving.",
                            "Hooks require a valid field, match condition, and http(s) URL. Matching records call the configured external API.",
                            "Adding a record creates an unsaved row at the top. Editing cells marks rows dirty until that row or all changes are saved.",
                            "Records are validated before saving. Deleting a draft removes the local row; deleting a saved record calls the backend.",
                            "When created from the agent editor, saving returns to that agent, links the form, and grants read permission by default.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-mcp"
                ref={registerSectionRef("section-mcp")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Cpu className="h-5 w-5 text-primary" />
                    {zh ? "MCP 模块" : "MCP"}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {zh
                      ? "MCP 模块用于登记外部 MCP Server，让角色在对话中调用服务暴露的工具、资源和提示词。"
                      : "MCP registers external MCP servers so agents can use their advertised tools, resources, and prompts during chat."}
                  </p>
                  <InteractionBlock
                    title={zh ? "MCP 服务配置的交互逻辑" : "MCP server interaction logic"}
                    items={
                      zh
                        ? [
                            "点击 MCP 服务只查看已发现的 tools、resources 和 prompts；点击编辑后才会打开连接表单。",
                            "新建时默认使用 Streamable HTTP，并预填本地示例地址和请求头 JSON。",
                            "保存前会解析自定义请求头 JSON；格式错误会阻止保存并提示修正。",
                            "保存或更新时会请求后端发现服务能力；发现失败会在页面内显示错误信息。",
                            "删除 MCP 服务需要确认，成功后自动选择剩余的第一个服务。",
                            "角色配置里勾选 MCP 后，该角色才会在对话执行时携带对应 MCP 能力。",
                          ]
                        : [
                            "Selecting an MCP server only shows discovered tools, resources, and prompts; Edit opens the connection form.",
                            "New defaults to Streamable HTTP and pre-fills a local sample URL and header JSON.",
                            "Custom headers are parsed as JSON before saving. Invalid JSON blocks the save and shows feedback.",
                            "Saving or updating asks the backend to discover server capabilities; discovery failures appear inline.",
                            "Deleting an MCP server requires confirmation and then selects the first remaining server.",
                            "Agents only receive MCP capabilities after the server is selected in that agent's configuration.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-voice"
                ref={registerSectionRef("section-voice")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Mic className="h-5 w-5 text-primary" />
                    {zh ? "语音使用" : "Voice"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FeatureTile
                      icon={Mic}
                      title={zh ? "语音输入" : "Voice input"}
                      description={zh ? "在对话页点击语音按钮开始说话，平台会识别语音并发送给当前角色处理。" : "Use the voice button in Chat to speak. The platform transcribes speech and sends it to the selected agent."}
                    />
                    <FeatureTile
                      icon={KeyRound}
                      title={zh ? "声纹绑定" : "Voiceprint"}
                      description={zh ? "在用户设置中注册声纹后，可以在角色配置里启用说话人验证，限制特定声音使用。" : "Register a voiceprint in User Settings, then enable speaker verification on an agent to restrict who can use it."}
                    />
                    <FeatureTile
                      icon={Settings}
                      title={zh ? "语音配置" : "Voice settings"}
                      description={zh ? "角色可配置语音打断、TTS 播放和声纹验证。若关闭打断，回复播放期间的语音不会延迟发送。" : "Agents can configure interruption, TTS playback, and speaker verification. If interruption is off, speech during playback is suppressed."}
                    />
                  </div>
                  <InteractionBlock
                    title={zh ? "语音状态的交互逻辑" : "Voice state interaction logic"}
                    items={
                      zh
                        ? [
                            "语音按钮启动后会进入监听、转写、处理和播放等状态；实时转写会同步显示在输入框。",
                            "识别到完整语音后会直接发送文本，不依赖输入框异步更新，避免空消息。",
                            "AI 回复播放期间，如果角色允许打断，新的语音会触发停止并立即处理；如果关闭打断，播放期间捕获的语音会被抑制。",
                            "启用声纹验证时，需要先在用户设置中注册声纹并在角色中绑定，否则会拒绝未授权声音。",
                            "离开页面或组件卸载时，前端会停止语音模式、清空等待队列并终止未完成的语音状态。",
                          ]
                        : [
                            "The voice button moves through listening, transcribing, processing, and speaking states; interim transcript text appears in the input.",
                            "A final transcript is sent directly and does not depend on asynchronous input state updates.",
                            "During playback, interruption-enabled agents stop the current response and process the new speech; if interruption is disabled, speech captured during playback is suppressed.",
                            "Speaker verification requires a registered voiceprint in User Settings and a bound voiceprint on the agent.",
                            "Leaving the page stops voice mode, clears queued voice messages, and ends unfinished voice state.",
                          ]
                    }
                  />
                </div>
              </section>

              <section
                id="section-settings"
                ref={registerSectionRef("section-settings")}
                className="scroll-mt-4 rounded-xl bg-card p-5 shadow-depth-xs sm:p-6"
              >
                <div className="flex flex-col gap-4">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Settings className="h-5 w-5 text-primary" />
                    {zh ? "账号与设置" : "Account and Settings"}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    <FeatureTile
                      icon={KeyRound}
                      title="API Key"
                      description={zh ? "在用户设置中创建 API Key 后，可让外部系统调用你拥有的角色和表单接口。" : "Create API keys in User Settings so external systems can call your agents and form APIs."}
                    />
                    <FeatureTile
                      icon={Settings}
                      title={zh ? "个人资料" : "Profile"}
                      description={zh ? "可更新用户名、手机号等个人信息，并管理和当前账号相关的语音资料。" : "Update your username, phone number, and voice assets associated with the account."}
                    />
                    <FeatureTile
                      icon={MessageSquareText}
                      title={zh ? "清理对话" : "Clear conversations"}
                      description={zh ? "需要重置工作区时，可在用户设置中清理历史对话。删除后无法从侧边栏恢复。" : "When you need to reset the workspace, clear conversation history in User Settings. Deleted threads will not reappear in the sidebar."}
                    />
                  </div>
                  <InteractionBlock
                    title={zh ? "账号设置的交互逻辑" : "Account settings interaction logic"}
                    items={
                      zh
                        ? [
                            "用户设置左侧目录会随滚动高亮当前区域；点击目录项会平滑滚动到对应设置块。",
                            "个人偏好和安全开关会自动保存；保存中、保存成功和失败都会显示状态反馈。",
                            "手机号绑定和密码修改使用短信验证码；发送验证码后按钮会进入倒计时。",
                            "工作区管理入口用于切换或管理当前工作区；没有管理权限的账号只能发起需要审批的配置变更。",
                            "声纹管理支持录音或上传音频注册声纹；删除声纹会影响使用该声纹验证的角色。",
                            "API Key 创建后只完整显示一次；复制后可用于外部系统调用角色和表单接口。",
                            "清理对话和删除账号属于危险操作，会先打开确认弹窗并要求输入确认文本。",
                          ]
                        : [
                            "The settings side nav highlights the section in view; selecting an item smoothly scrolls to that section.",
                            "Preferences and safety switches auto-save and show saving, success, or error feedback.",
                            "Phone binding and password changes use SMS codes; code buttons enter cooldown after sending.",
                            "Workspace management switches or manages the active workspace; users without manage permission submit pending configuration changes.",
                            "Voiceprints can be enrolled by recording or uploading audio. Deleting one affects agents that use it for verification.",
                            "API keys are shown in full only once after creation and can then be used by external systems for agent and form APIs.",
                            "Clearing conversations and deleting the account are danger actions with confirmation dialogs and required confirmation text.",
                          ]
                    }
                  />
                </div>
              </section>
            </div>
          </main>
        </ScrollArea>
      </div>
    </div>
  )
}
