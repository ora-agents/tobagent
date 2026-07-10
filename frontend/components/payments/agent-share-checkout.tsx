"use client"

import { Check, CreditCard, LockKeyhole, QrCode } from "lucide-react"

import { WechatPayQrCode } from "@/components/payments/wechat-pay-qr-code"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StatusNotice } from "@/components/ui/status-notice"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  AgentSharePreview,
  AgentSharePurchase,
  AgentShareSubscriptionPlan,
} from "@/lib/types/agent-profiles"

export type PurchaseStatus = "idle" | "creating" | "confirmed" | "paying" | "waiting" | "paid" | "error"

interface AgentShareCheckoutProps {
  share: AgentSharePreview
  selectedPlan: AgentShareSubscriptionPlan | null
  selectedPlanId: string | null
  order: AgentSharePurchase | null
  status: PurchaseStatus
  isTrialActive: boolean
  trialRemainingMs: number | null
  onSelectPlan: (planId: string) => void
  onConfirmOrder: () => void
  onChangePlan: () => void
  onPay: () => void
  onEnterAgent: () => void
  onReturnToTrial: () => void
}

function formatCny(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
}

function formatTrialDuration(minutes: number) {
  if (minutes <= 0) return ""
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

export function formatTrialRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  if (minutes > 0) return `${minutes} 分钟 ${seconds} 秒`
  return `${seconds} 秒`
}

function formatPlanDuration(days: number) {
  if (days % 365 === 0) return `${days / 365} 年`
  if (days % 30 === 0) return `${days / 30} 个月`
  return `${days} 天`
}

export function AgentShareCheckout({
  share,
  selectedPlan,
  selectedPlanId,
  order,
  status,
  isTrialActive,
  trialRemainingMs,
  onSelectPlan,
  onConfirmOrder,
  onChangePlan,
  onPay,
  onEnterAgent,
  onReturnToTrial,
}: AgentShareCheckoutProps) {
  const selectedPrice = selectedPlan?.priceCents ?? share.priceCents
  const isLocalDirect = order?.paymentProvider === "local_dev_direct"
  const paymentUnavailable = Boolean(order && !isLocalDirect && !order.paymentConfigured)

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="gap-1 p-5 sm:p-6">
        <CardTitle className="text-xl leading-snug tracking-normal">{share.agent.name}</CardTitle>
        <CardDescription>
          {order ? "订单已确认，请核对后完成支付" : "选择访问方案并确认订单"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
        {(share.introductionText?.trim() || share.agent.description) && !order ? (
          <ScrollArea className="max-h-40 rounded-lg bg-muted/40" contentClassName="p-3">
            <MarkdownContent
              value={share.introductionText?.trim() || share.agent.description || ""}
              compact
            />
          </ScrollArea>
        ) : null}

        {!order ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">
                  {share.pricingMode === "subscription" ? "订阅套餐" : "一次性买断"}
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">{formatCny(selectedPrice)}</div>
              </div>
              {share.pricingMode === "one_time" ? (
                <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                  <Check aria-hidden="true" />
                  永久访问
                </div>
              ) : null}
            </div>

            {share.pricingMode === "subscription" && share.subscriptionPlans?.length ? (
              <ToggleGroup
                type="single"
                value={selectedPlan?.id || selectedPlanId || ""}
                onValueChange={(value) => value && onSelectPlan(value)}
                orientation="vertical"
                spacing={2}
                className="w-full flex-col items-stretch"
                aria-label="选择订阅套餐"
              >
                {share.subscriptionPlans.map((plan) => (
                  <ToggleGroupItem
                    key={plan.id}
                    value={plan.id || ""}
                    className="h-auto w-full justify-between px-3 py-3 text-left whitespace-normal"
                    aria-label={`${plan.label}，${formatCny(plan.priceCents)}，有效期 ${formatPlanDuration(plan.durationDays)}`}
                  >
                    <span className="flex min-w-0 flex-col items-start gap-0.5">
                      <span className="font-semibold">{plan.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        有效期 {formatPlanDuration(plan.durationDays)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold">{formatCny(plan.priceCents)}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}

            {share.trialDurationMinutes > 0 ? (
              <div className="text-xs text-muted-foreground">
                {isTrialActive && trialRemainingMs !== null
                  ? `当前仍可试用 ${formatTrialRemaining(trialRemainingMs)}，购买后按所选方案继续使用。`
                  : `试用 ${formatTrialDuration(share.trialDurationMinutes)} 已结束或不可用。`}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-muted/55 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">购买方案</span>
                <span className="font-semibold text-foreground">
                  {order.pricingMode === "subscription" ? selectedPlan?.label || "订阅访问" : "一次性买断"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">应付金额</span>
                <span className="text-lg font-semibold text-foreground">{formatCny(order.amountCents)}</span>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-xs">
                <span className="shrink-0 text-muted-foreground">订单号</span>
                <span className="break-all text-right font-mono text-foreground">{order.outTradeNo}</span>
              </div>
            </div>

            {order.codeUrl ? (
              <div className="flex flex-col items-center gap-3">
                <WechatPayQrCode value={order.codeUrl} />
                <StatusNotice className="w-full" compact wrap>
                  请使用微信扫码支付，支付成功后将自动进入 Agent。
                </StatusNotice>
              </div>
            ) : status === "paid" && isLocalDirect ? (
              <StatusNotice tone="success" wrap>本地开发支付已完成，访问权限已生效。</StatusNotice>
            ) : paymentUnavailable ? (
              <StatusNotice tone="warning" wrap>微信支付当前不可用，订单已保留，请稍后再试。</StatusNotice>
            ) : (
              <StatusNotice icon={LockKeyhole} compact wrap>
                付款码只会在你点击支付后生成。
              </StatusNotice>
            )}
          </div>
        )}

        {status === "error" ? (
          <StatusNotice tone="error">操作失败，请稍后重试。</StatusNotice>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-col gap-2 px-5 pb-5 sm:px-6 sm:pb-6">
        {!order ? (
          <Button
            type="button"
            onClick={onConfirmOrder}
            disabled={status === "creating"}
            className="w-full"
          >
            <CreditCard data-icon="inline-start" />
            {status === "creating" ? "创建订单中..." : "确认方案并创建订单"}
          </Button>
        ) : status === "paid" && isLocalDirect ? (
          <Button type="button" onClick={onEnterAgent} className="w-full">
            进入 Agent
          </Button>
        ) : order.codeUrl ? null : (
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" onClick={onChangePlan} disabled={status === "paying"}>
              重新选择
            </Button>
            <Button
              type="button"
              onClick={onPay}
              disabled={status === "paying" || paymentUnavailable}
              className="min-w-0 flex-1"
            >
              <QrCode data-icon="inline-start" />
              {status === "paying" ? "正在发起支付..." : isLocalDirect ? "本地开发支付" : "微信支付"}
            </Button>
          </div>
        )}

        {isTrialActive ? (
          <Button type="button" variant="outline" onClick={onReturnToTrial} className="w-full">
            返回试用
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
