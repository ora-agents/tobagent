"use client"

import Image from "next/image"
import Link from "next/link"

import { useAuth } from "@/components/providers/auth-provider"
import { ICP_RECORD, SITE_NAME } from "@/lib/constants/site"
import { cn } from "@/lib/utils"
import logoImage from "@/public/assets/images/logo.png"
import tiktokImage from "@/public/assets/images/social_tiktok.png"
import wechatImage from "@/public/assets/images/social_wechat.png"
import wechatOfficialAccountImage from "@/public/assets/images/social_wechat_officialaccount.png"

const socialContacts = [
  { label: "微信客服", image: wechatImage },
  { label: "抖音号", image: tiktokImage },
  { label: "公众号", image: wechatOfficialAccountImage },
]

interface PlatformFooterProps {
  className?: string
}

export function PlatformFooter({ className }: PlatformFooterProps) {
  const { user, loading: authLoading } = useAuth()
  const accountButtonLabel = user?.username || "登录"

  return (
    <footer id="contact" className={cn("border-t border-border/60 px-4 py-10 sm:px-6 lg:px-8", className)}>
      <div className="mx-auto max-w-7xl text-sm text-muted-foreground">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_0.7fr_1.5fr] lg:items-start">
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <Image src={logoImage} alt="威思瑞 WSIRI" width={88} height={56} className="h-11 w-auto shrink-0 sm:h-12" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-semibold leading-6 text-foreground">{SITE_NAME}</p>
                <p className="text-sm leading-5 text-muted-foreground">苏州威思瑞智能技术有限公司</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href={user ? "/dashboard" : "/login"} className="max-w-48 truncate hover:text-foreground">
                {authLoading ? "..." : accountButtonLabel}
              </Link>
              <Link href="/dashboard" className="hover:text-foreground">工作台</Link>
              <Link href="/#faq" className="hover:text-foreground">常见问题</Link>
              <a href={ICP_RECORD.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                {ICP_RECORD.number}
              </a>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="flex flex-col gap-1"><span className="text-xs">电话</span><a href="tel:+8618501507342" className="font-medium text-foreground hover:text-primary-text">+86 18501507342</a></div>
            <div className="flex flex-col gap-1"><span className="text-xs">官网</span><a href="http://www.wsiri.cn/" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:text-primary-text">http://www.wsiri.cn/</a></div>
            <div className="flex flex-col gap-1 sm:col-span-2"><span className="text-xs">邮箱</span><a href="mailto:18501507342@163.com" className="w-fit font-medium text-foreground hover:text-primary-text">18501507342@163.com</a></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {socialContacts.map((contact) => (
              <figure key={contact.label} className="flex min-w-0 flex-col items-center gap-2">
                <Image src={contact.image} alt={`${contact.label}二维码`} className="size-20 object-contain sm:size-28" sizes="(min-width: 640px) 112px, 80px" />
                <figcaption className="text-center text-xs text-foreground">{contact.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
