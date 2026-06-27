/**
 * AI Agent 工具定义
 *
 * 这些工具供 LLM Agent 调用，用于管理监控配置。
 * 每个工具都有明确的输入、输出和执行逻辑。
 */

import { tool } from "ai";
import { z } from "zod";
import {
  getAllMonitorConfigs,
  getMonitorConfigById,
  updateMonitorConfig,
  deleteMonitorConfig,
  getAvailabilityStats,
  getRecentHistory,
} from "@/lib/db";

// ========== list_monitors ==========

export const listMonitorsTool = tool({
  description: "列出所有监控配置，包括名称、类型、URL、模型、分组、状态等信息",
  inputSchema: z.object({}),
  execute: async () => {
    const configs = getAllMonitorConfigs();
    return {
      success: true,
      total: configs.length,
      monitors: configs.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        base_url: c.base_url,
        model: c.model,
        active_model: c.active_model || c.model,
        group_name: c.group_name || "(无分组)",
        enabled: c.enabled === 1,
        template_id: c.template_id,
        created_at: c.created_at,
      })),
    };
  },
});

// ========== get_monitor ==========

export const getMonitorTool = tool({
  description: "获取单个监控配置的详细信息",
  inputSchema: z.object({
    id: z.number().describe("监控配置 ID"),
  }),
  execute: async ({ id }) => {
    const config = getMonitorConfigById(id);
    if (!config) {
      return { success: false, error: "配置不存在" };
    }
    return {
      success: true,
      monitor: {
        id: config.id,
        name: config.name,
        type: config.type,
        base_url: config.base_url,
        api_key: config.api_key.slice(0, 8) + "••••••",
        model: config.model,
        active_model: config.active_model || config.model,
        fallback_models: config.fallback_models,
        group_name: config.group_name || "(无分组)",
        enabled: config.enabled === 1,
        template_id: config.template_id,
        created_at: config.created_at,
        updated_at: config.updated_at,
      },
    };
  },
});

// ========== toggle_monitor ==========

export const toggleMonitorTool = tool({
  description: "启用或停用监控配置",
  inputSchema: z.object({
    id: z.number().describe("监控配置 ID"),
    enabled: z.boolean().describe("是否启用"),
  }),
  execute: async ({ id, enabled }) => {
    const result = updateMonitorConfig(id, { enabled: enabled ? 1 : 0 });
    if (!result) {
      return { success: false, error: "配置不存在" };
    }
    return {
      success: true,
      message: `监控配置 "${result.name}" 已${enabled ? "启用" : "停用"}`,
      id: result.id,
      name: result.name,
      enabled: result.enabled === 1,
    };
  },
});

// ========== delete_monitor ==========

export const deleteMonitorTool = tool({
  description: "删除监控配置（操作不可撤销，请谨慎使用）",
  inputSchema: z.object({
    id: z.number().describe("监控配置 ID"),
  }),
  execute: async ({ id }) => {
    const config = getMonitorConfigById(id);
    if (!config) {
      return { success: false, error: "配置不存在" };
    }
    const name = config.name;
    const success = deleteMonitorConfig(id);
    if (!success) {
      return { success: false, error: "删除失败" };
    }
    return {
      success: true,
      message: `监控配置 "${name}" 已删除`,
      id,
      name,
    };
  },
});

// ========== get_stats ==========

export const getStatsTool = tool({
  description: "获取监控配置的可用性统计数据",
  inputSchema: z.object({
    id: z.number().describe("监控配置 ID"),
    period: z.enum(["7d", "15d", "30d"]).default("7d").describe("统计周期"),
  }),
  execute: async ({ id, period }) => {
    const config = getMonitorConfigById(id);
    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    const stats = getAvailabilityStats([id], period);
    const stat = stats[String(id)];

    // 获取最近的检测记录
    const history = getRecentHistory(10).filter((h) => h.config_id === id);
    const recentChecks = history.slice(0, 5).map((h) => ({
      status: h.status,
      latency_ms: h.latency_ms,
      checked_at: h.checked_at,
      message: h.message,
    }));

    return {
      success: true,
      name: config.name,
      id: config.id,
      period,
      availability: stat
        ? {
            totalChecks: stat.totalChecks,
            operationalCount: stat.operationalCount,
            availabilityPct: stat.availabilityPct,
          }
        : { totalChecks: 0, operationalCount: 0, availabilityPct: null },
      recentChecks,
    };
  },
});

// ========== get_all_stats ==========

export const getAllStatsTool = tool({
  description: "获取所有监控配置的可用性统计概览",
  inputSchema: z.object({
    period: z.enum(["7d", "15d", "30d"]).default("7d").describe("统计周期"),
  }),
  execute: async ({ period }) => {
    const configs = getAllMonitorConfigs();
    const configIds = configs.map((c) => c.id);
    const stats = getAvailabilityStats(configIds, period);

    const summaries = configs.map((c) => {
      const stat = stats[String(c.id)];
      return {
        id: c.id,
        name: c.name,
        enabled: c.enabled === 1,
        availabilityPct: stat?.availabilityPct ?? null,
        totalChecks: stat?.totalChecks ?? 0,
      };
    });

    // 按可用性排序
    summaries.sort((a, b) => (b.availabilityPct ?? -1) - (a.availabilityPct ?? -1));

    return {
      success: true,
      period,
      total: configs.length,
      enabled: configs.filter((c) => c.enabled === 1).length,
      disabled: configs.filter((c) => c.enabled !== 1).length,
      summaries,
    };
  },
});

// 导出所有工具
export const agentTools = {
  list_monitors: listMonitorsTool,
  get_monitor: getMonitorTool,
  toggle_monitor: toggleMonitorTool,
  delete_monitor: deleteMonitorTool,
  get_stats: getStatsTool,
  get_all_stats: getAllStatsTool,
};
