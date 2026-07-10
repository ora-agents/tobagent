import type { Metadata } from "next";
import { Inter, Inconsolata, Cormorant_Garamond } from "next/font/google";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import Script from "next/script";
import "./globals.css";
import { SegmentProvider } from "@/components/providers/segment-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { ImageAssetProtection } from "@/components/providers/image-asset-protection";
import { ApiConfigProvider } from "@/lib/config/api-config";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/constants/site";
import { I18nProvider } from "@/lib/i18n";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const inconsolata = Inconsolata({
  variable: "--font-inconsolata",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "威思瑞",
    "客服智能体",
    "AI 客服",
    "企业知识库",
    "智能客服系统",
    "LangGraph",
  ],
  authors: [{ name: "威思瑞" }],
  creator: "威思瑞",
  publisher: "威思瑞",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/assets/images/logo.png",
        width: 512,
        height: 512,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/assets/images/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: '/assets/images/logo.png', type: 'image/png' },
    ],
    shortcut: '/assets/images/logo.png',
    apple: '/assets/images/logo.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const segmentWriteKey = process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY;

  return (
    <html lang="zh" suppressHydrationWarning>
      <head>
        <Script
          id="tauri-runtime-marker"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
try {
  if (window.__TAURI__ || window.__TAURI_INTERNALS__) {
    document.documentElement.setAttribute("data-tauri-runtime", "true");
  }
} catch (_) {}
            `,
          }}
        />
        {/* Segment Analytics */}
        {segmentWriteKey && (
          <Script
            id="segment-script"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `
!function(){var i="analytics",analytics=window[i]=window[i]||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","screen","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware","register"];analytics.factory=function(e){return function(){if(window[i].initialized)return window[i][e].apply(window[i],arguments);var n=Array.prototype.slice.call(arguments);if(["track","screen","alias","group","page","identify"].indexOf(e)>-1){var c=document.querySelector("link[rel='canonical']");n.push({__t:"bpc",c:c&&c.getAttribute("href")||void 0,p:location.pathname,u:location.href,s:location.search,t:document.title,r:document.referrer})}n.unshift(e);analytics.push(n);return analytics}};for(var n=0;n<analytics.methods.length;n++){var key=analytics.methods[n];analytics[key]=analytics.factory(key)}analytics.load=function(key,n){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.setAttribute("data-global-segment-analytics-key",i);t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r);analytics._loadOptions=n};analytics._writeKey="${segmentWriteKey}";;analytics.SNIPPET_VERSION="5.2.0";
analytics.load("${segmentWriteKey}");
analytics.page();
}}();
              `,
            }}
          />
        )}
      </head>
      <body
        className={`${inter.variable} ${inconsolata.variable} ${cormorant.variable} antialiased`}
      >
        <ImageAssetProtection />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <I18nProvider>
            <ApiConfigProvider>
              <AuthProvider>
                <SegmentProvider>
                  <NuqsAdapter>
                    {children}
                  </NuqsAdapter>
                </SegmentProvider>
              </AuthProvider>
            </ApiConfigProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
