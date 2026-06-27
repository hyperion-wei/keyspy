/**
 * Next.js Instrumentation Hook
 *
 * 仅作为占位文件。轮询器通过 lib/db.ts 的 initDb() 末尾惰性启动，
 * 避免 Edge Runtime 加载 Node.js 模块（better-sqlite3、fs、crypto 等）。
 */
export async function register() {
  // 故意留空：Node.js runtime 的启动逻辑由 lib/db.ts 中的 initDb() 末尾触发
}
