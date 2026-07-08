"use client"

import Image from "next/image"
import Link from "next/link"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  DatabaseZap,
  FileSearch,
  Headphones,
  Layers3,
  MessageSquareText,
  Mic2,
  PanelLeft,
  ShieldCheck,
  Sparkles,
  Star,
  Workflow,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { StatusNotice } from "@/components/ui/status-notice"
import { Textarea } from "@/components/ui/textarea"
import { backendFetch } from "@/lib/api/backend-fetch"
import { ICP_RECORD, SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants/site"
import { useApiConfig } from "@/lib/config/api-config"
import { useAuth } from "@/components/providers/auth-provider"
import { cn } from "@/lib/utils"
import logoImage from "@/public/logo.png"

const productHighlights = [
  {
    icon: Bot,
    title: "专属客服 Agent",
    description: "按业务线配置角色、模型、知识与工具，让每个场景拥有稳定可控的数字客服。",
  },
  {
    icon: DatabaseZap,
    title: "企业知识库问答",
    description: "沉淀产品文档、FAQ 与流程资料，帮助客服回复保持一致、可追溯、可复用。",
  },
  {
    icon: Workflow,
    title: "流程与工具编排",
    description: "把查询、表单、外部系统与人工接管串联起来，覆盖咨询、售后与内部支持流程。",
  },
  {
    icon: Mic2,
    title: "语音交互能力",
    description: "支持唤醒、听写、播报与打断等语音链路，为桌面与移动场景提供自然交互。",
  },
]

const pricingPlans = [
  { duration: "3 个月", price: "1200 元", note: "适合短期验证" },
  { duration: "6 个月", price: "2200 元", note: "适合阶段部署" },
  { duration: "12 个月", price: "4000 元", note: "适合长期使用" },
]

const pricingFeatures = [
  "不限坐席和渠道数量",
  "金牌客服话术、豆包、DeepSeek、千问等大模型驱动",
  "设备报修/报警自动提醒家人、创建工单、及时呼叫救援，并实时反馈救援/维修状态",
]

const heroMetrics = [
  { value: "01", label: "知识沉淀", description: "文档、FAQ、流程统一归档" },
  { value: "02", label: "能力编排", description: "Agent、工具、策略按场景配置" },
  { value: "03", label: "运行追踪", description: "知识命中与工具调用可回溯" },
]

const workflowStats = [
  { label: "知识覆盖", value: "96.8%" },
  { label: "平均响应", value: "1.2s" },
  { label: "人工接管", value: "12%" },
]

const faqs = [
  {
    question: "适合哪些企业场景？",
    answer: "适合需要客服问答、售后支持、内部知识助手、业务流程咨询和多 Agent 管理的团队。",
  },
  {
    question: "是否可以接入企业已有资料？",
    answer: "可以围绕企业文档、知识库、表单和工具接口构建专属 Agent，具体接入方式按部署环境配置。",
  },
  {
    question: "网站和桌面端是什么关系？",
    answer: "网站提供浏览器工作台，桌面端复用同一套界面并面向桌面运行环境做后端地址等能力适配。",
  },
  {
    question: "是否支持语音客服体验？",
    answer: "支持语音输入、TTS 播放、状态同步和中断控制等能力，可与原生端语音提供方协同工作。",
  },
]

interface SiteTestimonial {
  id: string
  authorName: string
  role: string | null
  company: string | null
  rating: number
  quote: string
  createdAt: string
  updatedAt: string
  isOwn?: boolean
}

function TestimonialStars({
  value,
  onChange,
  disabled = false,
}: {
  value: number
  onChange?: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1" aria-label={`${value} 星评价`}>
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= value
        return onChange ? (
          <button
            key={star}
            type="button"
            disabled={disabled}
            aria-label={`选择 ${star} 星`}
            onClick={() => onChange(star)}
            className="flex size-8 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50"
          >
            <Star className={cn("size-4", active && "fill-current")} />
          </button>
        ) : (
          <Star key={star} className={cn("size-4 text-primary", active && "fill-current")} />
        )
      })}
    </div>
  )
}

function TestimonialCard({ item }: { item: SiteTestimonial }) {
  const subtitle = [item.role, item.company].filter(Boolean).join(" · ")

  return (
    <Card className="shadow-depth-xs">
      <CardHeader className="gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{item.authorName}</CardTitle>
            {subtitle ? <CardDescription className="mt-1 truncate">{subtitle}</CardDescription> : null}
          </div>
          {item.isOwn ? (
            <div className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
              我的评价
            </div>
          ) : null}
        </div>
        <TestimonialStars value={item.rating} />
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <p className="text-sm leading-7 text-foreground">“{item.quote}”</p>
      </CardContent>
    </Card>
  )
}

function TestimonialComposer({
  onPublished,
}: {
  onPublished: (testimonial: SiteTestimonial) => void
}) {
  const { user, loading: authLoading } = useAuth()
  const [role, setRole] = useState("")
  const [company, setCompany] = useState("")
  const [rating, setRating] = useState(5)
  const [quote, setQuote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = user && quote.trim().length >= 10 && !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setMessage(null)
    setError(null)
    try {
      const resp = await backendFetch("/api/site-testimonials", {
        method: "POST",
        json: {
          role,
          company,
          rating,
          quote,
        },
      })
      if (!resp.ok) {
        throw new Error("评价发布失败，请稍后再试。")
      }
      const saved = (await resp.json()) as SiteTestimonial
      onPublished(saved)
      setMessage("评价已发布。再次提交会更新你的评价。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "评价发布失败，请稍后再试。")
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <Card className="shadow-depth-xs">
        <CardHeader className="p-5">
          <CardTitle className="text-base">正在检查登录状态</CardTitle>
          <CardDescription>登录后可以发表你的真实评价。</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!user) {
    return (
      <Card className="shadow-depth-xs">
        <CardHeader className="gap-3 p-5">
          <CardTitle className="text-base">登录后发表真实评价</CardTitle>
          <CardDescription className="leading-6">
            评价会使用你的账号名称展示，未登录访客只能浏览已发布评价。
          </CardDescription>
          <Button asChild className="w-fit">
            <Link href="/login">登录后评价</Link>
          </Button>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="shadow-depth-xs">
      <CardHeader className="p-5">
        <CardTitle className="text-base">发表真实评价</CardTitle>
        <CardDescription>当前账号：{user.username}</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="你的角色" id="testimonial-role" description="可选，例如：客服主管">
              <Input
                id="testimonial-role"
                value={role}
                maxLength={80}
                onChange={(event) => setRole(event.target.value)}
                placeholder="客服主管"
              />
            </FormField>
            <FormField label="公司或行业" id="testimonial-company" description="可选，例如：智能硬件企业">
              <Input
                id="testimonial-company"
                value={company}
                maxLength={80}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="智能硬件企业"
              />
            </FormField>
          </div>
          <FormField label="评分" id="testimonial-rating">
            <TestimonialStars value={rating} onChange={setRating} disabled={submitting} />
          </FormField>
          <FormField
            label="评价内容"
            id="testimonial-quote"
            required
            description="至少 10 个字，建议描述真实使用感受。"
          >
            <Textarea
              id="testimonial-quote"
              value={quote}
              minLength={10}
              maxLength={800}
              rows={5}
              onChange={(event) => setQuote(event.target.value)}
              placeholder="请写下你的真实体验..."
              aria-invalid={quote.trim().length > 0 && quote.trim().length < 10}
            />
          </FormField>
          {message ? <StatusNotice tone="success">{message}</StatusNotice> : null}
          {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}
          <Button type="submit" className="w-fit" disabled={!canSubmit}>
            {submitting ? "发布中..." : "发布评价"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

const interfaceCapabilities = [
  {
    title: "快速切换业务 Agent",
    description: "按售前、售后、内部支持等场景组织入口，让客服从同一界面接管不同业务线。",
  },
  {
    title: "查看知识命中与工具调用",
    description: "把回复依据、工具结果和处理状态放在同一流程中，便于复盘和纠偏。",
  },
  {
    title: "管理语音和用户设置",
    description: "统一配置语音体验、用户偏好和运行状态，减少跨端体验差异。",
  },
  {
    title: "追踪问题处理过程",
    description: "围绕会话、Agent 和工具链路记录关键节点，帮助管理员定位问题来源。",
  },
]

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center">
      <div className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
        {eyebrow}
      </div>
      <h2 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <p className="text-base leading-7 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function ProductPricing() {
  return (
    <div id="pricing" className="grid gap-6 lg:grid-cols-[0.76fr_1fr] lg:items-start">
      <div className="flex flex-col gap-5">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CalendarDays className="size-5" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="w-fit rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
            产品价格
          </div>
          <h3 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            7 天试用，按使用周期灵活购买
          </h3>
          <p className="text-base leading-7 text-muted-foreground">
            企业可先体验核心能力，再根据部署周期选择对应版本。
          </p>
        </div>
      </div>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {pricingPlans.map((plan) => (
            <Card key={plan.duration} className="shadow-depth-xs">
              <CardHeader className="gap-3 p-5">
                <CardDescription className="font-semibold text-primary">{plan.duration}</CardDescription>
                <CardTitle className="text-2xl leading-none">{plan.price}</CardTitle>
                <CardDescription>{plan.note}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="rounded-xl bg-card p-5 shadow-depth-xs">
          <div className="text-sm font-semibold text-foreground">包含功能</div>
          <div className="mt-4 grid gap-3">
            {pricingFeatures.map((feature) => (
              <div key={feature} className="flex gap-3 rounded-lg bg-secondary p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-sm leading-6 text-foreground">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function InterfacePreview() {
  return (
    <div className="relative">
      <div className="absolute -left-5 top-10 hidden h-[calc(100%-5rem)] w-5 rounded-l-xl bg-primary lg:block" />
      <div className="rounded-xl bg-[#181715] p-3 text-[#faf9f5] shadow-depth-lg">
        <div className="overflow-hidden rounded-lg bg-[#1f1e1b]">
          <div className="flex items-center justify-between bg-[#252320] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-error" />
              <span className="size-2 rounded-full bg-warning" />
              <span className="size-2 rounded-full bg-accent-cyan" />
            </div>
            <div className="rounded-md bg-[#1f1e1b] px-3 py-1 text-xs font-medium text-[#a09d96]">
              WSIRI Agent Operations
            </div>
          </div>
          <div className="grid min-h-[34rem] grid-cols-1 lg:grid-cols-[12.5rem_1fr]">
            <aside className="hidden bg-[#181715] p-4 lg:flex lg:flex-col lg:gap-3">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#faf9f5]">
                <PanelLeft className="size-4 text-accent-cyan" />
                服务工作台
              </div>
              {["售前接待", "知识库管理", "工具编排", "运行追踪"].map((item, index) => (
                <div
                  key={item}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm",
                    index === 0
                      ? "bg-primary text-primary-foreground"
                      : "bg-[#252320] text-[#a09d96]",
                  )}
                >
                  {item}
                </div>
              ))}
              <div className="mt-auto rounded-lg bg-[#252320] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#faf9f5]">
                  <Activity className="size-4 text-accent-cyan" />
                  今日状态
                </div>
                <div className="text-xs leading-5 text-[#a09d96]">在线 Agent 8 个，知识同步正常，语音服务就绪。</div>
              </div>
            </aside>
            <main className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#37342f] px-5 py-4">
                <div>
                  <div className="text-sm font-semibold text-[#faf9f5]">企业客服中枢</div>
                  <div className="mt-1 text-xs text-[#a09d96]">知识库已同步 · 工具权限已校验 · 语音就绪</div>
                </div>
                <div className="rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                  生产环境
                </div>
              </div>
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
                {workflowStats.map((item) => (
                  <div key={item.label} className="rounded-lg bg-[#252320] p-3">
                    <div className="text-xs text-[#a09d96]">{item.label}</div>
                    <div className="mt-2 text-xl font-semibold text-[#faf9f5]">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-1 flex-col gap-4 bg-[#181715] p-5">
                <div className="max-w-[84%] rounded-lg bg-[#252320] p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent-cyan">
                    <Headphones className="size-4" />
                    客户咨询
                  </div>
                  <p className="text-sm leading-6 text-[#faf9f5]">
                    请问企业知识库可以按不同产品线配置不同客服吗？
                  </p>
                </div>
                <div className="ml-auto max-w-[88%] rounded-lg bg-primary p-4 text-primary-foreground">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                    <Sparkles className="size-4" />
                    Agent 回复
                  </div>
                  <p className="text-sm leading-6">
                    可以。你可以为每条产品线创建独立 Agent，绑定对应知识库、工具权限和回复策略。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { icon: FileSearch, label: "命中知识" },
                    { icon: Layers3, label: "调用工具" },
                    { icon: BarChart3, label: "转人工规则" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-[#252320] p-3 text-xs font-medium text-[#a09d96]">
                      <item.icon className="mb-2 size-4 text-accent-cyan" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}

export function OfficialHomePage() {
  const { apiUrl, loading: apiConfigLoading } = useApiConfig()
  const [testimonials, setTestimonials] = useState<SiteTestimonial[]>([])
  const [testimonialsLoading, setTestimonialsLoading] = useState(true)
  const [testimonialsError, setTestimonialsError] = useState<string | null>(null)
  const [showAllTestimonials, setShowAllTestimonials] = useState(false)

  const visibleTestimonials = useMemo(
    () => showAllTestimonials ? testimonials : testimonials.slice(0, 6),
    [showAllTestimonials, testimonials],
  )

  const fetchTestimonials = useCallback(async () => {
    setTestimonialsLoading(true)
    setTestimonialsError(null)
    try {
      const resp = await backendFetch("/api/site-testimonials", { anonymous: true })
      if (!resp.ok) {
        throw new Error("暂时无法加载用户评价。")
      }
      setTestimonials((await resp.json()) as SiteTestimonial[])
    } catch (err) {
      setTestimonialsError(err instanceof Error ? err.message : "暂时无法加载用户评价。")
    } finally {
      setTestimonialsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (apiConfigLoading) return
    void fetchTestimonials()
  }, [apiConfigLoading, apiUrl, fetchTestimonials])

  const handlePublishedTestimonial = useCallback((testimonial: SiteTestimonial) => {
    setTestimonials((current) => [
      { ...testimonial, isOwn: true },
      ...current.filter((item) => item.id !== testimonial.id),
    ])
  }, [])

  return (
    <main className="h-svh overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label={SITE_NAME}>
            <Image src={logoImage} alt="威思瑞 WSIRI" width={112} height={72} priority className="h-10 w-auto" />
            <span className="hidden text-sm font-semibold sm:inline">{SITE_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#product" className="hover:text-foreground">产品介绍</a>
            <a href="#pricing" className="hover:text-foreground">价格</a>
            <a href="#interface" className="hover:text-foreground">界面</a>
            <a href="#reviews" className="hover:text-foreground">用户评价</a>
            <a href="#faq" className="hover:text-foreground">常见问题</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">登录</Link>
            </Button>
            <Button asChild size="sm">
              <a href="https://wsr.wsiri.cn/agentapp/?agentShare=wsiri-sales-helper">
                进入工作台
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <section className="bg-background">
        <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[0.84fr_1.16fr] lg:px-8 lg:py-16">
          <div className="flex flex-col gap-8">
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
              <ShieldCheck className="size-4" />
              企业客服智能体平台
            </div>
            <div className="flex flex-col gap-5">
              <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] text-foreground sm:text-6xl lg:text-[4.25rem] xl:text-7xl">
                <span className="block">威思瑞</span>
                <span className="block whitespace-nowrap">客服智能体平台</span>
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                {SITE_DESCRIPTION} 从知识沉淀、Agent 配置到语音交互与运行追踪，帮助企业构建可管理、可复用的智能客服工作台。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="https://wsr.wsiri.cn/agentapp/?agentShare=wsiri-sales-helper">
                  立即试用
                  <ArrowRight data-icon="inline-end" />
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#product">了解产品</a>
              </Button>
            </div>
            <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
              {heroMetrics.map((item) => (
                <div key={item.label} className="rounded-lg bg-secondary p-4">
                  <div className="text-xs font-semibold text-primary">{item.value}</div>
                  <div className="mt-2 text-sm font-semibold text-foreground">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
          <InterfacePreview />
        </div>
      </section>

      <section id="product" className="border-t border-border/60 bg-background-tint px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-12">
          <SectionHeading
            eyebrow="产品介绍"
            title="围绕企业服务场景构建智能体工作台"
            description="将知识、工具、流程、语音与追踪能力统一到一个可配置平台，减少重复回答，提升客服与运营团队的交付一致性。"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {productHighlights.map((item) => (
              <Card key={item.title} className="shadow-depth-xs">
                <CardHeader className="gap-3 p-5">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <item.icon className="size-5" />
                  </div>
                  <CardTitle className="text-lg leading-snug">{item.title}</CardTitle>
                  <CardDescription className="leading-6">{item.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          <ProductPricing />
        </div>
      </section>

      <section id="interface" className="bg-background px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.72fr_1fr] lg:items-start">
          <div className="max-w-3xl">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquareText className="size-5" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">清晰、可控、面向日常运营的界面</h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              工作台把会话、Agent、知识库、工具和追踪放在同一套结构里。客服可以专注处理问题，管理员可以快速调整能力边界。
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {interfaceCapabilities.map((item) => (
              <Card key={item.title} className="shadow-depth-xs">
                <CardHeader className="gap-3 p-5">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
                  <CardDescription className="leading-6">
                    {item.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="reviews" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <SectionHeading
            eyebrow="用户评价"
            title="来自已登录用户的真实反馈"
            description="登录账号后可以发布自己的使用评价，内容会展示在首页评价模块中。"
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.65fr)]">
            <div className="flex flex-col gap-4">
              {testimonialsLoading ? (
                <Card className="shadow-depth-xs">
                  <CardHeader className="p-5">
                    <CardTitle className="text-base">正在加载评价</CardTitle>
                    <CardDescription>请稍候。</CardDescription>
                  </CardHeader>
                </Card>
              ) : testimonialsError ? (
                <StatusNotice tone="warning">{testimonialsError}</StatusNotice>
              ) : visibleTestimonials.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                      已展示 {visibleTestimonials.length} 条，共 {testimonials.length} 条评价
                    </div>
                    {testimonials.length > 6 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowAllTestimonials((value) => !value)}
                      >
                        {showAllTestimonials ? "收起评价" : "查看全部评价"}
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {visibleTestimonials.map((item) => (
                      <TestimonialCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : (
                <Card className="shadow-depth-xs">
                  <CardHeader className="p-5">
                    <CardTitle className="text-base">暂无评价</CardTitle>
                    <CardDescription>登录后发布第一条真实评价。</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
            <TestimonialComposer onPublished={handlePublishedTestimonial} />
          </div>
        </div>
      </section>

      <section id="faq" className="bg-background-tint px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-10">
          <SectionHeading
            eyebrow="常见问题"
            title="上线前你可能关心的问题"
            description="以下内容覆盖适用场景、资料接入、部署形态和语音能力。"
          />
          <div className="grid gap-4">
            {faqs.map((item) => (
              <Card key={item.question} className="shadow-depth-xs">
                <CardHeader className="flex-row items-start gap-4 p-5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <CircleHelp className="size-4" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <CardTitle className="text-base leading-snug">{item.question}</CardTitle>
                    <CardDescription className="leading-6">{item.answer}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-card px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src={logoImage} alt="威思瑞 WSIRI" width={88} height={56} className="h-8 w-auto" />
            <span>{SITE_NAME}</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/login" className="hover:text-foreground">登录</Link>
            <Link href="/dashboard" className="hover:text-foreground">工作台</Link>
            <a href="#faq" className="hover:text-foreground">常见问题</a>
            <a
              href={ICP_RECORD.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              {ICP_RECORD.number}
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
