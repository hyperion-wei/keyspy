import { cookies } from "next/headers";
import { findSession, findUserById } from "@/lib/db";

/**
 * 从当前请求的 session cookie 中获取已认证用户
 * 返回 null 表示未认证
 */
export async function getAuthUser(): Promise<{ id: number; username: string; role: string } | null> {
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
