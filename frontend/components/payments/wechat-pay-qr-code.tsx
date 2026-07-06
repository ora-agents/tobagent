"use client"

import { useEffect, useState } from "react"
import QRCode from "qrcode"

interface WechatPayQrCodeProps {
  value: string
}

export function WechatPayQrCode({ value }: WechatPayQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    setDataUrl(null)
    QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 220,
      color: {
        dark: "#020817",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [value])

  return (
    <div className="flex size-[220px] items-center justify-center rounded-md border border-border bg-background p-2">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt="WeChat Pay QR code"
          className="size-full"
        />
      ) : (
        <div className="text-xs text-muted-foreground">二维码生成中...</div>
      )}
    </div>
  )
}
