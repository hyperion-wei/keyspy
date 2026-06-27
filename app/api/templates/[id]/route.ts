import { NextRequest, NextResponse } from "next/server";
import { initDb, getTemplateById, updateTemplate, deleteTemplate } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/templates/[id]
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const tpl = getTemplateById(Number(id));
  if (!tpl) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }
  return NextResponse.json(tpl);
}

/**
 * PUT /api/templates/[id]
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const templateId = Number(id);
  const existing = getTemplateById(templateId);
  if (!existing) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }

  const body = await request.json();
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.type === "string") patch.type = body.type;
  if (typeof body.base_url === "string") patch.base_url = body.base_url.trim();
  if (typeof body.description === "string") patch.description = body.description;

  if (Array.isArray(body.models)) {
    const models = Array.from(new Set(body.models.map((m: unknown) => String(m).trim()).filter(Boolean))) as string[];
    if (models.length === 0) {
      return NextResponse.json({ error: "模型列表不能为空" }, { status: 400 });
    }
    patch.models = models;
  }

  if (typeof body.default_model === "string") {
    patch.default_model = body.default_model.trim();
  }

  // 默认模型必须在模型列表中
  const finalModels = (patch.models as string[] | undefined) ?? existing.models;
  const finalDefault = (patch.default_model as string | undefined) ?? existing.default_model;
  if (!finalModels.includes(finalDefault)) {
    return NextResponse.json({ error: "默认模型必须在模型列表中" }, { status: 400 });
  }

  try {
    const updated = updateTemplate(templateId, patch);
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "更新失败";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "模板名称已存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/templates/[id]
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const result = deleteTemplate(Number(id));
  if (!result.ok) {
    return NextResponse.json({ error: result.reason || "删除失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}