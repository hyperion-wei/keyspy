import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllMonitorConfigs, createMonitorConfig, getTemplateById } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

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
 * 2. 模板批量：传 template_id + api_keys[]，每个 key 自动生成一个监控配置
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

function handleTemplateBatch(body: Record<string, unknown>) {
  const { template_id, api_keys, group_name, enabled, name_prefix, fallback_models: fallbackOverride } = body as {
    template_id: number;
    api_keys: string[];
    group_name?: string;
    enabled?: boolean;
    name_prefix?: string;
    fallback_models?: string[];
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
  // fallback_models: 从模板的 models 中去掉 default_model
  const fallbackList = fallbackOverride && fallbackOverride.length > 0
    ? fallbackOverride
    : tpl.models.filter((m) => m !== tpl.default_model);

  const created: unknown[] = [];
  const errors: string[] = [];

  keys.forEach((apiKey, idx) => {
    try {
      const name = keys.length === 1 ? prefix : `${prefix} #${idx + 1}`;
      const config = createMonitorConfig({
        name,
        type: tpl.type,
        base_url: tpl.base_url,
        api_key: apiKey,
        model: tpl.default_model,
        group_name: group_name || "",
        enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
        template_id: tpl.id,
        fallback_models: JSON.stringify(fallbackList),
      });
      created.push(config);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  });

  return NextResponse.json(
    { created, errors, total: created.length },
    { status: 201 }
  );
}
