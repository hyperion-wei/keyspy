import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录",
  description:
    "登录 KeySpy 平台，开始检测 AI API Key 泄露、监控 API 可用性。",
  robots: {
    index: true,
    follow: false,
  },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
