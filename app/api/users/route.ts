import { NextRequest, NextResponse } from "next/server";
import { initDb, getAllUsers, createUser, deleteUser, changeUserPassword, updateUserRole, updateUsername } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/users - 获取用户列表（仅管理员）
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const users = getAllUsers();
  return NextResponse.json({ users });
}

/**
 * POST /api/users - 创建新用户（仅管理员）
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { username, password, role } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
  }
  if (username.length < 3 || username.length > 30) {
    return NextResponse.json({ error: "用户名长度需在 3-30 个字符之间" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码长度至少为 6 个字符" }, { status: 400 });
  }
  if (role && !["admin", "user"].includes(role)) {
    return NextResponse.json({ error: "角色只能是 admin 或 user" }, { status: 400 });
  }

  try {
    const user = createUser(username, password, role || "user");
    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "用户名已存在"
      : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * PUT /api/users - 修改用户信息（仅管理员）
 * body: { id, password?, role?, username? }
 */
export async function PUT(request: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { id, password, role, username } = await request.json();

  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
  }

  const errors: string[] = [];

  if (password !== undefined) {
    if (password.length < 6) {
      return NextResponse.json({ error: "密码长度至少为 6 个字符" }, { status: 400 });
    }
    if (!changeUserPassword(id, password)) {
      errors.push("修改密码失败");
    }
  }

  if (role !== undefined) {
    if (!["admin", "user"].includes(role)) {
      return NextResponse.json({ error: "角色只能是 admin 或 user" }, { status: 400 });
    }
    if (!updateUserRole(id, role)) {
      errors.push("修改角色失败");
    }
  }

  if (username !== undefined) {
    if (username.length < 3 || username.length > 30) {
      return NextResponse.json({ error: "用户名长度需在 3-30 个字符之间" }, { status: 400 });
    }
    if (!updateUsername(id, username)) {
      errors.push("修改用户名失败");
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(", ") }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/users - 删除用户（仅管理员）
 */
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "缺少用户 ID" }, { status: 400 });
  }

  const userId = Number(id);
  if (isNaN(userId)) {
    return NextResponse.json({ error: "无效的用户 ID" }, { status: 400 });
  }

  if (!deleteUser(userId)) {
    return NextResponse.json({ error: "删除失败，用户可能不存在" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
