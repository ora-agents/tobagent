"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowLeft,
  Bot,
  BookOpenText,
  Boxes,
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
      { id: "section-agent", icon: Bot, title: zh ? "角色与技能" : "Agents and Skills" },
      { id: "section-knowledge", icon: Database, title: zh ? "知识库与表单" : "Knowledge and Forms" },
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
                    {zh ? "角色与技能" : "Agents and Skills"}
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
                  </div>
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
                    {zh ? "知识库与表单" : "Knowledge and Forms"}
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
                </div>
              </section>
            </div>
          </main>
        </ScrollArea>
      </div>
    </div>
  )
}
