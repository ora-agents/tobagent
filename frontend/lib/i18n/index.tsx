"use client"

import { useState, useEffect, createContext, useContext, useCallback } from "react"

export type Locale = "zh" | "en"

const zh = {
  // Header
  newChat: "新对话",
  chat: "Chat",

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
  thumbsUp: "有帮助",
  thumbsDown: "没有帮助",
  addComment: "添加评论",
  submitComment: "提交",
  cancel: "取消",
  viewTrace: "查看追踪",
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
} as const

const en = {
  // Header
  newChat: "New Chat",
  chat: "Chat",

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
  thumbsUp: "Helpful",
  thumbsDown: "Not helpful",
  addComment: "Add comment",
  submitComment: "Submit",
  cancel: "Cancel",
  viewTrace: "View trace",
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
