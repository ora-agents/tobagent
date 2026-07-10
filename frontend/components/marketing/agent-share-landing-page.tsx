"use client"

import Image from "next/image"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleHelp,
  MessageSquareText,
  ShieldCheck,
  Star,
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
import { MarkdownContent } from "@/components/ui/markdown-content"
import { StatusNotice } from "@/components/ui/status-notice"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/components/providers/auth-provider"
import { backendFetch } from "@/lib/api/backend-fetch"
import { ICP_RECORD, SITE_NAME } from "@/lib/constants/site"
import { useApiConfig } from "@/lib/config/api-config"
import type { AgentSharePreview } from "@/lib/types/agent-profiles"
import { cn } from "@/lib/utils"
import logoImage from "@/public/assets/images/logo.png"

interface ShareTestimonial {
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

function formatCny(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
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

function ShareTestimonialCard({ item }: { item: ShareTestimonial }) {
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

function ShareTestimonialComposer({
  shareToken,
  onPublished,
}: {
  shareToken: string
  onPublished: (testimonial: ShareTestimonial) => void
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
      const resp = await backendFetch(`/api/agent-shares/${encodeURIComponent(shareToken)}/testimonials`, {
        method: "POST",
        json: { role, company, rating, quote },
      })
      if (!resp.ok) {
        throw new Error("评价发布失败，请稍后再试。")
      }
      const testimonial = await resp.json()
      onPublished(testimonial)
      setMessage("评价已发布。")
      setQuote("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "评价发布失败，请稍后再试。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="shadow-depth-xs">
      <CardHeader className="gap-2 p-5">
        <CardTitle className="text-base">评价这个 Agent</CardTitle>
        <CardDescription>
          {authLoading
            ? "正在检查登录状态。"
            : user
              ? "你的评价会展示在这个分享页，不会影响其他 Agent。"
              : "登录后可以发布针对这个 Agent 的评价。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        {user ? (
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="身份" id="share-testimonial-role">
                <Input
                  id="share-testimonial-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="客服主管"
                  maxLength={80}
                />
              </FormField>
              <FormField label="公司" id="share-testimonial-company">
                <Input
                  id="share-testimonial-company"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="企业或团队"
                  maxLength={80}
                />
              </FormField>
            </div>
            <FormField label="评分" id="share-testimonial-rating">
              <TestimonialStars value={rating} onChange={setRating} disabled={submitting} />
            </FormField>
            <FormField label="评价内容" id="share-testimonial-quote">
              <Textarea
                id="share-testimonial-quote"
                value={quote}
                onChange={(event) => setQuote(event.target.value)}
                placeholder="写下这个 Agent 在业务场景中的体验。"
                maxLength={800}
                rows={5}
              />
            </FormField>
            {message ? <StatusNotice tone="success">{message}</StatusNotice> : null}
            {error ? <StatusNotice tone="warning">{error}</StatusNotice> : null}
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "发布中" : "发布评价"}
            </Button>
          </form>
        ) : (
          <Button asChild variant="secondary">
            <Link href="/login">登录后评价</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function AgentShareLandingPage({ token }: { token: string }) {
  const { apiUrl, loading: apiConfigLoading } = useApiConfig()
  const [preview, setPreview] = useState<AgentSharePreview | null>(null)
  const [testimonials, setTestimonials] = useState<ShareTestimonial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const shareHandle = preview?.customSlug || token
  const agentAppHref = `/agentapp/?agentShare=${encodeURIComponent(shareHandle)}`
  const visibleTestimonials = useMemo(() => testimonials.slice(0, 6), [testimonials])
  const faqs = preview?.faqItems?.filter((item) => item.question.trim() && item.answer.trim()) || []
  const introText = preview?.introductionText?.trim() || preview?.agent.description || "这个 Agent 已配置为可分享体验，你可以先了解能力范围，再进入单独的 Agent App 使用。"

  const fetchLanding = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [previewResp, testimonialsResp] = await Promise.all([
        backendFetch(`/api/agent-shares/${encodeURIComponent(token)}`, { anonymous: true }),
        backendFetch(`/api/agent-shares/${encodeURIComponent(token)}/testimonials`, { anonymous: true }),
      ])
      if (!previewResp.ok) {
        throw new Error("未找到这个 Agent 分享页。")
      }
      setPreview(await previewResp.json())
      setTestimonials(testimonialsResp.ok ? await testimonialsResp.json() : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "分享页加载失败。")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (apiConfigLoading) return
    void fetchLanding()
  }, [apiConfigLoading, apiUrl, fetchLanding])

  const handlePublishedTestimonial = useCallback((testimonial: ShareTestimonial) => {
    setTestimonials((current) => [
      { ...testimonial, isOwn: true },
      ...current.filter((item) => item.id !== testimonial.id),
    ])
  }, [])

  if (loading || apiConfigLoading) {
    return (
      <main className="flex h-svh items-center justify-center bg-background text-foreground">
        <StatusNotice>正在加载分享页。</StatusNotice>
      </main>
    )
  }

  if (error || !preview) {
    return (
      <main className="flex h-svh items-center justify-center bg-background px-4 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <StatusNotice tone="warning">{error || "分享页不存在。"}</StatusNotice>
          <Button asChild variant="secondary">
            <Link href="/">返回首页</Link>
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="h-svh overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label={SITE_NAME}>
            <Image src={logoImage} alt="威思瑞 WSIRI" width={112} height={72} priority className="h-10 w-auto" />
            <span className="hidden text-sm font-semibold sm:inline">{SITE_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#intro" className="hover:text-foreground">介绍</a>
            <a href="#reviews" className="hover:text-foreground">评价</a>
            <a href="#faq" className="hover:text-foreground">常见问题</a>
          </nav>
          <Button asChild size="sm">
            <Link href={agentAppHref}>
              进入 Agent
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </header>

      <section id="intro" className="bg-background-tint">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-20">
          <div className="flex flex-col gap-7">
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-semibold text-primary shadow-depth-xs">
              <ShieldCheck className="size-4" />
              共享 Agent
            </div>
            <div className="flex flex-col gap-5">
              <h1 className="text-4xl font-semibold leading-tight text-foreground sm:text-5xl lg:text-6xl">
                {preview.agent.name}
              </h1>
              <MarkdownContent
                value={introText}
                className="max-w-2xl text-lg leading-8"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={agentAppHref}>
                  打开单独 Agent App
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="#reviews">查看评价</a>
              </Button>
            </div>
            <div className="grid max-w-xl grid-cols-3 gap-3">
              {[
                preview.isPaid
                  ? preview.pricingMode === "subscription"
                    ? `${formatCny(preview.priceCents)} 起 / ${preview.subscriptionPlans?.length || 0} 个套餐`
                    : formatCny(preview.priceCents)
                  : "免费体验",
                `${Object.values(preview.resources).reduce((total, value) => total + value, 0)} 个资源`,
                preview.agent.model || "默认模型",
              ].map((item) => (
                <div key={item} className="rounded-lg bg-card px-3 py-3 text-center text-sm font-semibold shadow-depth-xs">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <Card className="shadow-depth-xs">
            <CardHeader className="gap-5 p-6">
              <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bot className="size-6" />
              </div>
              <div className="flex flex-col gap-3">
                <CardTitle className="text-2xl leading-tight">开始前可以了解的能力范围</CardTitle>
                <CardDescription className="text-base leading-7">
                  该分享页只展示公开介绍、评价和 FAQ。点击进入后会在单独的 Agent App 中导入或打开对应 Agent。
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 p-6 pt-0 sm:grid-cols-2">
              {[
                ["知识库", preview.resources.knowledgeBases],
                ["Skills", preview.resources.skills],
                ["MCP", preview.resources.mcpServers],
                ["表单", preview.resources.forms],
              ].map(([label, count]) => (
                <div key={label} className="rounded-lg bg-secondary px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="size-4 text-primary" />
                    {label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{count} 个随分享配置</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="reviews" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-10">
          <div className="max-w-3xl">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <MessageSquareText className="size-5" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">这个 Agent 的用户评价</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.65fr)]">
            <div className="flex flex-col gap-4">
              {visibleTestimonials.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {visibleTestimonials.map((item) => (
                    <ShareTestimonialCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <Card className="shadow-depth-xs">
                  <CardHeader className="p-5">
                    <CardTitle className="text-base">暂无评价</CardTitle>
                    <CardDescription>登录后发布第一条针对这个 Agent 的评价。</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
            <ShareTestimonialComposer shareToken={shareHandle} onPublished={handlePublishedTestimonial} />
          </div>
        </div>
      </section>

      <section id="faq" className="bg-background-tint px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-10">
          <div className="max-w-3xl">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CircleHelp className="size-5" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl">常见问题</h2>
            <p className="mt-5 text-base leading-7 text-muted-foreground">
              分享者为这个 Agent 配置的问题说明，帮助你判断是否适合进入体验。
            </p>
          </div>
          <div className="grid gap-4">
            {faqs.length > 0 ? faqs.map((item) => (
              <Card key={item.question} className="shadow-depth-xs">
                <CardHeader className="flex-row items-start gap-4 p-5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <CircleHelp className="size-4" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <CardTitle className="text-base leading-snug">{item.question}</CardTitle>
                    <CardDescription className="whitespace-pre-line leading-6">{item.answer}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            )) : (
              <Card className="shadow-depth-xs">
                <CardHeader className="p-5">
                  <CardTitle className="text-base">分享者暂未配置 FAQ</CardTitle>
                  <CardDescription>你可以直接进入 Agent App 开始体验。</CardDescription>
                </CardHeader>
              </Card>
            )}
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
            <Link href="/" className="hover:text-foreground">首页</Link>
            <Link href={agentAppHref} className="hover:text-foreground">进入 Agent</Link>
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

export function AgentShareLandingPageFromSearch() {
  const searchParams = useSearchParams()
  const token = searchParams.get("agentShare")?.trim() || ""

  if (!token) {
    return (
      <main className="flex h-svh items-center justify-center bg-background px-4 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <StatusNotice tone="warning">缺少 Agent 分享参数。</StatusNotice>
          <Button asChild variant="secondary">
            <Link href="/">返回首页</Link>
          </Button>
        </div>
      </main>
    )
  }

  return <AgentShareLandingPage token={token} />
}
