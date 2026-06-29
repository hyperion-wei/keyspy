import { initDb, getAllTemplates } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TEST_TIMEOUT_MS = 15_000;

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

  // 并发测试所有模板
  const testPromises = templates.map(async (tpl): Promise<TemplateResult> => {
    const model = tpl.default_model;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const req = buildTestRequest(tpl.type, cleanKey, tpl.base_url, model);
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latency = Date.now() - startedAt;

      if (response.ok) {
        // HTTP 200 不代表 key 有效，必须检查 response body 是否包含实际内容
        const bodyText = await response.text();
        const validation = validateResponse(tpl.type, bodyText);
        if (validation.valid) {
          return { template: tpl.name, templateId: tpl.id, type: tpl.type, base_url: tpl.base_url, model, success: true, message: `Key 可用 (${validation.content})`, latency_ms: latency };
        } else {
          return { template: tpl.name, templateId: tpl.id, type: tpl.type, base_url: tpl.base_url, model, success: false, message: validation.error || "响应无有效内容", latency_ms: latency };
        }
      } else {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const text = await response.text();
          const json = JSON.parse(text);
          errorMsg = json.error?.message || json.message || errorMsg;
        } catch { /* ignore */ }
        return { template: tpl.name, templateId: tpl.id, type: tpl.type, base_url: tpl.base_url, model, success: false, message: errorMsg, latency_ms: latency };
      }
    } catch (err) {
      clearTimeout(timeout);
      const latency = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("abort") || msg.includes("timeout");
      return {
        template: tpl.name,
        templateId: tpl.id,
        type: tpl.type,
        base_url: tpl.base_url,
        model,
        success: false,
        message: isTimeout ? "请求超时" : msg.slice(0, 100),
        latency_ms: latency,
      };
    }
  });

  const results = await Promise.all(testPromises);
  const usable = results.some(r => r.success);
  const worked = results.filter(r => r.success).map(r => ({ template: r.template, templateId: r.templateId, type: r.type, base_url: r.base_url, model: r.model }));

  return Response.json({ usable, worked, results });
}

function buildTestRequest(
  type: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = "Say hello in exactly one word.";

  if (type === "anthropic") {
    return {
      url: baseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: { model, system: "Reply with ONLY one word.", messages: [{ role: "user", content: prompt }], max_tokens: 32, stream: false },
    };
  }

  if (type === "gemini") {
    let endpoint = baseUrl.replace('{model}', encodeURIComponent(model));
    const url = new URL(endpoint);
    if (!url.searchParams.has('key')) url.searchParams.set("key", apiKey);
    endpoint = url.toString();
    if (!endpoint.includes("generateContent")) {
      endpoint = endpoint.replace(/\/$/, "") + ":generateContent";
    }
    return {
      url: endpoint,
      headers: { "Content-Type": "application/json" },
      body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 32 } },
    };
  }

  return {
    url: baseUrl,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: {
      model,
      messages: [
        { role: "system", content: "Reply with ONLY one word." },
        { role: "user", content: prompt },
      ],
      max_tokens: 32,
      stream: false,
    },
  };
}

/**
 * 验证 LLM API 响应是否包含实际有效内容
 * HTTP 200 不代表 key 有效，必须检查 body 内容
 */
function validateResponse(type: string, bodyText: string): { valid: boolean; content?: string; error?: string } {
  if (!bodyText || bodyText.length < 10) {
    return { valid: false, error: "响应为空" };
  }

  try {
    const json = JSON.parse(bodyText);

    // 检查是否有错误信息（有些 API 返回 200 但 body 里是错误）
    if (json.error) {
      const msg = json.error?.message || json.error?.code || JSON.stringify(json.error);
      return { valid: false, error: `API 错误: ${msg}` };
    }

    if (type === "anthropic") {
      // Anthropic: { content: [{ text: "..." }] }
      const text = json.content?.[0]?.text;
      if (text && text.trim()) return { valid: true, content: text.slice(0, 50) };
      return { valid: false, error: "Anthropic 响应无 content" };
    }

    if (type === "gemini") {
      // Gemini: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim()) return { valid: true, content: text.slice(0, 50) };
      return { valid: false, error: "Gemini 响应无 candidates" };
    }

    // OpenAI-compatible: { choices: [{ message: { content: "..." } }] }
    const content = json.choices?.[0]?.message?.content;
    if (content && content.trim()) {
      // 剥离  标签
      const clean = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think[\s\S]*$/gi, '').trim();
      if (clean) return { valid: true, content: clean.slice(0, 50) };
    }

    // 没有有效内容
    if (json.message) return { valid: false, error: `响应: ${json.message}` };
    return { valid: false, error: "响应无有效 choices/content" };
  } catch {
    // 非 JSON 响应
    return { valid: false, error: "响应非 JSON 格式" };
  }
}
