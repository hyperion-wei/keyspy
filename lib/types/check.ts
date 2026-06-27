/**
 * 健康检查相关类型定义
 */

import type {ProviderType} from "./provider";
import type {OfficialStatusResult} from "./official-status";

/**
 * Provider 健康状态
 */
export type HealthStatus = "operational" | "degraded" | "failed" | "validation_failed" | "maintenance" | "error";

/**
 * 单次检查结果
 */
export interface CheckResult {
  id: string; // config_id from database
  name: string;
  type: ProviderType;
  endpoint: string;
  model: string;
  /** 当前实际可用的模型（自动降级后），空表示未运行过检测 */
  activeModel?: string;
  /** 是否发生了自动降级（首选 model 与 activeModel 不同） */
  isFallback?: boolean;
  status: HealthStatus;
  latencyMs: number | null; // 对话首字延迟
  pingLatencyMs: number | null; // 端点 Ping 延迟
  checkedAt: string; // ISO 8601 timestamp
  message: string;
  logMessage?: string;
  officialStatus?: OfficialStatusResult; // 官方服务状态(可选)
  groupName?: string | null; // 分组名称
}
