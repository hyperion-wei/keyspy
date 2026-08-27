import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllMcpTokens, createMcpToken, setMcpTokenEnabled, deleteMcpToken } from "@/lib/db";
import { getAuthUser, isAdmin } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/mcp-tokens - 列出所有 MCP Token（仅管理员）
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }
  return NextResponse.json({ tokens: getAllMcpTokens() });
}

/**
 * POST /api/mcp-tokens - 生成新 MCP Token（仅管理员）
 * body: { name?: string }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim()
    ? body.name.trim()
    : `token-${new Date().toISOString().slice(0, 10)}`;

  if (name.length > 50) {
    return NextResponse.json({ error: "名称最长 50 个字符" }, { status: 400 });
  }

  const token = createMcpToken(name, user!.id);
  return NextResponse.json({ success: true, token }, { status: 201 });
}

/**
 * PUT /api/mcp-tokens - 启用/停用 Token（仅管理员）
 * body: { id: number, enabled: boolean }
 */
export async function PUT(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { id, enabled } = await request.json();
  if (typeof id !== "number" || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "缺少 id 或 enabled" }, { status: 400 });
  }

  const token = setMcpTokenEnabled(id, enabled);
  if (!token) {
    return NextResponse.json({ error: "Token 不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true, token });
}

/**
 * DELETE /api/mcp-tokens?id=1 - 删除 Token（仅管理员）
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!id || Number.isNaN(id)) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  if (!deleteMcpToken(id)) {
    return NextResponse.json({ error: "Token 不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
