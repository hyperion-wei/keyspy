import { NextResponse } from "next/server";
import {
  initDb,
  getAllMonitorConfigs,
  getPollIntervalSeconds,
  formatPollInterval,
  getRecentHistory,
  getAvailabilityStats,
} from "@/lib/db";
import type {
  DashboardData,
  ProviderTimeline,
  CheckResult,
  AvailabilityPeriod,
  AvailabilityStatsMap,
  GroupInfoSummary,
} from "@/lib/types";

initDb();

export const revalidate = 0;
export const dynamic = "force-dynamic";

/** 将 SQLite check_history 行转为 CheckResult */
function historyRowToCheckResult(
  row: { config_id: number; status: string; latency_ms: number | null; ping_latency_ms: number | null; checked_at: string; message: string | null },
  config: { name: string; type: string; base_url: string; model: string; group_name: string; active_model?: string }
): CheckResult {
  const activeModel = config.active_model || "";
  const isFallback = !!activeModel && activeModel !== config.model;
  return {
    id: String(row.config_id),
    name: config.name,
    type: (config.type as "openai" | "gemini" | "anthropic") || "openai",
    endpoint: config.base_url,
    model: activeModel || config.model,
    activeModel: activeModel || undefined,
    isFallback,
    status: row.status as CheckResult["status"],
    latencyMs: row.latency_ms,
    pingLatencyMs: row.ping_latency_ms,
    checkedAt: row.checked_at,
    message: row.message || "",
    groupName: config.group_name || null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("trendPeriod");
  const trendPeriod = (["7d", "15d", "30d"].includes(period as string)
    ? period
    : "7d") as AvailabilityPeriod;

  const configs = getAllMonitorConfigs();
  const configMap = new Map(configs.map((c) => [c.id, c]));

  // 从 check_history 读取真实数据
  const historyRows = getRecentHistory(60);

  // 按 config_id 分组
  const historyByConfig = new Map<number, CheckResult[]>();
  for (const row of historyRows) {
    const config = configMap.get(row.config_id);
    if (!config) continue;

    const checkResult = historyRowToCheckResult(row, config);
    const existing = historyByConfig.get(row.config_id) || [];
    existing.push(checkResult);
    historyByConfig.set(row.config_id, existing);
  }

  // 构建 providerTimelines
  const providerTimelines: ProviderTimeline[] = [];

  for (const config of configs) {
    const items = historyByConfig.get(config.id);

    if (items && items.length > 0) {
      // 按 checkedAt 倒序排序
      items.sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
      providerTimelines.push({
        id: String(config.id),
        items,
        latest: items[0],
      });
    } else {
      // 无历史记录，生成占位项
      const activeModel = config.active_model || "";
      const isFallback = !!activeModel && activeModel !== config.model;
      const placeholder: CheckResult = {
        id: String(config.id),
        name: config.name,
        type: (config.type as "openai" | "gemini" | "anthropic") || "openai",
        endpoint: config.base_url,
        model: activeModel || config.model,
        activeModel: activeModel || undefined,
        isFallback,
        status: config.enabled ? "operational" : "maintenance",
        latencyMs: null,
        pingLatencyMs: null,
        checkedAt: config.updated_at || config.created_at,
        message: config.enabled ? "等待首次检测" : "已停用",
        groupName: config.group_name || null,
      };
      providerTimelines.push({
        id: String(config.id),
        items: [placeholder],
        latest: placeholder,
      });
    }
  }

  // 按名称排序
  providerTimelines.sort((a, b) => a.latest.name.localeCompare(b.latest.name));

  // 计算 lastUpdated
  let lastUpdated: string | null = null;
  let lastUpdatedMs = 0;
  for (const timeline of providerTimelines) {
    const ms = Date.parse(timeline.latest.checkedAt);
    if (Number.isFinite(ms) && ms > lastUpdatedMs) {
      lastUpdatedMs = ms;
      lastUpdated = timeline.latest.checkedAt;
    }
  }

  // 按 group_name 汇总
  const groupInfos: GroupInfoSummary[] = [];
  const seenGroups = new Set<string>();
  for (const config of configs) {
    const gn = config.group_name || "";
    if (gn && !seenGroups.has(gn)) {
      seenGroups.add(gn);
      groupInfos.push({ groupName: gn, websiteUrl: null, tags: "" });
    }
  }

  // 计算可用性统计
  const configIds = configs.map((c) => c.id);
  const rawStats = getAvailabilityStats(configIds, trendPeriod);

  const availabilityStats: AvailabilityStatsMap = {};
  for (const [configIdStr, stat] of Object.entries(rawStats)) {
    availabilityStats[configIdStr] = [
      {
        period: trendPeriod,
        totalChecks: stat.totalChecks,
        operationalCount: stat.operationalCount,
        availabilityPct: stat.availabilityPct,
      },
    ];
  }

  const pollSeconds = getPollIntervalSeconds();

  const data: DashboardData = {
    providerTimelines,
    groupInfos,
    lastUpdated,
    total: providerTimelines.length,
    pollIntervalLabel: formatPollInterval(pollSeconds),
    pollIntervalMs: pollSeconds * 1000,
    availabilityStats,
    trendPeriod,
    generatedAt: Date.now(),
  };

  // ETag 支持
  const jsonBody = JSON.stringify(data);
  let hash = 5381;
  for (let i = 0; i < jsonBody.length; i++) {
    hash = ((hash << 5) + hash) ^ jsonBody.charCodeAt(i);
  }
  const etag = `"${(hash >>> 0).toString(16)}"`;

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "public, no-cache");
  response.headers.set("ETag", etag);
  response.headers.set("Vary", "Accept-Encoding");
  return response;
}
