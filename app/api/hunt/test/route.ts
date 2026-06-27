import { initDb } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TEST_TIMEOUT_MS = 30_000;

/**
 * 清理字符串中的非 ASCII 字符（智能引号、中文等）
 * 用于清理 header 值（Authorization、x-api-key 等）
 */
function sanitizeHeaderValue(value: string): string {
  // 替换常见智能引号为 ASCII 引号
  let replaced = value
    .replace(/[\u201C\u201D\u201E]/g, '"')  // “”„ -> "
    .replace(/[\u2018\u2019\u201A]/g, "'")  // ‘’‚ -> '
    .replace(/[\uFF02]/g, '"')               // ＂ -> "
    .replace(/[\uFF07]/g, "'");              // ＇ -> '
  // 去掉首尾引号
  replaced = replaced.replace(/^['"]+|['"]+$/g, '');
  // 移除所有非 ASCII 字符（>255）
  replaced = replaced.replace(/[^\x00-\xFF]/g, '');
  // 截断到第一个空白字符
  const wsIdx = replaced.search(/\s/);
  if (wsIdx > 0) {
    replaced = replaced.slice(0, wsIdx);
  }
  return replaced.trim();
}

/**
 * 已知 LLM 提供商的域名 → 正确的 chat completions 路径映射
 * 用于纠正 AI 提取的 base_url 中可能包含的错误路径
 */
const KNOWN_PROVIDER_DOMAINS: Record<string, string> = {
  "api.openai.com": "/v1/chat/completions",
  "api.anthropic.com": "/v1/messages",
  "api.minimaxi.com": "/v1/chat/completions",
  "api.minimax.chat": "/v1/chat/completions",
  "api.deepseek.com": "/v1/chat/completions",
  "dashscope.aliyuncs.com": "/compatible-mode/v1/chat/completions",
  "generativelanguage.googleapis.com": "/v1beta/models/{model}:generateContent",
  "openrouter.ai": "/api/v1/chat/completions",
  "api.together.xyz": "/v1/chat/completions",
  "api.groq.com": "/openai/v1/chat/completions",
  "api.mistral.ai": "/v1/chat/completions",
  "api.perplexity.ai": "/chat/completions",
};

/**
 * 归一化 base URL 为多个候选 URL
 * OpenAI 兼容：可能只有 base（https://api.deepseek.com），
 * 也可能已包含路径（https://api.deepseek.com/v1/chat/completions）
 * 返回多个候选 URL 供遍历测试
 */
function normalizeBaseUrl(type: string, baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const urls: string[] = [];

  if (type === 'anthropic') {
    // Anthropic: https://api.anthropic.com/v1/messages
    if (trimmed.includes('/messages')) {
      urls.push(trimmed);
    } else {
      urls.push(trimmed + '/v1/messages');
      urls.push(trimmed + '/messages');
    }
    return urls;
  }

  if (type === 'gemini') {
    // Gemini: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
    if (trimmed.includes('generateContent')) {
      urls.push(trimmed);
    } else if (trimmed.includes('/models/')) {
      urls.push(trimmed + ':generateContent');
    } else {
      urls.push(trimmed + '/v1beta/models/{model}:generateContent');
    }
    return urls;
  }

  // OpenAI compatible
  const chatSuffix = '/v1/chat/completions';
  const chatSuffixShort = '/chat/completions';
  const v1Suffix = '/v1';

  // 提取域名，检查是否有已知的正确路径
  let knownDomainPath: string | null = null;
  try {
    const u = new URL(trimmed);
    const domainPath = KNOWN_PROVIDER_DOMAINS[u.hostname];
    if (domainPath && !trimmed.endsWith(domainPath)) {
      knownDomainPath = u.origin + domainPath;
    }
  } catch { /* ignore */ }

  if (trimmed.endsWith(chatSuffix)) {
    // 已经是完整路径
    urls.push(trimmed);
  } else if (trimmed.endsWith(chatSuffixShort)) {
    urls.push(trimmed);
    // 尝试补 v1
    urls.push(trimmed.replace(chatSuffixShort, chatSuffix));
  } else if (trimmed.endsWith(v1Suffix)) {
    urls.push(trimmed + '/chat/completions');
  } else {
    // 只有 base domain 或路径不标准
    // 如果有已知的正确路径，优先尝试
    if (knownDomainPath) {
      urls.push(knownDomainPath);
    }
    urls.push(trimmed + '/v1/chat/completions');
    urls.push(trimmed + '/chat/completions');
    // 也直接尝试 base url
    urls.push(trimmed);
  }

  return urls;
}

interface TestAttemptResult {
  url: string;
  success: boolean;
  latency_ms: number;
  message: string;
  response_preview?: string;
}

/**
 * POST /api/hunt/test
 * 测试一个 LLM API Key 是否可用
 * 自动遍历多种 base URL 格式尝试
 *
 * Body: { api_key, base_url, model, provider? }
 * Returns: { success, latency_ms, message, response_preview?, url_used? }
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { api_key, base_url, model, provider } = body;

  if (!api_key || !base_url || !model) {
    return Response.json({ error: "缺少必要参数 (api_key, base_url, model)" }, { status: 400 });
  }

  // 清理非 ASCII 字符
  const cleanKey = sanitizeHeaderValue(String(api_key));
  const cleanModel = sanitizeHeaderValue(String(model));

  if (!cleanKey) {
    return Response.json({ error: "API Key 清理后为空，原始值包含无效字符" }, { status: 400 });
  }

  const type = provider === "anthropic" ? "anthropic" : provider === "gemini" || provider === "google" ? "gemini" : "openai";
  const candidateUrls = normalizeBaseUrl(type, String(base_url));

  const attempts: TestAttemptResult[] = [];

  // 遍历候选 URL
  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const req = buildTestRequest(type, cleanKey, url, cleanModel);
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      clearTimeout(timeout);

      const attempt: TestAttemptResult = { url: req.url, success: false, latency_ms: latencyMs, message: '' };

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const text = await response.text();
          const json = JSON.parse(text);
          errorMsg = json.error?.message || json.message || errorMsg;
        } catch { /* ignore */ }
        attempt.message = errorMsg;
        attempts.push(attempt);
        // 404 或连接错误 → 尝试下一个 URL
        // 401/403/429 等认证错误说明 key 有反应，URL 是对的
        if (response.status !== 404) {
          // 非 404 错误，URL 已找到正确的，直接返回
          return Response.json({
            success: false,
            latency_ms: latencyMs,
            message: `${errorMsg} (${req.url})`,
            url_used: req.url,
          });
        }
        continue;
      }

      // 成功响应
      let responsePreview = "";
      try {
        const text = await response.text();
        // 先剥离 <think> 标签
        const cleanText = text
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/<think[\s\S]*$/gi, '')
          .trim();
        responsePreview = cleanText.slice(0, 500);
        try {
          const json = JSON.parse(text);
          const content = extractQuickContent(json);
          if (content) responsePreview = content.slice(0, 200);
        } catch { /* non-JSON */ }
      } catch {
        responsePreview = "(无法读取响应)";
      }

      attempt.success = true;
      attempt.message = "Key 可用，API 响应正常";
      attempt.response_preview = responsePreview;
      attempts.push(attempt);

      return Response.json({
        success: true,
        latency_ms: latencyMs,
        message: "Key 可用，API 响应正常",
        response_preview: responsePreview,
        url_used: req.url,
      });
    } catch (err) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - startedAt;
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("abort") || msg.includes("timeout");
      const isConnError = msg.includes("connect") || msg.includes("ENOTFOUND") || msg.includes("fetch");
      attempts.push({ url, success: false, latency_ms: latencyMs, message: isTimeout ? "请求超时（30s）" : msg });

      // 连接错误或超时不继续尝试其他 URL
      if (isTimeout || (!isConnError)) {
        return Response.json({
          success: false,
          latency_ms: latencyMs,
          message: isTimeout ? "请求超时（30s）" : `请求失败: ${msg}`,
          attempts,
        });
      }
      // 连接错误 → 尝试下一个 URL
    }
  }

  // 所有候选 URL 都失败
  const lastAttempt = attempts[attempts.length - 1];
  return Response.json({
    success: false,
    latency_ms: lastAttempt?.latency_ms || 0,
    message: `所有 URL 格式均失败: ${attempts.map(a => a.message).join('; ')}`,
    attempts,
  });
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
      body: {
        model,
        system: "Reply with ONLY one word.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        stream: false,
      },
    };
  }

  if (type === "gemini") {
    // 处理 {model} 占位符
    let endpoint = baseUrl.replace('{model}', encodeURIComponent(model));
    const url = new URL(endpoint);
    if (!url.searchParams.has('key')) {
      url.searchParams.set("key", apiKey);
    }
    endpoint = url.toString();
    if (!endpoint.includes("generateContent")) {
      endpoint = endpoint.replace(/\/$/, "") + ":generateContent";
    }
    return {
      url: endpoint,
      headers: { "Content-Type": "application/json" },
      body: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 32 },
      },
    };
  }

  // OpenAI-compatible (default for most providers)
  return {
    url: baseUrl,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
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

function extractQuickContent(json: Record<string, unknown>): string | null {
  // OpenAI
  const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
  if (choice) {
    const msg = choice.message as Record<string, string> | undefined;
    return stripThinkTags(msg?.content || null);
  }
  // Anthropic
  const content = json.content as Array<Record<string, string>> | undefined;
  if (content?.[0]?.text) return stripThinkTags(content[0].text);
  // Gemini
  const candidates = json.candidates as Array<Record<string, unknown>> | undefined;
  const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, string>> | undefined;
  if (parts?.[0]?.text) return stripThinkTags(parts[0].text);
  return null;
}

/**
 * 剥离推理模型的 <think> 标签内容
 */
function stripThinkTags(text: string | null): string | null {
  if (!text) return null;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think[\s\S]*$/gi, '')
    .trim() || null;
}
