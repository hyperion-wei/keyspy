/**
 * 缓存键稳定序列化工具
 *
 * 用于生成基于对象的稳定缓存键,确保对象键顺序不影响结果
 */

/**
 * 将对象转换为稳定的字符串表示
 *
 * 与 JSON.stringify 不同,此函数保证相同内容的对象生成相同的字符串,
 * 无论键的定义顺序如何
 *
 * @example
 * stableStringify({ b: "2", a: "1" }) === stableStringify({ a: "1", b: "2" })
 * // => true
 */
export function stableStringify(
  obj: Record<string, string> | null | undefined
): string {
  if (!obj) return "";

  const sortedKeys = Object.keys(obj).sort();
  return sortedKeys.map((k) => `${k}=${obj[k]}`).join("&");
}
