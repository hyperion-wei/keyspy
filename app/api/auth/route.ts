import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { initDb, findUserByUsername, verifyPassword, createSession } from "@/lib/db";

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

    return NextResponse.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  }

  return NextResponse.json({ error: "无效的操作" }, { status: 400 });
}
