import { NextResponse } from "next/server";
import { initDb, getPollIntervalSeconds, setSetting, formatPollInterval } from "@/lib/db";

initDb();

export const revalidate = 0;
export const dynamic = "force-dynamic";

// GET: 获取当前探测频率设置
export async function GET() {
  const seconds = getPollIntervalSeconds();
  return NextResponse.json({
    pollIntervalSeconds: seconds,
    pollIntervalLabel: formatPollInterval(seconds),
  });
}

// PUT: 更新探测频率
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { pollIntervalSeconds } = body;

    if (typeof pollIntervalSeconds !== "number" || pollIntervalSeconds < 10 || pollIntervalSeconds > 43200) {
      return NextResponse.json(
        { error: "探测频率须在 10 秒到 12 小时之间" },
        { status: 400 }
      );
    }

    setSetting("poll_interval_seconds", String(pollIntervalSeconds));

    return NextResponse.json({
      pollIntervalSeconds,
      pollIntervalLabel: formatPollInterval(pollIntervalSeconds),
    });
  } catch {
    return NextResponse.json({ error: "无效的请求" }, { status: 400 });
  }
}
