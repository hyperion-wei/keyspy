import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllChatSettings, createChatSetting } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/chat-settings - 获取所有聊天配置
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const settings = getAllChatSettings();
  // 隐藏 API Key 明文
  const safeSettings = settings.map((s) => ({
    ...s,
    api_key: s.api_key.slice(0, 8) + "••••••" + s.api_key.slice(-4),
  }));
  return NextResponse.json(safeSettings);
}

/**
 * POST /api/chat-settings - 创建聊天配置
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { name, provider, api_key, base_url, model, enabled } = body;

  if (!name || !provider || !api_key || !base_url || !model) {
    return NextResponse.json(
      { error: "名称、提供商、API Key、Base URL、模型不能为空" },
      { status: 400 }
    );
  }

  try {
    const setting = createChatSetting({
      name,
      provider,
      api_key,
      base_url,
      model,
      enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
    });
    return NextResponse.json(setting, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "创建失败" },
      { status: 500 }
    );
  }
}
