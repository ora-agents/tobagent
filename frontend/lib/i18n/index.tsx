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
