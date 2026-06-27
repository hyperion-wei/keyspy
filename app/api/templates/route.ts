import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllTemplates, createTemplate } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/templates - 获取所有模板
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  return NextResponse.json(getAllTemplates());
}

/**
 * POST /api/templates - 创建模板
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { name, type, base_url, models, default_model, description } = body;

  if (!name || !base_url || !Array.isArray(models) || models.length === 0 || !default_model) {
    return NextResponse.json(
      { error: "名称、Base URL、模型列表、默认模型为必填项" },
      { status: 400 }
    );
  }

  if (!models.includes(default_model)) {
    return NextResponse.json(
      { error: "默认模型必须在模型列表中" },
      { status: 400 }
    );
  }

  // 清洗：去重 + 去空
  const cleanModels = Array.from(new Set(models.map((m: unknown) => String(m).trim()).filter(Boolean))) as string[];

  try {
    const tpl = createTemplate({
      name: String(name).trim(),
      type: type || "openai",
      base_url: String(base_url).trim(),
      models: cleanModels,
      default_model: String(default_model).trim(),
      description: description ? String(description) : "",
    });
    return NextResponse.json(tpl, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "创建失败";
    if (msg.includes("UNIQUE")) {
      return NextResponse.json({ error: "模板名称已存在" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}