/**
 * API 存活检测模块
 *
 * 使用直接 HTTP 请求（非 AI SDK）检测 API 端点是否存活：
 * 1. 向 API 端点发送 POST 请求（流式）
 * 2. 携带随机语言理解挑战题
 * 3. 测量响应延迟
 * 4. 验证回复是否包含正确答案
 * 5. 判定状态：operational(<=6s) / degraded(>6s) / failed / error
 */

import type { MonitorConfig, CheckHistoryInput } from "./db";
import { generateChallenge, validateResponse } from "./challenge";
import { updateActiveModel } from "./db";

/** 默认超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 45_000;

/** 性能降级阈值（毫秒） */
const DEGRADED_THRESHOLD_MS = 6_000;

/** Ping 超时（毫秒） */
const PING_TIMEOUT_MS = 8_000;

/** 最大并发数 */
const DEFAULT_CONCURRENCY = 5;

/** 检测结果 */
export interface ApiCheckResult extends CheckHistoryInput {
  /** 人类可读的名称（用于日志） */
  name: string;
  /** Provider 类型（用于日志） */
  type: string;
  /** 模型名（用于日志） */
  model: string;
  /** 端点（用于日志） */
  endpoint: string;
}

/* ============================================================================
 * 端点 Ping
 * ============================================================================ */

function resolvePingOrigin(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

async function tryPing(url: string, method: "HEAD" | "GET"): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    await fetch(url, {
      method,
      cache: "no-store",
      redirect: "manual",
      headers: { "User-Agent": "check-cx-ui/ping" },
      signal: controller.signal,
    });
    return Date.now() - startedAt;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function measureEndpointPing(endpoint: string): Promise<number | null> {
  const origin = resolvePingOrigin(endpoint);
  if (!origin) return null;

  const headLatency = await tryPing(origin, "HEAD");
  if (headLatency !== null) return headLatency;
  return tryPing(origin, "GET");
}

/* ============================================================================
 * 流式响应收集
 * ============================================================================ */

/** System prompt 强化"只回答一个词"的约束 */
const SYSTEM_PROMPT = "You are a helpful assistant. Reply with ONLY one single word as the answer. Do not explain, do not think, do not add any other text.";

/**
 * 从模型输出中剥离思考标签内容
 *
 * 一些模型会在 </think> 或  标签中输出推理过程，
 * 需要提取标签外的实际回答内容。
 */
function stripThinkingTags(text: string): string {
  // 使用字符串拼接构建正则，避免 HTML 标签解析问题
  const T = "think";
  const TING = "thinking";
  const re1 = new RegExp("<" + T + ">[\\s\\S]*?</" + T + ">", "gi");
  const re2 = new RegExp("<" + TING + ">[\\s\\S]*?</" + TING + ">", "gi");
  let result = text.replace(re1, "");
  result = result.replace(re2, "");
  return result.trim();
}

/**
 * 从响应中收集文本内容
 *
 * 兼容流式 SSE 和非流式 JSON 两种格式：
 * - OpenAI: choices[0].delta.content / choices[0].message.content
 * - Anthropic: delta.text / content[0].text
 * - Gemini: candidates[0].content.parts[0].text
 */
async function collectResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let buffer = "";
  let collected = "";
  let isSSE = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 检查是否是 SSE 格式
      if (!isSSE && buffer.includes("data:")) {
        isSSE = true;
      }

      if (isSSE) {
        // 按行处理 SSE
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            collected += extractTextFromJson(json);
          } catch {
            // 非 JSON 行，跳过
          }
        }
      }
    }

    // 非 SSE 格式：尝试作为单个 JSON 解析
    if (!isSSE && buffer.trim()) {
      try {
        const json = JSON.parse(buffer);
        collected = extractTextFromJson(json);
      } catch {
        // 非 JSON，直接返回原始文本
        collected = buffer;
      }
    }
  } catch {
    // 流读取中断
  }

  // 剥离思考标签
  return stripThinkingTags(collected);
}

/**
 * 从 JSON 响应中提取文本内容
 * 兼容 OpenAI / Anthropic / Gemini 格式
 */
function extractTextFromJson(json: Record<string, unknown>): string {
  // OpenAI format (streaming delta or non-streaming message)
  const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
  if (choice) {
    const delta = choice.delta as Record<string, string> | undefined;
    const message = choice.message as Record<string, string> | undefined;
    return delta?.content || message?.content || "";
  }

  // Anthropic format (streaming delta or non-streaming content)
  const anthropicDelta = (json.delta as Record<string, string>)?.text;
  if (anthropicDelta) return anthropicDelta;

  const anthropicContent = json.content as Array<Record<string, string>> | undefined;
  if (anthropicContent?.[0]?.text) return anthropicContent[0].text;

  // Gemini format
  const geminiText = (json.candidates as Array<Record<string, unknown>>)?.[0];
  if (geminiText) {
    const content = geminiText.content as Record<string, unknown>;
    const parts = content?.parts as Array<Record<string, string>>;
    if (parts?.[0]?.text) return parts[0].text;
  }

  return "";
}

/* ============================================================================
 * 请求构建
 * ============================================================================ */

interface RequestPayload {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * 已知 LLM 提供商的域名 → 正确的 chat completions 路径映射
 * 用于自动修正不完整的 base_url
 */
const KNOWN_PROVIDER_DOMAINS: Record<string, string> = {
  "api.openai.com": "/v1/chat/completions",
  "api.anthropic.com": "/v1/messages",
  "api.minimaxi.com": "/v1/chat/completions",
  "api.minimax.chat": "/v1/chat/completions",
  "api.deepseek.com": "/v1/chat/completions",
  "dashscope.aliyuncs.com": "/compatible-mode/v1/chat/completions",
  "generativelanguage.googleapis.com": "/v1beta/models/{model}:streamGenerateContent",
  "openrouter.ai": "/api/v1/chat/completions",
  "api.together.xyz": "/v1/chat/completions",
  "api.groq.com": "/openai/v1/chat/completions",
  "api.mistral.ai": "/v1/chat/completions",
  "api.perplexity.ai": "/chat/completions",
};

/**
 * 标准化 base_url：确保包含完整的 chat completions 路径
 * 对于 OpenAI 兼容格式，自动补全 /v1/chat/completions
 */
function normalizeOpenAIUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  
  // 已经包含正确的路径后缀
  if (trimmed.endsWith('/v1/chat/completions') || 
      trimmed.endsWith('/chat/completions') ||
      trimmed.endsWith('/messages')) {
    return trimmed;
  }

  // 检查是否是已知域名，自动补全正确路径
  try {
    const u = new URL(trimmed);
    const knownPath = KNOWN_PROVIDER_DOMAINS[u.hostname];
    if (knownPath && !knownPath.includes('{model}')) {
      return u.origin + knownPath;
    }
  } catch { /* ignore */ }

  // 以 /v1 结尾，补全 /chat/completions
  if (trimmed.endsWith('/v1')) {
    return trimmed + '/chat/completions';
  }

  // 其他情况，尝试补全 /v1/chat/completions
  return trimmed + '/v1/chat/completions';
}

function buildOpenAIRequest(config: MonitorConfig, prompt: string): RequestPayload {
  return {
    url: normalizeOpenAIUrl(config.base_url),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`,
      "User-Agent": "check-cx-ui/1.0",
    },
    body: {
      model: config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 128,
      stream: true,
    },
  };
}

function buildAnthropicRequest(config: MonitorConfig, prompt: string): RequestPayload {
  return {
    url: config.base_url,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.api_key,
      "anthropic-version": "2023-06-01",
      "User-Agent": "check-cx-ui/1.0",
    },
    body: {
      model: config.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 128,
      stream: true,
    },
  };
}

function buildGeminiRequest(config: MonitorConfig, prompt: string): RequestPayload {
  const url = new URL(config.base_url);
  // Gemini API 需要在 URL 上加 key 参数
  url.searchParams.set("key", config.api_key);
  // 如果端点不包含 :streamGenerateContent，追加它
  let endpoint = url.toString();
  if (!endpoint.includes("streamGenerateContent") && !endpoint.includes("generateContent")) {
    endpoint = endpoint.replace(/\/$/, "") + ":streamGenerateContent";
  }

  return {
    url: endpoint,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "check-cx-ui/1.0",
    },
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 128 },
    },
  };
}

function buildRequest(config: MonitorConfig, prompt: string): RequestPayload {
  switch (config.type) {
    case "anthropic":
      return buildAnthropicRequest(config, prompt);
    case "gemini":
      return buildGeminiRequest(config, prompt);
    case "openai":
    default:
      return buildOpenAIRequest(config, prompt);
  }
}

/* ============================================================================
 * 单个 API 检测
 * ============================================================================ */

async function checkSingleApi(config: MonitorConfig, overrideModel?: string): Promise<ApiCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  const challenge = generateChallenge();
  const pingPromise = measureEndpointPing(config.base_url);

  // 实际使用的模型：override 优先，否则用 config.model
  const activeModel = overrideModel ?? config.model;

  const baseResult = {
    config_id: config.id,
    name: config.name,
    type: config.type,
    model: activeModel,
    endpoint: config.base_url,
  };

  try {
    const { url, headers, body } = buildRequest(config, challenge.prompt);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const latencyMs = Date.now() - startedAt;
      let errorMsg = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        errorMsg = json.error?.message || json.message || errorMsg;
      } catch {
        // 解析失败，使用基础错误信息
      }

      return {
        ...baseResult,
        status: "error",
        latency_ms: latencyMs,
        ping_latency_ms: await pingPromise,
        message: errorMsg,
      };
    }

    // 收集响应文本（兼容流式和非流式）
    const collected = await collectResponseText(response);
    const latencyMs = Date.now() - startedAt;
    const pingLatency = await pingPromise;

    // 空回复
    if (!collected.trim()) {
      return {
        ...baseResult,
        status: "failed",
        latency_ms: latencyMs,
        ping_latency_ms: pingLatency,
        message: "回复为空",
      };
    }

    // 验证答案
    const { valid, normalized } = validateResponse(collected, challenge.expectedAnswer);

    if (!valid) {
      const actual = normalized || "(空)";
      return {
        ...baseResult,
        status: "failed",
        latency_ms: latencyMs,
        ping_latency_ms: pingLatency,
        message: `回复验证失败: 期望 "${challenge.expectedAnswer}", 实际: "${actual}"`,
      };
    }

    // 判定状态
    const status = latencyMs <= DEGRADED_THRESHOLD_MS ? "operational" : "degraded";
    const message = status === "degraded"
      ? `响应成功但耗时 ${latencyMs}ms`
      : `验证通过 (${latencyMs}ms)`;

    return {
      ...baseResult,
      status,
      latency_ms: latencyMs,
      ping_latency_ms: pingLatency,
      message,
    };
  } catch (error) {
    const err = error as Error & { name?: string };
    const isTimeout = err?.name === "AbortError" || /timeout|aborted/i.test(err?.message || "");

    return {
      ...baseResult,
      status: "error",
      latency_ms: null,
      ping_latency_ms: await pingPromise,
      message: isTimeout ? "请求超时" : (err?.message || "未知错误"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/* ============================================================================
 * 批量检测（带并发控制）
 * ============================================================================ */

/** 简单并发限制器 */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

/**
 * 带自动降级的单个配置检测
 *
 * 依次尝试首选模型和 fallback_models 中的其他模型，
 * 返回第一个成功的检测结果。如果所有模型都失败，返回最后一次的失败结果。
 * 成功的模型会持久化到 monitor_configs.active_model。
 */
async function checkWithFallback(config: MonitorConfig): Promise<ApiCheckResult> {
  // 解析 fallback_models JSON
  let fallbacks: string[] = [];
  try {
    const parsed = JSON.parse(config.fallback_models || "[]");
    if (Array.isArray(parsed)) {
      fallbacks = parsed.filter((m): m is string => typeof m === "string" && m.length > 0);
    }
  } catch {
    // 忽略 JSON 解析错误
  }

  // 按优先级拼接：首选模型 + 降级模型
  const modelsToTry = [config.model, ...fallbacks.filter((m) => m !== config.model)];

  let lastResult: ApiCheckResult | null = null;
  for (const model of modelsToTry) {
    const result = await checkSingleApi(config, model);
    lastResult = result;

    // operational 或 degraded 都算成功
    if (result.status === "operational" || result.status === "degraded") {
      // 持久化当前可用模型
      try {
        updateActiveModel(config.id, model);
      } catch {
        // 持久化失败不影响检测结果
      }
      return result;
    }
  }

  // 所有模型都失败
  try {
    updateActiveModel(config.id, "");
  } catch {
    // ignore
  }
  return lastResult!;
}

/**
 * 批量检测所有启用的 API 配置（带自动降级）
 *
 * @param configs 启用的监控配置列表
 * @returns 检测结果数组
 */
export async function runApiChecks(configs: MonitorConfig[]): Promise<ApiCheckResult[]> {
  if (configs.length === 0) return [];

  const concurrency = parseInt(process.env.CHECK_CONCURRENCY || String(DEFAULT_CONCURRENCY), 10);
  const limiter = createLimiter(Math.max(1, Math.min(20, concurrency)));

  const results = await Promise.all(
    configs.map((config) => limiter(() => checkWithFallback(config)))
  );

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
