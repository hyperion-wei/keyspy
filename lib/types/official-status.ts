/**
 * 官方状态类型定义
 * 用于检查 AI Provider 官方服务状态
 */

/**
 * 官方健康状态
 */
export type OfficialHealthStatus =
  | "operational" // 正常运行
  | "degraded" // 性能降级
  | "down" // 服务故障
  | "unknown"; // 未知状态(检查失败或未配置)

/**
 * 官方状态检查结果
 */
export interface OfficialStatusResult {
  /** 状态 */
  status: OfficialHealthStatus;
  /** 状态描述信息 */
  message: string;
  /** 检查时间 (ISO 8601) */
  checkedAt: string;
  /** 受影响的组件列表 (可选) */
  affectedComponents?: string[];
}
