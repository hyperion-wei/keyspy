import type {Metadata} from "next";
import {Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import NextTopLoader from "nextjs-toploader";
import {ThemeProvider} from "@/components/theme-provider";
import {NotificationBanner} from "@/components/notification-banner";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://keyspy.app";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "KeySpy - AI API Key 泄露检测与可用性监控",
    template: "%s | KeySpy",
  },
  description:
    "KeySpy 是开源的 AI API Key 泄露检测平台，实时扫描 OpenAI / Anthropic / Gemini / 通义千问等大模型 API Key 泄露，提供一键测试、可用性监控与告警。",
  keywords: [
    "API Key 泄露检测",
    "AI 安全",
    "OpenAI API Key",
    "Anthropic API Key",
    "Gemini API Key",
    "密钥扫描",
    "敏感信息检测",
    "API 监控",
    "KeySpy",
  ],
  authors: [{ name: "KeySpy" }],
  creator: "KeySpy",
  publisher: "KeySpy",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    siteName: "KeySpy",
    title: "KeySpy - AI API Key 泄露检测与可用性监控",
    description:
      "开源 AI API Key 泄露检测平台，实时扫描 OpenAI / Anthropic / Gemini 等大模型密钥泄露，支持可用性监控与告警。",
    images: [{ url: "/favicon.png", width: 512, height: 512, alt: "KeySpy" }],
  },
  twitter: {
    card: "summary",
    title: "KeySpy - AI API Key 泄露检测与可用性监控",
    description: "开源 AI API Key 泄露检测平台，实时扫描检测密钥泄露，支持可用性监控。",
    images: ["/favicon.png"],
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  alternates: {
    canonical: baseUrl,
  },
};

const themeBootScript = `(()=>{
  const hour = new Date().getHours();
  const isDark = hour >= 19 || hour < 7;
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={cn("font-mono", jetbrainsMono.variable)}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "KeySpy",
              applicationCategory: "SecurityApplication",
              operatingSystem: "Web",
              description:
                "开源 AI API Key 泄露检测平台，支持 OpenAI、Anthropic、Gemini、通义千问等大模型密钥扫描、可用性监控与告警。",
              url: baseUrl,
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              featureList: [
                "API Key 泄露扫描",
                "Hunt 全网敏感信息发现",
                "API 可用性监控",
                "多模型批量测试",
                "告警通知",
              ],
            }),
          }}
        />
        <script
          id="theme-boot"
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextTopLoader color="var(--foreground)" showSpinner={false} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NotificationBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
