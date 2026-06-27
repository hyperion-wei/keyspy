/**
 * 后台轮询器
 *
 * 单实例模式（无需分布式锁）：
 * - 通过 instrumentation.ts 在 Next.js 启动时自动运行
 * - setInterval 按 pollIntervalSeconds 定时执行 tick()
 * - tick() 读取所有启用的 monitor_configs -> 并发检测 -> 写入 history -> 清理旧数据
 * - 防并发：上一轮未完成则跳过
 */

import { initDb, getAllMonitorConfigs, getPollIntervalSeconds, appendCheckHistory, pruneCheckHistory } from "./db";
import { runApiChecks } from "./checker";
import type { ApiCheckResult } from "./checker";

/** 默认轮询间隔（毫秒），会被 getPollIntervalSeconds() 动态覆盖 */
const MIN_POLL_INTERVAL_MS = 10_000;

/** 是否正在运行 */
let isRunning = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastStartedAt: number | null = null;

const FAILURE_STATUSES = new Set(["failed", "error"]);

function formatDuration(ms: number | null): string {
  return ms !== null ? `${ms}ms` : "N/A";
}

function logFailedResults(results: ApiCheckResult[]): void {
  const failed = results.filter((r) => FAILURE_STATUSES.has(r.status));
  if (failed.length === 0) return;

  console.error(`[check-cx-ui] 本轮检测失败：${failed.length}/${results.length} 条`);
  for (const r of failed.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(
      `[check-cx-ui]   - ${r.name} (${r.type}/${r.model}) -> ${r.status} | latency=${formatDuration(r.latency_ms)} | ping=${formatDuration(r.ping_latency_ms)} | ${r.endpoint}`
    );
    if (r.message) {
      console.error(`[check-cx-ui]     message: ${r.message}`);
    }
  }
}

/**
 * 执行一次检测轮询
 */
async function tick(): Promise<void> {
  // 防并发
  if (isRunning) {
    const duration = lastStartedAt ? Date.now() - lastStartedAt : null;
    console.log(
      `[check-cx-ui] 跳过本轮：上一轮仍在执行${duration !== null ? `（已耗时 ${duration}ms）` : ""}`
    );
    return;
  }

  isRunning = true;
  lastStartedAt = Date.now();

  try {
    // 初始化数据库（确保表存在）
    initDb();

    // 加载启用的配置
    const allConfigs = getAllMonitorConfigs();
    const configs = allConfigs.filter((c) => c.enabled);

    if (configs.length === 0) {
      return;
    }

    // 批量检测
    const results = await runApiChecks(configs);

    // 写入历史
    const historyInputs = results.map((r) => ({
      config_id: r.config_id,
      status: r.status,
      latency_ms: r.latency_ms,
      ping_latency_ms: r.ping_latency_ms,
      message: r.message,
    }));
    appendCheckHistory(historyInputs);

    // 清理旧数据（每次检测后清理）
    pruneCheckHistory(30);

    // 日志输出失败结果
    logFailedResults(results);

    console.log(
      `[check-cx-ui] 检测完成：${results.length} 条，耗时 ${Date.now() - lastStartedAt}ms`
    );
  } catch (error) {
    console.error("[check-cx-ui] 轮询检测失败", error);
  } finally {
    isRunning = false;
  }
}

/**
 * 启动轮询器
 */
function startPoller(): void {
  if (timer !== null) {
    console.log("[check-cx-ui] 轮询器已在运行，跳过重复启动");
    return;
  }

  const intervalSeconds = getPollIntervalSeconds();
  const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, intervalSeconds * 1000);

  console.log(
    `[check-cx-ui] 启动后台轮询器，间隔 ${intervalSeconds}s (${intervalMs}ms)`
  );

  // 启动后立即执行一次
  tick().catch((error) => console.error("[check-cx-ui] 首次检测失败", error));

  // 定时执行
  timer = setInterval(() => {
    tick().catch((error) => console.error("[check-cx-ui] 定时检测失败", error));
  }, intervalMs);
}

// 模块加载时自动启动后台轮询器。
// 使用 globalThis 标志防止多 worker / 热重载时重复启动。
// 通过 setImmediate 推到下一个事件循环，确保 poller 在 db 模块完全加载后再启动。
declare global {
  // eslint-disable-next-line no-var
  var __checkCxUiPollerStarted: boolean | undefined;
}

if (
  process.env.NEXT_RUNTIME === "nodejs" &&
  process.env.NODE_ENV !== "test" &&
  typeof window === "undefined" &&
  !globalThis.__checkCxUiPollerStarted
) {
  globalThis.__checkCxUiPollerStarted = true;
  setImmediate(() => {
    try {
      startPoller();
    } catch (error) {
      console.error("[check-cx-ui] 启动后台轮询器失败", error);
    }
  });
}

export { startPoller, tick };
