"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardBootstrap } from "@/components/dashboard-bootstrap";
import { ClientYear } from "@/components/client-time";
import { AuthGuard } from "@/components/auth-guard";
import { Settings, LogOut, Crosshair, MessageSquare } from "lucide-react";
import packageJson from "@/package.json";

const ESTIMATED_VERSION = `v${packageJson.version}`;

export default function Home() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

function HomeContent() {
  const router = useRouter();
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => d.user && setUsername(d.user.username))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="py-8 md:py-16">
      {/* Top bar */}
      <div className="mx-auto mb-6 flex w-full max-w-[1600px] items-center justify-end gap-3 px-3 sm:px-6 lg:px-12">
        {username && (
          <span className="text-sm text-muted-foreground">{username}</span>
        )}
        <Link
          href="/hunt"
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Hunt
        </Link>
        <Link
          href="/manage/llm"
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          LLM
        </Link>
        <Link
          href="/manage"
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          管理
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          退出
        </button>
      </div>

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:gap-8 sm:px-6 lg:px-12">
        <DashboardBootstrap />
      </main>
      
      <footer className="mt-16 border-t border-border/40">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-4 px-3 py-6 sm:flex-row sm:px-6 lg:px-12">
          <div className="text-sm text-muted-foreground">
            © <ClientYear placeholder="2026" /> KeySpy. All rights reserved.
          </div>

          <div className="flex items-center gap-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-background/60 px-3 py-1 text-xs text-muted-foreground shadow-sm transition hover:border-border/80 hover:text-foreground">
              <span className="font-medium opacity-70">Ver.</span>
              <span className="font-mono">{ESTIMATED_VERSION}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
