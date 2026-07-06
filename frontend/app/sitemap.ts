import type { MetadataRoute } from "next"

import { SITE_URL } from "@/lib/constants/site"

export const dynamic = "force-static"

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-07-06")

  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/agentapp`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ]
}
