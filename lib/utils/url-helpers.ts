/**
 * URL 处理工具函数
 */

/**
 * 从错误响应体中提取错误信息
 * @param body 响应体文本
 */
export function extractMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.message ||
      JSON.stringify(parsed)
    );
  } catch {
    return body.slice(0, 280);
  }
}
