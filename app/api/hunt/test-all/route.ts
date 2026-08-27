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
 * provider 标识 → 协议类型（与 hunt/test 路由保持一致）
 */
function providerToType(provider?: string): string {
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini" || provider === "google") return "gemini";
  return "openai";
}

/**
 * POST /api/hunt/test-all
 * 用指定 API Key 自动检测可用性（两级策略）：
 * 1. 若提供 base_url + model，先实测发现来源地址（覆盖中转/代理 Key）；
 * 2. 来源不可用或信息不全 → 并发遍历所有内置模板。
 *
 * Body: { api_key, base_url?, model?, provider? }
 * Returns: { usable, worked, results: [{template, success, message}] }
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { api_key, base_url, model, provider } = body;

  if (!api_key) {
    return Response.json({ error: "缺少 api_key" }, { status: 400 });
  }

  const cleanKey = sanitizeHeaderValue(String(api_key));
  if (!cleanKey) {
    return Response.json({ error: "API Key 清理后为空" }, { status: 400 });
  }

  // ===== 第一级：先实测发现来源地址（如有） =====
  if (base_url && model) {
    const sourceType = providerToType(provider);
    const sourceResults: ModelTestResult[] = await sharedTestAllModels(
      sourceType, cleanKey, String(base_url), [String(model)]
    );
    const ok = sourceResults.find((r) => r.success);
    if (ok) {
      return Response.json({
        usable: true,
        worked: [{
          template: "发现来源",
          templateId: null,
          type: sourceType,
          base_url: String(base_url),
          model: ok.model,
        }],
        results: [{
          template: "发现来源",
          templateId: null,
          type: sourceType,
          base_url: String(base_url),
          model: ok.model,
          success: true,
          message: `Key 可用 (${ok.message})`,
          latency_ms: ok.latency_ms,
        }],
      });
    }
    // 来源地址不可用 → 继续遍历模板兜底
  }

  // ===== 第二级：遍历所有内置模板 =====
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
