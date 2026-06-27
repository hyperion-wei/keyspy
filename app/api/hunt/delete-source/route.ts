import { initDb, deleteHuntFinding } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * POST /api/hunt/delete-source
 * 从远程服务器删除泄露源文件，并清除对应的扫描结果
 */
export async function POST(request: Request) {
  const user = getAuthUser();
  if (!user) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { urls, finding_id } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return Response.json({ error: "未提供源文件 URL" }, { status: 400 });
    }

    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    // 逐个尝试删除源文件
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "DELETE",
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok || res.status === 404 || res.status === 405) {
          deleted++;
        } else {
          failed++;
          errors.push(`${url}: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        // 如果服务器不支持 DELETE，尝试用 POST 带 _method=DELETE
        // 或者忽略，标记为失败
        failed++;
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 删除本地扫描结果
    if (typeof finding_id === "number") {
      deleteHuntFinding(finding_id);
    }

    return Response.json({
      success: true,
      deleted,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
