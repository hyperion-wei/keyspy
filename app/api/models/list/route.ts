import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { fetchModelList } from "@/lib/model-list";

initDb();

export const dynamic = "force-dynamic";

/**
 * POST /api/models/list - 动态获取某个 Key 名下的全量模型列表
 *
 * 入参：{ type, base_url, api_key }
 * 返回：{ ok, models, error? }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { type, base_url, api_key } = body as {
    type?: string;
    base_url?: string;
    api_key?: string;
  };

  if (!base_url || !api_key) {
    return NextResponse.json(
      { error: "base_url 和 api_key 不能为空" },
      { status: 400 }
    );
  }

  const result = await fetchModelList(type || "openai", base_url, api_key);
  return NextResponse.json(result);
}
