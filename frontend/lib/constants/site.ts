export const SITE_NAME = "威思瑞客服智能体平台"
export const SITE_DESCRIPTION = "面向企业客服、知识库问答和智能体配置的 AI 客服智能体平台。"
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://agent.wsiri.cn").replace(/\/+$/, "")

export const ICP_RECORD = {
  number: "苏ICP备2024148430号",
  url: "https://beian.miit.gov.cn/",
} as const
