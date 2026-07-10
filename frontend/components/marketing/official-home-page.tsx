"use client"

import Image from "next/image"
import Link from "next/link"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  Headphones,
  MessageSquareText,
  Mic2,
  ShieldCheck,
  Sparkles,
  Star,
  Workflow,
} from "lucide-react"

import { useAuth } from "@/components/providers/auth-provider"
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
import { useApiConfig } from "@/lib/config/api-config"
import { ICP_RECORD, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/constants/site"
import { cn } from "@/lib/utils"
import logoImage from "@/public/logo.png"

const salesHelperAgentHref = `${SITE_URL}/agentapp/?agentShare=wsiri-sales-helper`

const capabilities = [
  {
    number: "01",
    icon: Database,
    title: "让企业知识真正可用",
    description: "集中沉淀产品文档、FAQ 与服务流程，为每次回复提供一致、可追溯的依据。",
    detail: "知识入库 · 语义检索 · 引用追踪",
  },
  {
    number: "02",
    icon: Workflow,
    title: "把工具接入服务流程",
    description: "按业务场景编排查询、表单、外部系统与人工接管，让 Agent 不只回答问题。",
    detail: "工具调用 · 流程编排 · 权限控制",
  },
  {
    number: "03",
    icon: Mic2,
    title: "覆盖自然的语音交互",
    description: "统一唤醒、听写、播报与中断链路，为桌面和移动场景提供连贯体验。",
    detail: "语音唤醒 · 实时听写 · 自然播报",
  },
]

const pricingPlans = [
  { duration: "3 个月", price: "1,200", note: "适合短期验证" },
  { duration: "6 个月", price: "2,200", note: "适合阶段部署" },
  { duration: "12 个月", price: "4,000", note: "适合长期使用" },
]

const pricingFeatures = [
  "7 天完整试用",
  "不限坐席和渠道数量",
  "支持主流大模型与企业知识库",
  "报修、报警、工单和救援流程联动",
]

const faqs = [
  {
    question: "适合哪些企业场景？",
    answer: "适合客服问答、售后支持、内部知识助手、业务流程咨询和多 Agent 管理等场景。",
  },
  {
    question: "可以接入企业已有资料吗？",
    answer: "可以围绕企业文档、知识库、表单和工具接口构建专属 Agent，具体接入方式按部署环境配置。",
  },
  {
    question: "网站和桌面端是什么关系？",
    answer: "网站提供浏览器工作台，桌面端复用同一套界面，并针对桌面运行环境提供适配。",
  },
  {
    question: "是否支持语音客服体验？",
    answer: "支持语音输入、TTS 播放、状态同步和中断控制，可与原生端语音能力协同工作。",
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary-text">
      <span className="h-px w-6 bg-primary-text" aria-hidden="true" />
      {children}
    </div>
  )
}

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
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
      <div className="flex flex-col gap-4">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="max-w-2xl text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
          {title}
        </h2>
      </div>
      <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:justify-self-end">
        {description}
      </p>
    </div>
  )
}

function ProductPreview() {
  const stats = [
    { label: "知识覆盖", value: "96.8%" },
    { label: "平均响应", value: "1.2s" },
    { label: "今日会话", value: "248" },
  ]

  return (
    <div className="overflow-hidden rounded-2xl bg-background-tint text-foreground">
      <div>
        <div className="flex items-center justify-between px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="size-2 rounded-full bg-error" />
            <span className="size-2 rounded-full bg-warning" />
            <span className="size-2 rounded-full bg-accent-cyan" />
          </div>
          <div className="text-xs font-medium text-muted-foreground">WSIRI · 运行中</div>
        </div>

        <div className="grid min-h-[27rem] lg:grid-cols-[11rem_1fr]">
          <aside className="hidden flex-col gap-2 rounded-l-xl bg-secondary p-4 lg:flex">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
              <Bot className="size-4 text-primary-text" />
              服务工作台
            </div>
            {["对话中心", "知识管理", "工具编排", "运行追踪"].map((item, index) => (
              <div
                key={item}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-medium",
                  index === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {item}
              </div>
            ))}
            <div className="mt-auto rounded-lg bg-card p-3 text-xs leading-5 text-muted-foreground">
              8 个 Agent 在线
              <br />
              所有服务运行正常
            </div>
          </aside>

          <div className="flex min-w-0 flex-col p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">企业客服中枢</div>
                <div className="mt-1 text-xs text-muted-foreground">售前接待 Agent</div>
              </div>
              <div className="rounded-md bg-card px-2.5 py-1 text-xs text-muted-foreground">生产环境</div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
              {stats.map((item) => (
                <div key={item.label} className="rounded-lg bg-card p-3">
                  <div className="text-[11px] text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-lg font-semibold sm:text-xl">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-1 flex-col justify-end gap-3">
              <div className="max-w-[88%] rounded-lg bg-card p-3.5">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary-text">
                  <Headphones className="size-4" />
                  客户咨询
                </div>
                <p className="text-sm leading-6">不同产品线可以配置独立的知识和回复策略吗？</p>
              </div>
              <div className="ml-auto max-w-[92%] rounded-lg bg-primary p-3.5 text-primary-foreground">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <Sparkles className="size-4" />
                  Agent 回复
                </div>
                <p className="text-sm leading-6">
                  可以。每个 Agent 都能绑定独立知识库、工具权限与服务流程。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroCapabilityMap() {
  const capabilityNodes = [
    {
      icon: Database,
      label: "企业知识",
      detail: "准确检索",
      position: "left-0 top-14 sm:left-6",
    },
    {
      icon: Workflow,
      label: "业务工具",
      detail: "自动执行",
      position: "right-0 top-14 sm:right-6",
    },
    {
      icon: Mic2,
      label: "自然语音",
      detail: "随时响应",
      position: "bottom-14 left-1/2 -translate-x-1/2",
    },
  ]

  return (
    <div className="relative mx-auto min-h-[28rem] w-full max-w-[34rem]" aria-label="知识、工具与语音共同驱动企业智能服务">
      <div className="absolute inset-x-12 top-1/2 h-64 -translate-y-1/2 rounded-full bg-primary-soft/70 blur-3xl" aria-hidden="true" />
      <svg
        className="absolute inset-0 size-full text-primary/25"
        viewBox="0 0 544 448"
        fill="none"
        aria-hidden="true"
      >
        <path d="M126 105C164 126 195 153 230 190" stroke="currentColor" strokeWidth="2" strokeDasharray="5 9" />
        <path d="M418 105C380 126 349 153 314 190" stroke="currentColor" strokeWidth="2" strokeDasharray="5 9" />
        <path d="M272 358V282" stroke="currentColor" strokeWidth="2" strokeDasharray="5 9" />
      </svg>

      {capabilityNodes.map((item) => (
        <div key={item.label} className={cn("absolute flex items-center gap-3", item.position)}>
          <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-primary-text shadow-depth-sm">
            <item.icon className="size-5" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.detail}</span>
          </span>
        </div>
      ))}

      <div className="absolute left-1/2 top-1/2 flex size-48 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full bg-primary text-center text-primary-foreground shadow-depth-md sm:size-52">
        <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary-foreground/10">
          <Sparkles className="size-6" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/75">WSIRI Agent</span>
        <strong className="mt-2 text-xl leading-snug">理解问题<br />完成服务</strong>
      </div>

      <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-card px-4 py-2.5 text-xs font-medium text-muted-foreground shadow-depth-sm">
        <ShieldCheck className="size-4 text-primary-text" />
        知识有据 · 流程可控 · 服务连续
      </div>
    </div>
  )
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
            className="flex size-8 items-center justify-center rounded-md text-primary-text transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
          >
            <Star className={cn("size-4", active && "fill-current")} />
          </button>
        ) : (
          <Star key={star} className={cn("size-4 text-primary-text", active && "fill-current")} />
        )
      })}
    </div>
  )
}

function TestimonialCard({ item }: { item: SiteTestimonial }) {
  const subtitle = [item.role, item.company].filter(Boolean).join(" · ")

  return (
    <Card className="bg-secondary shadow-none">
      <CardHeader className="gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{item.authorName}</CardTitle>
            {subtitle ? <CardDescription className="mt-1 truncate">{subtitle}</CardDescription> : null}
          </div>
          {item.isOwn ? <span className="text-xs font-semibold text-primary-text">我的评价</span> : null}
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
      const response = await backendFetch("/api/site-testimonials", {
        method: "POST",
        json: { role, company, rating, quote },
      })
      if (!response.ok) throw new Error("评价发布失败，请稍后再试。")
      const saved = (await response.json()) as SiteTestimonial
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
      <Card className="bg-secondary shadow-none">
        <CardHeader className="p-6">
          <CardTitle className="text-base">正在检查登录状态</CardTitle>
          <CardDescription>登录后可以发表你的真实评价。</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!user) {
    return (
      <Card className="bg-secondary shadow-none">
        <CardHeader className="gap-4 p-6">
          <CardTitle className="text-lg">分享你的使用体验</CardTitle>
          <CardDescription className="leading-6">
            登录后即可发表真实评价，内容会使用你的账号名称展示。
          </CardDescription>
          <Button asChild className="w-fit">
            <Link href="/login">登录后评价</Link>
          </Button>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="bg-secondary shadow-none">
      <CardHeader className="p-6">
        <CardTitle className="text-lg">发表真实评价</CardTitle>
        <CardDescription>当前账号：{user.username}</CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="你的角色" id="testimonial-role" description="可选">
              <Input
                id="testimonial-role"
                value={role}
                maxLength={80}
                onChange={(event) => setRole(event.target.value)}
                placeholder="客服主管"
              />
            </FormField>
            <FormField label="公司或行业" id="testimonial-company" description="可选">
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
            description="至少 10 个字"
          >
            <Textarea
              id="testimonial-quote"
              value={quote}
              minLength={10}
              maxLength={800}
              rows={4}
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

export function OfficialHomePage() {
  const { apiUrl, loading: apiConfigLoading } = useApiConfig()
  const { user, loading: authLoading } = useAuth()
  const [testimonials, setTestimonials] = useState<SiteTestimonial[]>([])
  const [testimonialsLoading, setTestimonialsLoading] = useState(true)
  const [testimonialsError, setTestimonialsError] = useState<string | null>(null)
  const [showAllTestimonials, setShowAllTestimonials] = useState(false)
  const accountButtonLabel = user?.username ?? "登录"
  const visibleTestimonials = useMemo(
    () => (showAllTestimonials ? testimonials : testimonials.slice(0, 4)),
    [showAllTestimonials, testimonials],
  )

  const fetchTestimonials = useCallback(async () => {
    setTestimonialsLoading(true)
    setTestimonialsError(null)
    try {
      const response = await backendFetch("/api/site-testimonials", { anonymous: true })
      if (!response.ok) throw new Error("暂时无法加载用户评价。")
      setTestimonials((await response.json()) as SiteTestimonial[])
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
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label={SITE_NAME}>
            <Image src={logoImage} alt="威思瑞 WSIRI" width={112} height={72} priority className="h-9 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground lg:flex">
            <a href="#product" className="transition-colors hover:text-foreground">产品能力</a>
            <a href="#interface" className="transition-colors hover:text-foreground">工作台</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">价格</a>
            <a href="#reviews" className="transition-colors hover:text-foreground">用户评价</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="max-w-40">
              <Link href={user ? "/dashboard" : "/login"} title={user?.username ?? "登录"}>
                <span className="truncate">{authLoading ? "..." : accountButtonLabel}</span>
              </Link>
            </Button>
            <Button asChild size="sm">
              <a href={salesHelperAgentHref}>
                进入工作台
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <section>
        <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:px-8 lg:py-20">
          <div className="order-2 lg:order-1">
            <HeroCapabilityMap />
          </div>
          <div className="order-1 flex flex-col gap-7 lg:order-2">
            <Eyebrow>企业客服智能体平台</Eyebrow>
            <div className="flex flex-col gap-5">
              <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] sm:text-6xl xl:text-7xl">
                让每一次服务，
                <br />
                都有知识可依。
              </h1>
              <p className="max-w-xl text-lg leading-8 text-muted-foreground">
                {SITE_DESCRIPTION} 统一管理知识、Agent、工具与语音能力，构建稳定、可控的企业服务中枢。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href={salesHelperAgentHref}>
                  免费试用 7 天
                  <ArrowRight data-icon="inline-end" />
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#interface">查看产品界面</a>
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["无需信用卡", "快速配置", "支持专属部署"].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <Check className="size-4 text-primary-text" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="bg-background-tint px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto flex max-w-7xl flex-col gap-14">
          <SectionHeading
            eyebrow="产品能力"
            title="把分散的服务能力，收拢到一个清晰的平台"
            description="从回答问题到执行任务，每项能力都围绕企业日常服务场景组织，减少重复配置，也让运营过程更容易追踪。"
          />
          <div className="grid gap-3 lg:grid-cols-3">
            {capabilities.map((item) => (
              <article key={item.title} className="flex min-h-72 flex-col rounded-xl bg-card p-6 sm:p-7">
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <item.icon className="size-5" />
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">{item.number}</span>
                </div>
                <div className="mt-auto flex flex-col gap-3 pt-10">
                  <h3 className="text-xl font-semibold">{item.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                  <p className="pt-2 text-xs font-semibold text-primary-text">{item.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="interface" className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow>统一工作台</Eyebrow>
            <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">
              服务进展，
              <br />
              始终清晰可见。
            </h2>
            <p className="max-w-lg text-base leading-7 text-muted-foreground">
              会话、知识命中、工具调用和人工接管都在同一条处理链路中。客服专注解决问题，管理员随时掌握运行状态。
            </p>
            <div className="flex flex-col gap-3 text-sm font-medium">
              {["按业务线管理专属 Agent", "查看知识依据与工具结果", "追踪关键节点与异常状态"].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex size-6 items-center justify-center rounded-md bg-primary-soft text-primary">
                    <Check className="size-3.5" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
            <Button asChild variant="secondary" className="w-fit">
              <Link href="/dashboard">
                了解管理工作台
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="pricing" className="bg-background-tint px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto flex max-w-7xl flex-col gap-12">
          <SectionHeading
            eyebrow="简单定价"
            title="先完整体验，再按周期使用"
            description="无需复杂套餐对比。试用期覆盖核心能力，正式使用仅按部署周期选择。"
          />
          <div className="grid overflow-hidden rounded-2xl bg-card lg:grid-cols-[1.25fr_0.75fr]">
            <div className="grid sm:grid-cols-3">
              {pricingPlans.map((plan, index) => (
                <div
                  key={plan.duration}
                  className={cn("flex flex-col gap-5 p-7", index === 1 && "bg-primary-soft")}
                >
                  <div className="text-sm font-semibold text-foreground">{plan.duration}</div>
                  <div>
                    <span className="text-4xl font-semibold text-foreground">¥{plan.price}</span>
                    <span className="ml-1 text-sm text-muted-foreground">/ 期</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.note}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col justify-between gap-8 bg-secondary p-7 text-foreground">
              <div className="flex flex-col gap-4">
                <div className="text-sm font-semibold">所有方案均包含</div>
                {pricingFeatures.map((feature) => (
                  <div key={feature} className="flex items-start gap-3 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary-text" />
                    {feature}
                  </div>
                ))}
              </div>
              <Button asChild>
                <a href={salesHelperAgentHref}>开始免费试用</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="reviews" className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto flex max-w-7xl flex-col gap-12">
          <SectionHeading
            eyebrow="用户评价"
            title="来自真实用户的反馈"
            description="已登录用户可以分享实际使用感受，帮助更多团队了解产品。"
          />
          <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="flex flex-col gap-4">
              {testimonialsLoading ? (
                <Card className="bg-secondary shadow-none">
                  <CardHeader className="p-6">
                    <CardTitle className="text-base">正在加载评价</CardTitle>
                    <CardDescription>请稍候。</CardDescription>
                  </CardHeader>
                </Card>
              ) : testimonialsError ? (
                <StatusNotice tone="warning">{testimonialsError}</StatusNotice>
              ) : visibleTestimonials.length > 0 ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {visibleTestimonials.map((item) => (
                      <TestimonialCard key={item.id} item={item} />
                    ))}
                  </div>
                  {testimonials.length > 4 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-fit"
                      onClick={() => setShowAllTestimonials((value) => !value)}
                    >
                      {showAllTestimonials ? "收起评价" : `查看全部 ${testimonials.length} 条评价`}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Card className="bg-secondary shadow-none">
                  <CardHeader className="p-6">
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

      <section id="faq" className="bg-background-tint px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.72fr_1.28fr]">
          <div className="flex flex-col gap-5">
            <Eyebrow>常见问题</Eyebrow>
            <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">上线之前，了解更多。</h2>
            <p className="text-base leading-7 text-muted-foreground">
              关于场景、资料接入和产品形态的常见问题。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {faqs.map((item) => (
              <div key={item.question} className="rounded-xl bg-card p-6">
                <div className="flex items-center gap-3">
                  <CircleHelp className="size-5 text-primary-text" />
                  <h3 className="font-semibold">{item.question}</h3>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-2xl bg-primary px-7 py-10 text-primary-foreground sm:px-10 lg:flex-row lg:items-center lg:px-12 lg:py-12">
          <div className="flex max-w-2xl flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" />
              7 天完整试用
            </div>
            <h2 className="text-3xl font-semibold leading-tight sm:text-4xl">从一次真实咨询开始。</h2>
            <p className="text-sm leading-6 text-primary-foreground/80 sm:text-base">
              体验知识驱动的企业客服 Agent，看看它如何理解问题、调用能力并给出可靠回答。
            </p>
          </div>
          <Button asChild variant="secondary" size="lg" className="shrink-0">
            <a href={salesHelperAgentHref}>
              立即体验
              <MessageSquareText data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </section>

      <footer id="contact" className="border-t border-border/60 px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 text-sm text-muted-foreground">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div className="flex items-center gap-4">
              <Image
                src={logoImage}
                alt="威思瑞 WSIRI"
                width={88}
                height={56}
                className="h-11 w-auto shrink-0 sm:h-12"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-semibold leading-6 text-foreground">{SITE_NAME}</p>
                <p className="text-sm leading-5 text-muted-foreground">苏州威思瑞智能技术有限公司</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs">电话</span>
                <a href="tel:+8618501507342" className="font-medium text-foreground hover:text-primary-text">
                  +86 18501507342
                </a>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs">官网</span>
                <a
                  href="http://www.wsiri.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:text-primary-text"
                >
                  http://www.wsiri.cn/
                </a>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs">邮箱</span>
                <a
                  href="mailto:18501507342@163.com"
                  className="w-fit font-medium text-foreground hover:text-primary-text"
                >
                  18501507342@163.com
                </a>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href={user ? "/dashboard" : "/login"} className="max-w-48 truncate hover:text-foreground">
              {authLoading ? "..." : accountButtonLabel}
            </Link>
            <Link href="/dashboard" className="hover:text-foreground">工作台</Link>
            <a href="#faq" className="hover:text-foreground">常见问题</a>
            <a href={ICP_RECORD.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
              {ICP_RECORD.number}
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
