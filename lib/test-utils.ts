/**
 * LLM API 测试工具函数
 * 供 hunt/test-all 和 monitors 批量创建共享使用
 */

const TEST_TIMEOUT_MS = 15_000;

export interface TestRequestResult {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ModelTestResult {
  model: string;
  success: boolean;
  message: string;
  latency_ms: number;
}

/**
 * 构建 LLM API 测试请求
 */
export function buildTestRequest(
  type: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): TestRequestResult {
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
    let endpoint = baseUrl.replace("{model}", encodeURIComponent(model));
    const url = new URL(endpoint);
    if (!url.searchParams.has("key")) url.searchParams.set("key", apiKey);
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

  return {
    url: baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
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

/**
 * 验证 LLM API 响应是否包含实际有效内容
 */
export function validateResponse(
  type: string,
  bodyText: string,
): { valid: boolean; content?: string; error?: string } {
  if (!bodyText || bodyText.length < 10) {
    return { valid: false, error: "响应空" };
  }

  try {
    const json = JSON.parse(bodyText);

    if (json.error) {
      const msg = json.error?.message || json.error?.code || JSON.stringify(json.error);
      return { valid: false, error: `API 错误: ${msg}` };
    }

    if (type === "anthropic") {
      const text = json.content?.[0]?.text;
      if (text && text.trim()) return { valid: true, content: text.slice(0, 50) };
      return { valid: false, error: "Anthropic 响应无 content" };
    }

    if (type === "gemini") {
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim()) return { valid: true, content: text.slice(0, 50) };
      return { valid: false, error: "Gemini 响应无 candidates" };
    }

    // OpenAI-compatible
    const message = json.choices?.[0]?.message;
    if (message) {
      let content = message.content;
      if (!content || !content.trim()) {
        content = message.reasoning_content || message.reasoning || "";
      }
      if (content && content.trim()) {
        const clean = content
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/<think[\s\S]*$/gi, "")
          .trim();
        if (clean) return { valid: true, content: clean.slice(0, 50) };
      }
    }

    if (json.message) return { valid: false, error: `响应: ${json.message}` };
    return { valid: false, error: "响应无有效 choices/content" };
  } catch {
    return { valid: false, error: "响应非 JSON 格式" };
  }
}

/**
 * 测试单个 key 对指定模板的所有模型，返回每个模型的测试结果
 */
export async function testAllModels(
  type: string,
  apiKey: string,
  baseUrl: string,
  models: string[],
): Promise<ModelTestResult[]> {
  const promises = models.map(async (model): Promise<ModelTestResult> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

    try {
      const req = buildTestRequest(type, apiKey, baseUrl, model);
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const latency = Date.now() - startedAt;

      if (response.ok) {
        const bodyText = await response.text();
        const validation = validateResponse(type, bodyText);
        if (validation.valid) {
          return { model, success: true, message: validation.content || "OK", latency_ms: latency };
        }
        return { model, success: false, message: validation.error || "响应无效", latency_ms: latency };
      }
      return { model, success: false, message: `HTTP ${response.status}`, latency_ms: latency };
    } catch (err) {
      clearTimeout(timeout);
      return {
        model,
        success: false,
        message: err instanceof Error ? (err.name === "AbortError" ? "超时" : err.message) : "未知错误",
        latency_ms: 0,
      };
    }
  });

  return Promise.all(promises);
}
