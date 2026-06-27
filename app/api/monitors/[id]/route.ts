import { NextRequest, NextResponse } from "next/server";
import { initDb, getMonitorConfigById, updateMonitorConfig, deleteMonitorConfig } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/monitors/[id] - 获取单个监控配置
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const config = getMonitorConfigById(Number(id));
  if (!config) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  return NextResponse.json(config);
}

/**
 * PUT /api/monitors/[id] - 更新监控配置
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();

  const config = updateMonitorConfig(Number(id), {
    ...body,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : undefined,
  });

  if (!config) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  return NextResponse.json(config);
}

/**
 * DELETE /api/monitors/[id] - 删除监控配置
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const success = deleteMonitorConfig(Number(id));

  if (!success) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
