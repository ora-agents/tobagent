import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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

interface PlatformPricingProps {
  onStartTrial?: () => void
}

export function PlatformPricing({ onStartTrial }: PlatformPricingProps) {
  return (
    <section className="w-full bg-background-tint px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-text">简单定价</div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">先完整体验，再按周期使用</h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              无需复杂套餐对比。试用期覆盖核心能力，正式使用仅按部署周期选择。
            </p>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="grid p-0 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="grid sm:grid-cols-3">
              {pricingPlans.map((plan, index) => (
                <div
                  key={plan.duration}
                  className={cn("flex flex-col gap-5 p-6", index === 1 && "bg-primary-soft")}
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
            <div className="flex flex-col justify-between gap-8 bg-secondary p-6 text-foreground">
              <CardHeader className="gap-4 p-0">
                <CardTitle className="text-sm">所有方案均包含</CardTitle>
                <CardDescription className="flex flex-col gap-3">
                  {pricingFeatures.map((feature) => (
                    <span key={feature} className="flex items-start gap-3 text-sm text-muted-foreground">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary-text" />
                      {feature}
                    </span>
                  ))}
                </CardDescription>
              </CardHeader>
              {onStartTrial ? (
                <Button type="button" onClick={onStartTrial}>开始免费试用</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
