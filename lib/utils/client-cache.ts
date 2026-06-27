/**
 * 通用客户端缓存管理器
 *
 * 用于在 Next.js 热重载环境中持久化客户端实例缓存,避免重复创建
 * 支持 OpenAI、Gemini、Anthropic 等 Provider 的客户端缓存
 */

/**
 * 全局缓存键类型定义
 * 格式: __CHECK_CX_${PROVIDER}_CLIENTS__
 */
type GlobalCacheKey =
  | "__CHECK_CX_OPENAI_CLIENTS__"
  | "__CHECK_CX_GEMINI_CLIENTS__"
  | "__CHECK_CX_ANTHROPIC_CLIENTS__";

/**
 * 扩展全局类型声明,支持客户端缓存持久化
 */
declare global {
  var __CHECK_CX_OPENAI_CLIENTS__: Map<string, unknown> | undefined;
  var __CHECK_CX_GEMINI_CLIENTS__: Map<string, unknown> | undefined;
  var __CHECK_CX_ANTHROPIC_CLIENTS__: Map<string, unknown> | undefined;
}

/**
 * 获取或创建客户端缓存
 *
 * @template T - 客户端实例类型(如 OpenAI, GenerativeModel, Anthropic)
 * @param globalKey - 全局缓存键名
 * @returns 客户端缓存 Map,key 为缓存键(通常为 baseURL + apiKey),value 为客户端实例
 *
 * @example
 * ```typescript
 * // OpenAI Provider
 * const openAIClientCache = getOrCreateClientCache<OpenAI>("__CHECK_CX_OPENAI_CLIENTS__");
 * const cacheKey = `${baseURL}::${apiKey}`;
 * let client = openAIClientCache.get(cacheKey);
 * if (!client) {
 *   client = new OpenAI({ baseURL, apiKey });
 *   openAIClientCache.set(cacheKey, client);
 * }
 * ```
 */
export function getOrCreateClientCache<T>(
  globalKey: GlobalCacheKey
): Map<string, T> {
  const existing = (globalThis as Record<string, unknown>)[globalKey] as
    | Map<string, T>
    | undefined;
  if (existing) return existing;

  const cache = new Map<string, T>();
  (globalThis as Record<string, unknown>)[globalKey] = cache;
  return cache;
}
