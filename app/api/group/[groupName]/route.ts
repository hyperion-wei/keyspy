import { NextResponse } from "next/server";
import {
  initDb,
  getMonitorConfigsByGroup,
  getPollIntervalSeconds,
  formatPollInterval,
  getRecentHistory,
  getAvailabilityStats,
} from "@/lib/db";
import type { ProviderTimeline, CheckResult, AvailabilityPeriod, AvailabilityStatsMap } from "@/lib/types";

initDb();

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ groupName: string }> }
) {
  const { groupName } = await context.params;
  const decoded = decodeURIComponent(groupName);

  // 支持 trendPeriod 参数
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("trendPeriod");
  const trendPeriod = (["7d", "15d", "30d"].includes(period as string)
    ? period
    : "7d") as AvailabilityPeriod;

  const configs = getMonitorConfigsByGroup(decoded);

  if (configs.length === 0) {
    return NextResponse.json(
      { error: `分组 "${decoded}" 暂无监控配置` },
      { status: 404 }
    );
  }

  const configMap = new Map(configs.map((c) => [c.id, c]));
  const configIds = configs.map((c) => c.id);

  // 读取真实历史
  const historyRows = getRecentHistory(60);

  // 按 config_id 分组（只保留该分组的配置）
  const historyByConfig = new Map<number, CheckResult[]>();
  for (const row of historyRows) {
    const config = configMap.get(row.config_id);
    if (!config) continue;

    const activeModel = config.active_model || "";
    const isFallback = !!activeModel && activeModel !== config.model;
    const checkResult: CheckResult = {
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

    const existing = historyByConfig.get(row.config_id) || [];
    existing.push(checkResult);
    historyByConfig.set(row.config_id, existing);
  }

  // 构建 providerTimelines
  const providerTimelines: ProviderTimeline[] = [];

  for (const config of configs) {
    const items = historyByConfig.get(config.id);

    if (items && items.length > 0) {
      items.sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
      providerTimelines.push({
        id: String(config.id),
        items,
        latest: items[0],
      });
    } else {
      const placeholder: CheckResult = {
        id: String(config.id),
        name: config.name,
        type: (config.type as "openai" | "gemini" | "anthropic") || "openai",
        endpoint: config.base_url,
        model: config.model,
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

  // 可用性统计
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

  const data = {
    groupName: decoded,
    displayName: decoded,
    tags: "",
    providerTimelines,
    lastUpdated,
    total: providerTimelines.length,
    pollIntervalLabel: formatPollInterval(pollSeconds),
    pollIntervalMs: pollSeconds * 1000,
    availabilityStats,
    trendPeriod,
    generatedAt: Date.now(),
    websiteUrl: null,
  };

  return NextResponse.json(data);
}
