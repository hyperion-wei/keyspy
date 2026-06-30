import { initDb, getAllTemplates } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { testAllModels as sharedTestAllModels, ModelTestResult } from "@/lib/test-utils";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sanitizeHeaderValue(value: string): string {
  let replaced = value
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\uFF02]/g, '"')
    .replace(/[\uFF07]/g, "'");
  replaced = replaced.replace(/^['"]+|['"]+$/g, '');
  replaced = replaced.replace(/[^\x00-\xFF]/g, '');
  const wsIdx = replaced.search(/\s/);
  if (wsIdx > 0) replaced = replaced.slice(0, wsIdx);
  return replaced.trim();
}

/**
 * POST /api/hunt/test-all
 * 用指定 API Key 遍历所有内置模板测试可用性
 *
 * Body: { api_key }
 * Returns: { usable, worked, results: [{template, success, message}] }
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { api_key } = body;

  if (!api_key) {
    return Response.json({ error: "缺少 api_key" }, { status: 400 });
  }

  const cleanKey = sanitizeHeaderValue(String(api_key));
  if (!cleanKey) {
    return Response.json({ error: "API Key 清理后为空" }, { status: 400 });
  }

  const templates = getAllTemplates();
  if (templates.length === 0) {
    return Response.json({ error: "没有可用模板" }, { status: 500 });
  }

  interface TemplateResult {
    template: string;
    templateId: number;
    type: string;
    base_url: string;
    model: string;
    success: boolean;
    message: string;
    latency_ms: number;
  }

  // 并发测试所有模板，每个模板测试所有模型，第一个成功即停止
  const testPromises = templates.map(async (tpl): Promise<TemplateResult> => {
    // 构建模型列表：default_model + models 中其他的
    const modelsToTry: string[] = [tpl.default_model];
    for (const m of tpl.models) {
      if (m !== tpl.default_model) modelsToTry.push(m);
    }

    // 使用共享工具测试所有模型
    const results: ModelTestResult[] = await sharedTestAllModels(tpl.type, cleanKey, tpl.base_url, modelsToTry);
    const firstSuccess = results.find((r) => r.success);

    if (firstSuccess) {
      return {
        template: tpl.name,
        templateId: tpl.id,
        type: tpl.type,
        base_url: tpl.base_url,
        model: firstSuccess.model,
        success: true,
        message: `Key 可用 (${firstSuccess.message})`,
        latency_ms: firstSuccess.latency_ms,
      };
    }

    return {
      template: tpl.name,
      templateId: tpl.id,
      type: tpl.type,
      base_url: tpl.base_url,
      model: tpl.default_model,
      success: false,
      message: "所有模型均失败",
      latency_ms: 0,
    };
  });

  const results = await Promise.all(testPromises);
  const usable = results.some(r => r.success);
  const worked = results.filter(r => r.success).map(r => ({
    template: r.template,
    templateId: r.templateId,
    type: r.type,
    base_url: r.base_url,
    model: r.model,
  }));

  return Response.json({ usable, worked, results });
}
