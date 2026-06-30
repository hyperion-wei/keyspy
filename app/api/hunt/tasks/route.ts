import { initDb, getAllHuntTasks, getHuntTaskById, getHuntFindingsByTaskId, deleteHuntTask, updateHuntTask } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { abortTask } from "@/lib/hunt-registry";

initDb();

export const dynamic = "force-dynamic";

/**
 * GET /api/hunt/tasks
 * 获取所有扫描任务列表
 */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("id");

  if (taskId) {
    // 获取单个任务详情（含 findings）
    const task = getHuntTaskById(Number(taskId));
    if (!task) {
      return Response.json({ error: "任务不存在" }, { status: 404 });
    }
    const findings = getHuntFindingsByTaskId(Number(taskId));
    return Response.json({ task, findings });
  }

  // 获取所有任务
  const tasks = getAllHuntTasks();
  return Response.json(tasks);
}

/**
 * DELETE /api/hunt/tasks?id=xxx
 * 删除扫描任务（含关联 findings），支持中断正在运行的任务
 */
export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("id");

  if (!taskId) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }

  try {
    // 先中断运行中的任务
    const id = Number(taskId);
    abortTask(id);
    updateHuntTask(id, { status: "failed", error: "用户手动删除" });
    // 然后删除数据库记录
    deleteHuntTask(id);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 500 }
    );
  }
}
