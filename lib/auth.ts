import { cookies, headers } from "next/headers";
import { findSession, findUserById, findEnabledMcpToken, touchMcpToken } from "@/lib/db";

/**
 * 从 Authorization: Bearer <mcp-token> 头中解析 MCP Token 对应的用户
 * 返回 null 表示未携带或 Token 无效/已停用
 */
async function getMcpTokenUser(): Promise<{ id: number; username: string; role: string } | null> {
  try {
    const headerStore = await headers();
    const authorization = headerStore.get("authorization");
    if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) return null;

    const token = authorization.slice(7).trim();
    if (!token) return null;

    const mcpToken = findEnabledMcpToken(token);
    if (!mcpToken) return null;

    // MCP Token 以创建者的身份运行
    const owner = findUserById(mcpToken.created_by);
    if (!owner) return null;

    touchMcpToken(mcpToken.id);
    return owner;
  } catch {
    // 非请求上下文（如后台轮询），无 headers 可用
    return null;
  }
}

/**
 * 从当前请求中获取已认证用户
 * 优先解析 Authorization: Bearer <mcp-token>，其次解析 session cookie
 * 返回 null 表示未认证
 */
export async function getAuthUser(): Promise<{ id: number; username: string; role: string } | null> {
  const bearerUser = await getMcpTokenUser();
  if (bearerUser) return bearerUser;

  const sessionCookie = (await cookies()).get("session");
  if (!sessionCookie) return null;

  const session = findSession(sessionCookie.value);
  if (!session || new Date(session.expires_at) < new Date()) return null;

  return findUserById(session.user_id) ?? null;
}

/**
 * 检查当前用户是否为管理员
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getAuthUser();
  return user?.role === "admin";
}
