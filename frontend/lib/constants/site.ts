export const SITE_NAME = "威思瑞通用智能体平台"
export const SITE_DESCRIPTION = "面向企业知识、业务流程和多场景服务的通用智能体平台。"
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://agent.wsiri.cn").replace(/\/+$/, "")

export const ICP_RECORD = {
  number: "苏ICP备2024148430号",
  url: "https://beian.miit.gov.cn/",
} as const
