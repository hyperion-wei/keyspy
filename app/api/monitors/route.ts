import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllMonitorConfigs, createMonitorConfig, getTemplateById } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { testAllModels, ModelTestResult } from "@/lib/test-utils";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/monitors - 获取所有监控配置
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const configs = getAllMonitorConfigs();
  return NextResponse.json(configs);
}

/**
 * POST /api/monitors - 创建监控配置
 *
 * 支持两种模式：
 * 1. 单个：传 name/type/base_url/api_key/model（兼容老接口）
 * 2. 模板批量：传 template_id + api_keys[]，每个 key 先检测可用模型再创建
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();

  // ===== 模板批量模式 =====
  if (body.template_id !== undefined && body.template_id !== null) {
    return handleTemplateBatch(body);
  }

  // ===== 单个模式（向后兼容） =====
  return handleSingle(body);
}

function handleSingle(body: Record<string, unknown>) {
  const { name, type, base_url, api_key, model, group_name, enabled, template_id, fallback_models } = body as {
    name: string;
    type?: string;
    base_url: string;
    api_key: string;
    model: string;
    group_name?: string;
    enabled?: boolean;
    template_id?: number | null;
    fallback_models?: string;
  };

  if (!name || !base_url || !api_key || !model) {
    return NextResponse.json({ error: "名称、Base URL、API Key、模型不能为空" }, { status: 400 });
  }

  const config = createMonitorConfig({
    name,
    type: type || "openai",
    base_url,
    api_key,
    model,
    group_name: group_name || "",
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
    template_id: template_id ?? null,
    fallback_models: fallback_models ?? "[]",
  });

  return NextResponse.json(config, { status: 201 });
}

async function handleTemplateBatch(body: Record<string, unknown>) {
  const { template_id, api_keys, group_name, enabled, name_prefix, fallback_models: fallbackOverride, test_models } = body as {
    template_id: number;
    api_keys: string[];
    group_name?: string;
    enabled?: boolean;
    name_prefix?: string;
    fallback_models?: string[];
    test_models?: boolean;
  };

  if (!template_id || !Array.isArray(api_keys) || api_keys.length === 0) {
    return NextResponse.json({ error: "template_id 和 api_keys[] 必填" }, { status: 400 });
  }

  const tpl = getTemplateById(Number(template_id));
  if (!tpl) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }

  // 清洗 keys：去空 + 去重
  const keys = Array.from(new Set(api_keys.map((k) => String(k).trim()).filter(Boolean)));
  if (keys.length === 0) {
    return NextResponse.json({ error: "API Keys 不能为空" }, { status: 400 });
  }

  const prefix = (name_prefix || tpl.name).trim();
  const shouldTest = test_models !== false; // 默认启用模型测试

  // 构建模板模型列表（去重，default_model 优先）
  const allModels: string[] = [tpl.default_model];
  for (const m of tpl.models) {
    if (m !== tpl.default_model) allModels.push(m);
  }

  // 默认 fallback（不测试时的回退）
  const defaultFallbackList = fallbackOverride && fallbackOverride.length > 0
    ? fallbackOverride
    : tpl.models.filter((m) => m !== tpl.default_model);

  const created: Array<{ id: number; name: string; model: string; fallback_models: string; _tested?: string }> = [];
  const errors: string[] = [];
  const skipped: Array<{ key_suffix: string; reason: string }> = [];

  // 对每个 key 并发处理：测试模型 → 创建配置
  const keyPromises = keys.map(async (apiKey, idx) => {
    const name = keys.length === 1 ? prefix : `${prefix} #${idx + 1}`;
    const keySuffix = apiKey.slice(-6);

    let primaryModel = tpl.default_model;
    let fallbackList: string[] = defaultFallbackList;

    if (shouldTest && allModels.length > 0) {
      // 并发测试所有模型
      const results: ModelTestResult[] = await testAllModels(tpl.type, apiKey, tpl.base_url, allModels);
      const workedModels = results.filter((r) => r.success);

      if (workedModels.length > 0) {
        // 优先选择 default_model，否则用第一个成功的
        const defaultWorked = workedModels.find((r) => r.model === tpl.default_model);
        primaryModel = defaultWorked ? defaultWorked.model : workedModels[0].model;
        fallbackList = workedModels
          .filter((r) => r.model !== primaryModel)
          .map((r) => r.model);
      } else {
        // 所有模型都失败，跳过此 key
        skipped.push({ key_suffix: keySuffix, reason: "所有模型均不可用" });
        return;
      }
    }

    try {
      const config = createMonitorConfig({
        name,
        type: tpl.type,
        base_url: tpl.base_url,
        api_key: apiKey,
        model: primaryModel,
        group_name: group_name || "",
        enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
        template_id: tpl.id,
        fallback_models: JSON.stringify(fallbackList),
      });
      created.push({
        id: config.id,
        name: config.name,
        model: config.model,
        fallback_models: config.fallback_models,
        _tested: shouldTest ? `测试 ${allModels.length} 个模型，${fallbackList.length + 1} 个可用` : undefined,
      });
    } catch (err) {
      errors.push(`Key ...${keySuffix}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await Promise.all(keyPromises);

  return NextResponse.json(
    { created, errors, skipped, total: created.length },
    { status: 201 }
  );
}
