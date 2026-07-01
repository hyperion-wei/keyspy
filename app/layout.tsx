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

export const metadata: Metadata = {
  title: "KeySpy - AI API Key 泄露检测与可用性监控",
  description: "实时扫描检测 OpenAI / Gemini / Anthropic 等 API Key 泄露，一键测试与监控管理",
  icons: {
    icon: "/favicon.png",
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
