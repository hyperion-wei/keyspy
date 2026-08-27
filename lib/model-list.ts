/**
 * 模型列表动态获取模块
 *
 * 调用提供商的模型列表接口，拉取某个 Key 名下的全量模型：
 * - OpenAI 兼容: GET {base}/v1/models
 * - Anthropic:   GET /v1/models（x-api-key 鉴权）
 * - Gemini:      GET /v1beta/models?key=KEY
 *
 * 拉取结果用于：
 * 1. 监控卡片展示该 Key 的全部可用模型
 * 2. 添加监控时自动填充首选模型 + 降级链
 */

/** 拉取超时（毫秒）
 * 30s：NVIDIA 等海外提供商 /v1/models 响应较慢，8s 会频繁超时 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * 非对话类模型的噪声关键词（embedding / 音频 / 图像 / 审核等）
 * 这些模型无法用于 chat 检测，不进入展示与降级链
 */
const NOISE_MODEL_KEYWORDS = [
  "embedding",
  "embed",
  "whisper",
  "tts",
  "speech",
  "audio",
  "dall-e",
  "dalle",
  "image",
  "rerank",
  "moderation",
  "ocr",
  "asr",
];

export interface FetchModelListResult {
  ok: boolean;
  models: string[];
  error?: string;
}

/**
 * 把 chat completions 形态的 base_url 归一成 models 列表接口地址
 *
 * 例：https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/models
 */
function resolveOpenAIModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");

  // 已经是 models 端点
  if (/\/models\/?$/.test(trimmed)) return trimmed;

  // 剥离 chat completions / messages 等具体动作路径
  const stripped = trimmed
    .replace(/\/chat\/completions$/, "")
    .replace(/\/completions$/, "")
    .replace(/\/messages$/, "");

  // 以 /v1（或 /vN）结尾：追加 /models
  if (/\/v\d+$/.test(stripped)) {
    return stripped + "/models";
  }

  // 其他情况：尝试补全 /v1/models
  return stripped + "/v1/models";
}

/** 判断模型名是否属于非对话类噪声模型 */
export function isNoiseModel(model: string): boolean {
  const lower = model.toLowerCase();
  return NOISE_MODEL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * 从 OpenAI 兼容响应中提取模型 id 列表
 * 兼容 { data: [{ id }] } 与裸数组两种形态
 */
function parseOpenAIModels(json: Record<string, unknown>): string[] {
  const data = json.data;
  const list = Array.isArray(data) ? data : Array.isArray(json.models) ? json.models : [];
  const ids: string[] = [];
  for (const item of list) {
    if (item && typeof item === "object") {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) ids.push(id);
    } else if (typeof item === "string") {
      ids.push(item);
    }
  }
  return ids;
}

/**
 * 拉取指定 Key 名下的全量模型列表
 *
 * @param type    提供商类型：openai / anthropic / gemini
 * @param baseUrl 监控配置中的 base_url（chat completions 形态）
 * @param apiKey  API Key
 * @returns 清洗后的模型 id 数组（已去重、去噪声）
 */
export async function fetchModelList(
  type: string,
  baseUrl: string,
  apiKey: string
): Promise<FetchModelListResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let url: string;
    let headers: Record<string, string> = { "User-Agent": "keyspy/1.0" };

    if (type === "anthropic") {
      // Anthropic models 端点与 messages 同根：剥掉 /v1/messages 后拼 /v1/models
      url = baseUrl.replace(/\/+$/, "").replace(/\/v1\/messages$/, "") + "/v1/models";
      headers = {
        ...headers,
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
    } else if (type === "gemini") {
      try {
        const u = new URL(baseUrl);
        // 去掉可能残留的 models/xxx 或 :generateContent 路径
        u.pathname = "/v1beta/models";
        u.searchParams.set("key", apiKey);
        url = u.toString();
      } catch {
        return { ok: false, models: [], error: "Base URL 格式无效" };
      }
    } else {
      url = resolveOpenAIModelsUrl(baseUrl);
      headers = { ...headers, Authorization: `Bearer ${apiKey}` };
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const json = await response.json();
        msg = json.error?.message || json.message || msg;
      } catch {
        // 非 JSON 错误体，保留状态码
      }
      return { ok: false, models: [], error: msg };
    }

    const json = await response.json();

    let models: string[];
    if (type === "gemini") {
      // Gemini: { models: [{ name: "models/gemini-2.5-flash", ... }] }
      const list = Array.isArray(json.models) ? json.models : [];
      models = list
        .map((m: Record<string, unknown>) => String(m.name || ""))
        .filter(Boolean)
        .map((name: string) => name.replace(/^models\//, ""));
    } else {
      models = parseOpenAIModels(json);
    }

    // 去重 + 去噪声
    const cleaned = Array.from(new Set(models)).filter((m) => !isNoiseModel(m));

    if (cleaned.length === 0) {
      return { ok: false, models: [], error: "接口未返回可用模型" };
    }

    return { ok: true, models: cleaned };
  } catch (error) {
    const err = error as Error & { name?: string };
    const isTimeout = err?.name === "AbortError";
    return { ok: false, models: [], error: isTimeout ? "请求超时" : err?.message || "未知错误" };
  } finally {
    clearTimeout(timeout);
  }
}
