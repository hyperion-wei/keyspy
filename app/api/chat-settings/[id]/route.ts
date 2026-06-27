import { NextRequest, NextResponse } from "next/server";
import { initDb, getChatSettingById, updateChatSetting, deleteChatSetting } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/chat-settings/[id] - 获取单个聊天配置
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const setting = getChatSettingById(Number(id));
  if (!setting) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  // 隐藏 API Key 明文
  return NextResponse.json({
    ...setting,
    api_key: setting.api_key.slice(0, 8) + "••••••" + setting.api_key.slice(-4),
  });
}

/**
 * PUT /api/chat-settings/[id] - 更新聊天配置
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();

  const setting = updateChatSetting(Number(id), {
    ...body,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : undefined,
  });

  if (!setting) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  return NextResponse.json(setting);
}

/**
 * DELETE /api/chat-settings/[id] - 删除聊天配置
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const success = deleteChatSetting(Number(id));

  if (!success) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
