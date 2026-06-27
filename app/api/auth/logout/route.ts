import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findSession, deleteSession } from "@/lib/db";

export async function POST() {
  const sessionCookie = (await cookies()).get("session");
  if (sessionCookie) {
    deleteSession(sessionCookie.value);
  }

  const cookieStore = await cookies();
  cookieStore.delete("session");
  cookieStore.delete("auth");

  return NextResponse.json({ success: true });
}
