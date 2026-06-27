import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findSession, findUserById } from "@/lib/db";

export async function GET() {
  const sessionCookie = (await cookies()).get("session");
  if (!sessionCookie) {
    return NextResponse.json({ user: null });
  }

  const session = findSession(sessionCookie.value);
  if (!session || new Date(session.expires_at) < new Date()) {
    (await cookies()).delete("session");
    return NextResponse.json({ user: null });
  }

  const user = findUserById(session.user_id);
  if (!user) {
    (await cookies()).delete("session");
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({ user });
}
