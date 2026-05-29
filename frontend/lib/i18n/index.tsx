"use client"

import { useState, useEffect, createContext, useContext, useCallback } from "react"

export type Locale = "zh" | "en"

const zh = {
  // Header
  newChat: "新对话",
  chat: "聊天",
  lightMode: "浅色模式",
  darkMode: "深色模式",

  // Sidebar
  threads: "对话记录",
  searchThreads: "搜索对话...",
  today: "今天",
  yesterday: "昨天",
  previous7Days: "过去 7 天",
  older: "更早",
  noResultsFound: "未找到结果",
  tryDifferentSearch: "请尝试其他搜索词",
  noConversationsYet: "暂无对话",
  startChatting: "开始对话后，历史记录将显示在这里！",
  loadingConversations: "加载对话记录中...",
  justNow: "刚刚",

  // Agent Settings
  agentSettings: "智能体设置",
  configureAgent: "配置智能体类型、AI 模型和递归深度限制。",
  agentType: "智能体类型",
  selectAgentType: "选择智能体类型",
  moreAgentTypesComing: "更多智能体类型即将推出！",
  model: "模型",
  selectModel: "选择模型",
  loadingModels: "加载模型中...",
  recursionLimit: "递归深度限制",
  recursionLimitDesc: "智能体可执行的最大迭代次数（默认：100）",
  viewKeyboardShortcuts: "查看键盘快捷键",
  agent: "智能体",

  // Welcome screen
  whatCanIHelpWith: "我能帮您做什么？",
  askAnything: "有什么想问的...",
  initializing: "初始化中...",
  dropFilesHere: "将文件拖放到这里",
  attachFiles: "附加文件（图片、代码、日志）",
  stop: "停止",
  stopping: "停止中...",

  // Chat input
  typeNextMessage: "输入下一条消息...",
  queued: "排队中",
  enterToSend: "发送",
  shiftEnterNewLine: "换行",

  // Message item
  copy: "复制",
  copied: "已复制",
  regenerate: "重新生成",
  editAndRerun: "编辑并重新运行",
  cancel: "取消",
  thinking: "思考中...",
  tokens: "令牌",
  cost: "费用",

  // Tooltip
  recursionLimitLabel: "递归深度",

  // Management
  skills: "技能",
  agents: "智能体",
  knowledgeBase: "知识库",
  backToChat: "返回对话",
  addSkill: "添加技能",
  editSkill: "编辑技能",
  skillName: "技能名称",
  skillDesc: "技能描述",
  skillContent: "技能内容",
  skillTemplate: "标准模板",
  skillSaved: "技能已保存",
  skillDeleted: "技能已删除",
  newAgent: "新智能体",
  addAgent: "创建智能体",
  editAgent: "编辑智能体",
  agentName: "智能体名称",
  agentDesc: "智能体描述",
  systemPrompt: "系统提示词",
  tools: "工具",
  agentSaved: "智能体已保存",
  agentDeleted: "智能体已删除",
  newKB: "新知识库",
  addKnowledge: "创建知识库",
  editKB: "编辑知识库",
  editKnowledge: "编辑知识库",
  kbName: "知识库名称",
  kbDesc: "知识库描述",
  kbSaved: "知识库已保存",
  kbDeleted: "知识库已删除",
  uploadDoc: "上传文档",
  selectFile: "选择文件",
  noSkills: "暂无技能",
  noKB: "暂无知识库",
  save: "保存",
  delete: "删除",
  create: "创建",
  name: "名称",
  description: "描述",
  actions: "操作",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  confirmDelete: "确认删除吗？此操作不可撤销。",
  skillsManager: "技能管理",
  agentsManager: "智能体管理",
  kbManager: "知识库管理",
  kbFiles: "关联文档",
  management: "管理中心",
  backend: "后台管理",

  // Common & General
  untitled: "无标题",
  loading: "加载中...",

  // Voice & File Preview
  stopListening: "停止倾听",
  voiceInput: "语音输入",
  file: "文件",
  filesLabel: "个文件",
  removeFile: "移除文件",

  // Time Travel Panel
  timeTravel: "时光旅行",
  checkpointsInConversation: "个对话检查点",
  step: "步骤",
  current: "当前",
  jumpHere: "跳转至此",
  fork: "创建分支",

  // Chat & Message Feedbacks
  newConversation: "新对话",
  failedToRegenerate: "生成回答失败",
  failedToRerunFromEdit: "编辑运行失败",
  tool: "工具",
  viewArguments: "查看参数",
  viewOutput: "查看输出",
  subagentOutputs: "子智能体输出",
  clickToExpand: "点击展开",
  running: "运行中...",
  complete: "已完成",
  waitingForOutput: "等待输出...",
  scrollBottom: "滚动到底部",

  // Agent selector & RAG upload
  exclusiveKnowledgeBase: "专属知识库",
  pleaseSaveAgentFirstToUpload: "请先保存智能体再上传专属文档。",
  linkedSharedKnowledgeBases: "关联的共享知识库",
  linkCustomSkills: "关联自定义技能",
  linkMcpServers: "关联 MCP 服务端",
  uploadSuccess: "上传成功",
  uploadFailed: "上传失败",
  noDescription: "暂无描述",

  // MCP Tab Panel
  mcpServers: "MCP 服务端",
  addMcpServer: "添加 MCP 服务端",
  editMcpServer: "编辑 MCP 服务端",
  noMcpServers: "暂无已定义的 MCP 服务端。",
  selectOrCreateMcpToStart: "选择或创建 MCP 服务端以开始。",
  mcpType: "传输类型",
  sseTransport: "SSE",
  streamableHttpTransport: "Streamable HTTP",
  sseServerUrl: "MCP 服务端 URL",
  customHeadersJson: "自定义 Header (JSON 格式)",
  customHeaders: "自定义 Header",
  noCustomHeaders: "未配置自定义 Header。",
  mcpServerDescription: "指定鉴权或请求验证所需的 Header。必须是合法的 JSON 对象。",
  editServer: "编辑服务端",

  // New Management keys
  mcpConfigureDesc: "配置与管理您的自定义资产",
  defaultSystemAgent: "默认系统智能体",
  defaultSystemAgentDesc: "预配置的文档助手智能体。",
  selected: "已选择",
  setActive: "设为活跃",
  systemInformation: "系统信息",
  defaultAgentDescText: "这是标准的内置 LangChain 智能体。它启用了主要知识库（RAG 搜索）、抓取（Fetch）功能和标准模型定义。",
  defaultAgentCustomizePrompt: "点击左侧面板上的“+”图标即可自定义创建您专属的助手模型，并配备自定义提示词和专用工具。",
  selectAgentToViewOrCreate: "选择一个智能体配置，或者创建一个新的智能体。",
  systemInstructions: "系统指令",
  enabledToolsTitle: "启用的工具",
  enabled: "已启用",
  disabled: "已禁用",

  // Skills additional
  noDescriptionProvided: "暂无描述",
  confirmDeleteTitle: "确认删除",
  cancelTitle: "取消",
  editTitle: "编辑",
  deleteTitle: "删除",
  skillTextMarkdown: "技能 Markdown 文本",
  selectSkillToViewOrCreate: "选择一个技能来查看，或者创建一个新的技能。",

  // Knowledge Base additional
  uploading: "上传中...",
  noDocumentsLinked: "该知识库暂未关联任何文档。",
  deleteDocumentTitle: "删除文档",
  selectKbToViewOrCreate: "选择一个知识库，或者创建一个新的知识库。",

  // Placeholders
  mcpNamePlaceholder: "例如：天气 SSE 服务端",
  mcpUrlPlaceholder: "例如：http://localhost:8000/mcp",
  mcpHeadersPlaceholder: '例如：{\n  "Authorization": "Bearer 您的令牌"\n}',
  skillContentPlaceholder: "添加技能规则和模板文本...",
  agentNamePlaceholder: "自定义智能体",
  agentDescPlaceholder: "该智能体的简短描述",
  agentPromptPlaceholder: "您是一个得力的助手...",
  kbNamePlaceholder: "例如：我的知识库",
  kbDescPlaceholder: "上传文件的上下文描述",

  // Agent Profiles Dialog additional
  selectCreateOrManageAgents: "选择、创建或管理智能体配置",
  configureNewAgent: "配置新的智能体",
  editSelectedAgent: "编辑选定的智能体配置",
} as const

const en = {
  // Header
  newChat: "New Chat",
  chat: "Chat",
  lightMode: "Light Mode",
  darkMode: "Dark Mode",

  // Sidebar
  threads: "Threads",
  searchThreads: "Search threads...",
  today: "Today",
  yesterday: "Yesterday",
  previous7Days: "Previous 7 Days",
  older: "Older",
  noResultsFound: "No results found",
  tryDifferentSearch: "Try a different search term",
  noConversationsYet: "No conversations yet",
  startChatting: "Start chatting to see your threads here!",
  loadingConversations: "Loading conversations...",
  justNow: "Just now",

  // Agent Settings
  agentSettings: "Agent Settings",
  configureAgent: "Configure the agent type, AI model, and recursion limit.",
  agentType: "Agent Type",
  selectAgentType: "Select agent type",
  moreAgentTypesComing: "More agent types coming soon!",
  model: "Model",
  selectModel: "Select a model",
  loadingModels: "Loading models...",
  recursionLimit: "Recursion Limit",
  recursionLimitDesc: "Maximum number of iterations the agent can perform (default: 100)",
  viewKeyboardShortcuts: "View Keyboard Shortcuts",
  agent: "Agent",

  // Welcome screen
  whatCanIHelpWith: "What can I help with?",
  askAnything: "Ask anything...",
  initializing: "Initializing...",
  dropFilesHere: "Drop files here",
  attachFiles: "Attach files (images, code, logs)",
  stop: "Stop",
  stopping: "Stopping...",

  // Chat input
  typeNextMessage: "Type your next message...",
  queued: "Queued",
  enterToSend: "to send",
  shiftEnterNewLine: "new line",

  // Message item
  copy: "Copy",
  copied: "Copied",
  regenerate: "Regenerate",
  editAndRerun: "Edit & Rerun",
  cancel: "Cancel",
  thinking: "Thinking...",
  tokens: "tokens",
  cost: "cost",

  // Tooltip
  recursionLimitLabel: "Recursion Limit",

  // Management
  skills: "Skills",
  agents: "Agents",
  knowledgeBase: "Knowledge Base",
  backToChat: "Back to Chat",
  addSkill: "Add Skill",
  editSkill: "Edit Skill",
  skillName: "Skill Name",
  skillDesc: "Skill Description",
  skillContent: "Skill Content",
  skillTemplate: "Standard Template",
  skillSaved: "Skill saved",
  skillDeleted: "Skill deleted",
  newAgent: "New Agent",
  addAgent: "Create Agent",
  editAgent: "Edit Agent",
  agentName: "Agent Name",
  agentDesc: "Agent Description",
  systemPrompt: "System Prompt",
  tools: "Tools",
  agentSaved: "Agent saved",
  agentDeleted: "Agent deleted",
  newKB: "New Knowledge Base",
  addKnowledge: "Create Knowledge Base",
  editKB: "Edit Knowledge Base",
  editKnowledge: "Edit Knowledge Base",
  kbName: "Knowledge Base Name",
  kbDesc: "Knowledge Base Description",
  kbSaved: "Knowledge Base saved",
  kbDeleted: "Knowledge Base deleted",
  uploadDoc: "Upload Document",
  selectFile: "Select File",
  noSkills: "No skills yet",
  noKB: "No knowledge bases yet",
  save: "Save",
  delete: "Delete",
  create: "Create",
  name: "Name",
  description: "Description",
  actions: "Actions",
  createdAt: "Created At",
  updatedAt: "Updated At",
  confirmDelete: "Are you sure you want to delete? This action cannot be undone.",
  skillsManager: "Skills Manager",
  agentsManager: "Agents Manager",
  kbManager: "Knowledge Base Manager",
  kbFiles: "Related Documents",
  management: "Management Center",
  backend: "Backend",

  // Common & General
  untitled: "Untitled",
  loading: "Loading...",

  // Voice & File Preview
  stopListening: "Stop listening",
  voiceInput: "Voice input",
  file: "File",
  filesLabel: "files",
  removeFile: "Remove file",

  // Time Travel Panel
  timeTravel: "Time Travel",
  checkpointsInConversation: "checkpoints in conversation",
  step: "Step",
  current: "Current",
  jumpHere: "Jump Here",
  fork: "Fork",

  // Chat & Message Feedbacks
  newConversation: "New conversation",
  failedToRegenerate: "Failed to regenerate response",
  failedToRerunFromEdit: "Failed to rerun from edit",
  tool: "Tool",
  viewArguments: "View arguments",
  viewOutput: "View output",
  subagentOutputs: "Subagent Outputs",
  clickToExpand: "Click to expand",
  running: "Running...",
  complete: "Complete",
  waitingForOutput: "Waiting for output...",
  scrollBottom: "Scroll to bottom",

  // Agent selector & RAG upload
  exclusiveKnowledgeBase: "Exclusive Knowledge Base",
  pleaseSaveAgentFirstToUpload: "Please save the agent first to upload exclusive documents.",
  linkedSharedKnowledgeBases: "Linked Shared Knowledge Bases",
  linkCustomSkills: "Link Custom Skills",
  linkMcpServers: "Link MCP Servers",
  uploadSuccess: "Upload success",
  uploadFailed: "Upload failed",
  noDescription: "No description",

  // MCP Tab Panel
  mcpServers: "MCP Servers",
  addMcpServer: "Add MCP Server",
  editMcpServer: "Edit MCP Server",
  noMcpServers: "No MCP servers defined yet.",
  selectOrCreateMcpToStart: "Select or create an MCP Server to get started",
  mcpType: "Transport Type",
  sseTransport: "SSE",
  streamableHttpTransport: "Streamable HTTP",
  sseServerUrl: "MCP Server URL",
  customHeadersJson: "Custom Headers (JSON Format)",
  customHeaders: "Custom Headers",
  noCustomHeaders: "No custom headers configured.",
  mcpServerDescription: "Specify any headers needed for authentication or request validation. Must be a valid JSON object.",
  editServer: "Edit Server",

  // New Management keys
  mcpConfigureDesc: "Configure and orchestrate your custom assets",
  defaultSystemAgent: "Default System Agent",
  defaultSystemAgentDesc: "The preconfigured documentation assistant helper.",
  selected: "Selected",
  setActive: "Set Active",
  systemInformation: "SYSTEM INFORMATION",
  defaultAgentDescText: "This is the standard builtin LangChain agent. It has the primary knowledge base (RAG Search), Fetch capabilities, and standard model definitions enabled.",
  defaultAgentCustomizePrompt: "Customize it by clicking the \"+\" icon on the left panel to create your own bespoke assistant model with custom prompts and specialized tools.",
  selectAgentToViewOrCreate: "Select an Agent configuration or create a new one.",
  systemInstructions: "SYSTEM INSTRUCTIONS",
  enabledToolsTitle: "ENABLED TOOLS",
  enabled: "ENABLED",
  disabled: "DISABLED",

  // Skills additional
  noDescriptionProvided: "No description provided",
  confirmDeleteTitle: "Confirm delete",
  cancelTitle: "Cancel",
  editTitle: "Edit",
  deleteTitle: "Delete",
  skillTextMarkdown: "SKILL TEXT MARKDOWN",
  selectSkillToViewOrCreate: "Select a skill to view or create a new one.",

  // Knowledge Base additional
  uploading: "Uploading...",
  noDocumentsLinked: "No documents linked to this Knowledge Base yet.",
  deleteDocumentTitle: "Delete Document",
  selectKbToViewOrCreate: "Select a Knowledge Base or create a new one.",

  // Placeholders
  mcpNamePlaceholder: "e.g. Weather SSE Server",
  mcpUrlPlaceholder: "e.g. http://localhost:8000/mcp",
  mcpHeadersPlaceholder: 'e.g. {\n  "Authorization": "Bearer YOUR_TOKEN"\n}',
  skillContentPlaceholder: "Add skill rules and template text...",
  agentNamePlaceholder: "Custom Agent",
  agentDescPlaceholder: "Short description of this agent",
  agentPromptPlaceholder: "You are a helpful assistant...",
  kbNamePlaceholder: "e.g. My KB Archive",
  kbDescPlaceholder: "Context description of uploaded files",

  // Agent Profiles Dialog additional
  selectCreateOrManageAgents: "Select, create, or manage agent profiles",
  configureNewAgent: "Configure a new agent profile",
  editSelectedAgent: "Edit the selected agent profile",
} as const

export type Translations = { [K in keyof typeof zh]: string }

const translations: Record<Locale, Translations> = { zh, en }

interface I18nContextValue {
  t: Translations
  locale: Locale
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue>({
  t: zh,
  locale: "zh",
  setLocale: () => {},
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh")

  useEffect(() => {
    const saved = typeof window !== "undefined"
      ? (localStorage.getItem("locale") as Locale | null)
      : null
    if (saved && translations[saved]) {
      setLocaleState(saved)
    }
  }, [])

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    if (typeof window !== "undefined") {
      localStorage.setItem("locale", newLocale)
    }
  }, [])

  return (
    <I18nContext.Provider value={{ t: translations[locale], locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT(): Translations {
  return useContext(I18nContext).t
}

export function useI18n() {
  return useContext(I18nContext)
}
