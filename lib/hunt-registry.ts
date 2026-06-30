/**
 * 扫描任务中断注册表
 * 用于在 scan/route.ts 和 tasks/route.ts 之间共享运行状态
 */

export const activeTasks = new Map<number, { aborted: boolean }>();

/**
 * 中断指定任务
 */
export function abortTask(taskId: number): boolean {
  const ctrl = activeTasks.get(taskId);
  if (ctrl) {
    ctrl.aborted = true;
    return true;
  }
  return false;
}

/**
 * 注册新任务
 */
export function registerTask(taskId: number): void {
  activeTasks.set(taskId, { aborted: false });
}

/**
 * 注销任务
 */
export function unregisterTask(taskId: number): void {
  activeTasks.delete(taskId);
}

/**
 * 检查任务是否正在运行
 */
export function isTaskRunning(taskId: number): boolean {
  const ctrl = activeTasks.get(taskId);
  return !!ctrl && !ctrl.aborted;
}
