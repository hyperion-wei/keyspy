import { NextRequest, NextResponse } from "next/server";
import { initDb, getMonitorConfigById, updateMonitorConfig } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { fetchModelList } from "@/lib/model-list";
import { MAX_FALLBACK_MODELS } from "@/lib/checker";

initDb();

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/monitors/[id]/sync-models - 重新拉取监控项的全量模型列表
 *
 * 拉取成功后：
 * 1. 更新 all_models 与 models_synced_at
 * 2. 若首选模型在列表中，重建降级链（其余模型按接口顺序，截断到上限）
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { id } = await context.params;
  const config = getMonitorConfigById(Number(id));
  if (!config) {
    return NextResponse.json({ error: "配置不存在" }, { status: 404 });
  }

  const result = await fetchModelList(config.type, config.base_url, config.api_key);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "获取模型列表失败" },
      { status: 502 }
    );
  }

  const updates: Parameters<typeof updateMonitorConfig>[1] = {
    all_models: JSON.stringify(result.models),
  };

  // 首选模型在全量列表中时，重建降级链；否则保留原降级链
  if (result.models.includes(config.model)) {
    const fallbacks = result.models
      .filter((m) => m !== config.model)
      .slice(0, MAX_FALLBACK_MODELS);
    updates.fallback_models = JSON.stringify(fallbacks);
  }

  const updated = updateMonitorConfig(config.id, updates);
  return NextResponse.json({ ok: true, models: result.models, config: updated });
}
