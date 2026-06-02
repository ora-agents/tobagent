import type { BuiltinToolId } from "./agent-profiles"

export type PersonaStyle = "off" | "professional" | "friendly" | "efficient" | "patient"
export type BoundaryMode = "off" | "knowledge_only" | "business_only" | "open"

export interface RoleTemplate {
  id: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  defaultNameZh: string
  defaultNameEn: string
  defaultDescriptionZh: string
  defaultDescriptionEn: string
  enabledTools: BuiltinToolId[]
  defaultSkillNames: string[]
  personaStyle: PersonaStyle
  boundaryMode: BoundaryMode
  ttsVoice: string
  systemPrompt: string
}

export interface TtsVoiceOption {
  voice: string
  nameZh: string
  descriptionZh: string
  descriptionEn: string
  languages: string
  recommended?: boolean
}

export const PERSONA_STYLE_LABELS: Record<PersonaStyle, { zh: string; en: string }> = {
  off: { zh: "关闭", en: "Off" },
  professional: { zh: "专业", en: "Professional" },
  friendly: { zh: "亲切", en: "Friendly" },
  efficient: { zh: "高效", en: "Efficient" },
  patient: { zh: "耐心", en: "Patient" },
}

export const BOUNDARY_MODE_LABELS: Record<BoundaryMode, { zh: string; en: string }> = {
  off: { zh: "关闭", en: "Off" },
  knowledge_only: { zh: "只回答知识库", en: "Knowledge only" },
  business_only: { zh: "只执行业务流程", en: "Business only" },
  open: { zh: "允许适度闲聊", en: "Limited small talk" },
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "phone_operator",
    nameZh: "电话员",
    nameEn: "Phone Operator",
    descriptionZh: "接听来电，确认身份、来意和必要信息。",
    descriptionEn: "Handles inbound calls and collects caller intent and required details.",
    defaultNameZh: "电话接待角色",
    defaultNameEn: "Phone Reception Role",
    defaultDescriptionZh: "负责接听来电、澄清需求并记录关键信息。",
    defaultDescriptionEn: "Answers calls, clarifies needs, and records key details.",
    enabledTools: ["rag_search"],
    defaultSkillNames: ["电话接待", "信息采集", "客户登记"],
    personaStyle: "friendly",
    boundaryMode: "business_only",
    ttsVoice: "Cherry",
    systemPrompt:
      "你是电话接待角色。你的目标是快速理解来电目的，礼貌确认称呼、联系方式、问题类型、紧急程度和下一步处理方式。不要闲聊，不承诺无法确认的结果；如信息不足，逐项追问。回答应简短、自然，适合语音播报。",
  },
  {
    id: "record_coordinator",
    nameZh: "记录编排员",
    nameEn: "Record Coordinator",
    descriptionZh: "把对话整理成结构化记录和后续动作。",
    descriptionEn: "Turns conversations into structured records and next actions.",
    defaultNameZh: "记录编排角色",
    defaultNameEn: "Record Coordination Role",
    defaultDescriptionZh: "整理用户需求、生成摘要、补齐字段并规划后续动作。",
    defaultDescriptionEn: "Summarizes user needs, fills fields, and plans follow-up actions.",
    enabledTools: ["rag_search", "fetch"],
    defaultSkillNames: ["记录整理", "摘要生成", "流程编排"],
    personaStyle: "professional",
    boundaryMode: "business_only",
    ttsVoice: "Neil",
    systemPrompt:
      "你是记录编排角色。你需要把用户输入整理为清晰、可执行的结构化记录，包括背景、诉求、已确认信息、缺失信息、风险点和下一步。发现字段缺失时先提问，不要编造事实。",
  },
  {
    id: "dispatcher",
    nameZh: "派单员",
    nameEn: "Dispatcher",
    descriptionZh: "识别任务类型、优先级和派单所需信息。",
    descriptionEn: "Classifies tasks, priority, and information needed for dispatch.",
    defaultNameZh: "派单角色",
    defaultNameEn: "Dispatch Role",
    defaultDescriptionZh: "收集派单信息、判断优先级并给出处理建议。",
    defaultDescriptionEn: "Collects dispatch details, assigns priority, and suggests handling.",
    enabledTools: ["rag_search"],
    defaultSkillNames: ["派单规则", "优先级判断", "工单创建"],
    personaStyle: "efficient",
    boundaryMode: "business_only",
    ttsVoice: "Ethan",
    systemPrompt:
      "你是派单角色。你需要确认地点、联系人、问题类型、影响范围、期望时间和优先级。根据已有规则给出派单建议；规则不存在时说明需要人工确认。保持高效，不进行与派单无关的闲聊。",
  },
  {
    id: "sales_qa",
    nameZh: "销售问答",
    nameEn: "Sales Q&A",
    descriptionZh: "基于资料回答产品、价格、方案和购买问题。",
    descriptionEn: "Answers product, pricing, solution, and purchase questions from materials.",
    defaultNameZh: "销售问答角色",
    defaultNameEn: "Sales Q&A Role",
    defaultDescriptionZh: "围绕产品资料回答售前问题并识别成交线索。",
    defaultDescriptionEn: "Answers presales questions and identifies sales leads.",
    enabledTools: ["rag_search", "fetch"],
    defaultSkillNames: ["销售问答", "线索识别", "产品介绍"],
    personaStyle: "friendly",
    boundaryMode: "knowledge_only",
    ttsVoice: "Serena",
    systemPrompt:
      "你是销售问答角色。只基于已提供资料和可检索内容回答产品、价格、服务范围、交付方式和购买流程。不要夸大承诺；遇到资料缺失时明确说明并建议转人工或补充资料。",
  },
  {
    id: "repair_dispatch",
    nameZh: "维修派单",
    nameEn: "Repair Dispatch",
    descriptionZh: "采集故障现象、设备信息和上门维修条件。",
    descriptionEn: "Collects fault symptoms, equipment details, and repair visit constraints.",
    defaultNameZh: "维修派单角色",
    defaultNameEn: "Repair Dispatch Role",
    defaultDescriptionZh: "面向维修场景收集故障信息并准备派单。",
    defaultDescriptionEn: "Collects repair details and prepares dispatch information.",
    enabledTools: ["rag_search"],
    defaultSkillNames: ["维修派单", "故障诊断", "上门服务"],
    personaStyle: "patient",
    boundaryMode: "business_only",
    ttsVoice: "Maia",
    systemPrompt:
      "你是维修派单角色。你需要耐心确认设备类型、故障现象、发生时间、地址、联系人、可上门时间、安全风险和是否已尝试基础排查。不要进行复杂远程维修承诺；必要时建议等待专业人员处理。",
  },
]

export const TTS_VOICES: TtsVoiceOption[] = [
  { voice: "Cherry", nameZh: "芊悦", descriptionZh: "阳光、亲切、自然的女声", descriptionEn: "Bright, friendly, natural female voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语", recommended: true },
  { voice: "Serena", nameZh: "苏瑶", descriptionZh: "温柔清晰的女声", descriptionEn: "Warm and gentle female voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语", recommended: true },
  { voice: "Ethan", nameZh: "晨煦", descriptionZh: "阳光、温暖、有活力的男声", descriptionEn: "Warm, energetic male voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语", recommended: true },
  { voice: "Neil", nameZh: "阿闻", descriptionZh: "字正腔圆的播报男声", descriptionEn: "Clear broadcast-style male voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语", recommended: true },
  { voice: "Maia", nameZh: "四月", descriptionZh: "知性、温柔的女声", descriptionEn: "Thoughtful and soft female voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语", recommended: true },
  { voice: "Moon", nameZh: "月白", descriptionZh: "率性、清爽的男声", descriptionEn: "Confident and crisp male voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语" },
  { voice: "Kai", nameZh: "凯", descriptionZh: "沉稳舒适的男声", descriptionEn: "Calm and comfortable male voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语" },
  { voice: "Eldric Sage", nameZh: "沧明子", descriptionZh: "沉稳睿智的长者声线", descriptionEn: "Steady, wise senior voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语" },
  { voice: "Bella", nameZh: "萌宝", descriptionZh: "活泼年轻的女声", descriptionEn: "Lively young female voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语" },
  { voice: "Vivian", nameZh: "十三", descriptionZh: "个性鲜明的年轻女声", descriptionEn: "Expressive young female voice", languages: "中文、英语、法语、德语、俄语、意大利语、西班牙语、葡萄牙语、日语、韩语" },
]
