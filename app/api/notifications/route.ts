import { NextResponse } from "next/server";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * Notifications API stub（UI 层独立版本）
 *
 * 返回空通知列表，保持接口兼容。
 * 接入真实后端后替换此文件。
 */
export async function GET() {
  return NextResponse.json([], {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
