/**
 * 分组数据模块
 *
 * 用于分组 Dashboard 页面，从 SQLite 数据库加载分组信息。
 */
import {getDistinctGroupNames, initDb} from "../db";
import type {
  AvailabilityPeriod,
  AvailabilityStatsMap,
  ProviderTimeline,
} from "../types";
import { UNGROUPED_KEY } from "../types";

/**
 * 分组 Dashboard 数据结构
 */
export interface GroupDashboardData {
  groupName: string;
  displayName: string;
  tags: string;
  providerTimelines: ProviderTimeline[];
  lastUpdated: string | null;
  total: number;
  pollIntervalLabel: string;
  pollIntervalMs: number;
  availabilityStats: AvailabilityStatsMap;
  trendPeriod: AvailabilityPeriod;
  generatedAt: number;
  websiteUrl?: string | null;
}

/**
 * 获取所有可用的分组名称
 * 从 SQLite 数据库读取
 */
export async function getAvailableGroups(): Promise<string[]> {
  // 确保数据库已初始化
  initDb();
  return getDistinctGroupNames();
}
