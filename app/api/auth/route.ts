import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { initDb, findUserByUsername, verifyPassword, createSession, createUser } from "@/lib/db";

initDb();

export async function POST(request: NextRequest) {
  const { action, username, password } = await request.json();

  if (action === "login") {
    if (!username || !password) {
      return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
    }

    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
    }

    const sessionId = createSession(user.id);
    const cookieStore = await cookies();
    cookieStore.set("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });
    cookieStore.set("auth", "1", {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
  }

  if (action === "register") {
    if (!username || !password) {
      return NextResponse.json({ error: "用户名和密码不能为空" }, { status: 400 });
    }
    if (username.length < 3 || username.length > 20) {
      return NextResponse.json({ error: "用户名长度需在 3-20 个字符之间" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "密码长度至少为 6 个字符" }, { status: 400 });
    }

    try {
      const user = createUser(username, password);
      const sessionId = createSession(user.id);
      const cookieStore = await cookies();
      cookieStore.set("session", sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
        path: "/",
      });
      cookieStore.set("auth", "1", {
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
        path: "/",
      });

      return NextResponse.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (error: unknown) {
      const message = error instanceof Error && error.message.includes("UNIQUE constraint failed")
        ? "用户名已存在"
        : "注册失败";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "无效的操作" }, { status: 400 });
}
