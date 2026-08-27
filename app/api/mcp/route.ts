import { initDb, findEnabledMcpToken, touchMcpToken } from "@/lib/db";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ============================================================
// KeySpy MCP Server — Streamable HTTP（无状态 JSON-RPC 2.0）
//
// 客户端配置示例：
// {
//   "mcpServers": {
//     "keyspy": {
//       "url": "http://<host>:<port>/api/mcp",
//       "headers": { "Authorization": "Bearer keyspy_mcp_xxx" }
//     }
//   }
// }
//
// 工具通过内部 HTTP 调用复用各 REST 路由的完整业务逻辑，
// 以 MCP Token 创建者的身份执行；不包含管理员（账户）功能。
// ============================================================

const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "keyspy", version: "1.0.0" };

// ====== JSON-RPC 基础类型 ======

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
}

// ====== 内部 API 调用（复用 REST 路由业务逻辑）======

interface DelegateCtx {
  baseUrl: string;
  authHeader: string;
}

async function callApi(
  ctx: DelegateCtx,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: ctx.authHeader,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${
        data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : JSON.stringify(data)
      }`
    );
  }
  return data;
}

const apiGet = (ctx: DelegateCtx, path: string) => callApi(ctx, "GET", path);
const apiPost = (ctx: DelegateCtx, path: string, body: Record<string, unknown>) => callApi(ctx, "POST", path, body);
const apiPut = (ctx: DelegateCtx, path: string, body: Record<string, unknown>) => callApi(ctx, "PUT", path, body);
const apiDelete = (ctx: DelegateCtx, path: string) => callApi(ctx, "DELETE", path);

// ====== 结果精简（控制返回给 LLM 的体积）======

type Summarizer = (data: unknown) => unknown;

/** 监控配置 → 摘要 */
function sumConfig(c: Record<string, unknown>): Record<string, unknown> {
  const active = (c.active_model as string) || "";
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    base_url: c.base_url,
    model: active || c.model,
    is_fallback: !!active && active !== c.model,
    group_name: c.group_name,
    enabled: c.enabled === 1 || c.enabled === true,
  };
}

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

const summarizers: Record<string, Summarizer> = {
  "GET /api/monitors": (d) => {
    const list = Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
    return { total: list.length, monitors: list.map(sumConfig) };
  },

  "GET /api/dashboard": (d) => {
    const data = d as Record<string, unknown>;
    const timelines = (data.providerTimelines as Array<Record<string, unknown>>) || [];
    return {
      total: data.total,
      lastUpdated: data.lastUpdated,
      pollIntervalLabel: data.pollIntervalLabel,
      trendPeriod: data.trendPeriod,
      groups: ((data.groupInfos as Array<Record<string, unknown>>) || []).map((g) => g.groupName),
      monitors: timelines.map((t) => {
        const latest = (t.latest as Record<string, unknown>) || {};
        const items = (t.items as Array<Record<string, unknown>>) || [];
        return {
          id: t.id,
          name: latest.name,
          status: latest.status,
          model: latest.model,
          latency_ms: latest.latencyMs,
          checked_at: latest.checkedAt,
          message: latest.message,
          recent_checks: items.slice(0, 5).map((i) => ({
            status: i.status,
            latency_ms: i.latencyMs,
            checked_at: i.checkedAt,
          })),
        };
      }),
    };
  },

  "GET /api/hunt/tasks": (d) => {
    const list = Array.isArray(d) ? (d as Record<string, unknown>[]) : [];
    return {
      total: list.length,
      tasks: list.map((t) =>
        pick(t, ["id", "status", "total", "completed", "findings_count", "error", "created_at", "updated_at"])
      ),
    };
  },

  "GET /api/hunt/tasks?id=": (d) => {
    const data = d as Record<string, unknown>;
    const task = (data.task as Record<string, unknown>) || {};
    const findings = (data.findings as Array<Record<string, unknown>>) || [];
    return {
      task: pick(task, ["id", "status", "total", "completed", "findings_count", "error", "created_at"]),
      findings: findings.map((f) =>
        pick(f, ["id", "finding_type", "key_value", "provider", "model", "base_url", "confidence", "target_url"])
      ),
    };
  },

  "GET /api/hunt/results": (d) => {
    const data = d as Record<string, unknown>;
    const findings = (data.findings as Array<Record<string, unknown>>) || [];
    return {
      total: data.total,
      findings: findings.map((f) =>
        pick(f, [
          "id", "finding_type", "key_value", "provider", "model", "base_url",
          "confidence", "added_to_monitor", "target_url", "created_at",
        ])
      ),
    };
  },
};

function summarize(toolKey: string, data: unknown): unknown {
  const fn = summarizers[toolKey];
  return fn ? fn(data) : data;
}

// ====== 工具定义 ======

type ToolHandler = (args: Record<string, unknown>, ctx: DelegateCtx) => Promise<unknown>;

interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle: ToolHandler;
}

/** 快速构建 JSON Schema 对象类型 */
function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required };
}
const t = {
  str: (description: string) => ({ type: "string", description }),
  num: (description: string) => ({ type: "number", description }),
  int: (description: string) => ({ type: "integer", description }),
  bool: (description: string) => ({ type: "boolean", description }),
  enumStr: (description: string, values: string[]) => ({ type: "string", description, enum: values }),
};

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // ---- 仪表盘 / 分组 ----
  keyspy_get_dashboard: (args, ctx) =>
    apiGet(ctx, `/api/dashboard?trendPeriod=${encodeURIComponent(String(args.trendPeriod || "7d"))}`),
  keyspy_get_group: (args, ctx) =>
    apiGet(
      ctx,
      `/api/group/${encodeURIComponent(String(args.groupName))}?trendPeriod=${encodeURIComponent(String(args.trendPeriod || "7d"))}`
    ),

  // ---- 监控配置 ----
  keyspy_list_monitors: (_args, ctx) => apiGet(ctx, "/api/monitors"),
  keyspy_get_monitor: (args, ctx) => apiGet(ctx, `/api/monitors/${Number(args.id)}`),
  keyspy_create_monitor: (args, ctx) => apiPost(ctx, "/api/monitors", args),
  keyspy_create_monitors_batch: (args, ctx) => apiPost(ctx, "/api/monitors", args),
  keyspy_update_monitor: (args, ctx) => {
    const { id, ...updates } = args;
    return apiPut(ctx, `/api/monitors/${Number(id)}`, updates);
  },
  keyspy_delete_monitor: (args, ctx) => apiDelete(ctx, `/api/monitors/${Number(args.id)}`),
  keyspy_sync_monitor_models: (args, ctx) => apiPost(ctx, `/api/monitors/${Number(args.id)}/sync-models`, {}),
  keyspy_list_key_models: (args, ctx) => apiPost(ctx, "/api/models/list", args),

  // ---- 模板 ----
  keyspy_list_templates: (_args, ctx) => apiGet(ctx, "/api/templates"),
  keyspy_get_template: (args, ctx) => apiGet(ctx, `/api/templates/${Number(args.id)}`),
  keyspy_create_template: (args, ctx) => apiPost(ctx, "/api/templates", args),
  keyspy_update_template: (args, ctx) => {
    const { id, ...updates } = args;
    return apiPut(ctx, `/api/templates/${Number(id)}`, updates);
  },
  keyspy_delete_template: (args, ctx) => apiDelete(ctx, `/api/templates/${Number(args.id)}`),

  // ---- Hunt 扫描 ----
  keyspy_hunt_start_scan: (args, ctx) => apiPost(ctx, "/api/hunt/scan", args),
  keyspy_hunt_abort_scan: (args, ctx) => apiPut(ctx, "/api/hunt/scan", { taskId: Number(args.taskId), action: "abort" }),
  keyspy_hunt_list_tasks: (_args, ctx) => apiGet(ctx, "/api/hunt/tasks"),
  keyspy_hunt_get_task: (args, ctx) => apiGet(ctx, `/api/hunt/tasks?id=${Number(args.taskId)}`),
  keyspy_hunt_list_results: (args, ctx) => {
    const params = new URLSearchParams();
    if (args.taskId !== undefined) params.set("taskId", String(args.taskId));
    if (args.limit !== undefined) params.set("limit", String(args.limit));
    if (args.offset !== undefined) params.set("offset", String(args.offset));
    const qs = params.toString();
    return apiGet(ctx, `/api/hunt/results${qs ? `?${qs}` : ""}`);
  },
  keyspy_hunt_add_result_to_monitor: (args, ctx) => apiPost(ctx, "/api/hunt/results", args),
  keyspy_hunt_delete_result: (args, ctx) =>
    apiDelete(ctx, `/api/hunt/results?id=${Number(args.id)}&action=${encodeURIComponent(String(args.action || "delete"))}`),
  keyspy_hunt_test_key: (args, ctx) => apiPost(ctx, "/api/hunt/test", args),
  keyspy_hunt_test_key_all_templates: (args, ctx) => apiPost(ctx, "/api/hunt/test-all", args),
  keyspy_hunt_parse_targets: (args, ctx) => apiPost(ctx, "/api/hunt/parse", args),
  keyspy_hunt_delete_source: (args, ctx) => apiPost(ctx, "/api/hunt/delete-source", args),

  // ---- 聊天 LLM 配置 ----
  keyspy_list_chat_settings: (_args, ctx) => apiGet(ctx, "/api/chat-settings"),
  keyspy_create_chat_setting: (args, ctx) => apiPost(ctx, "/api/chat-settings", args),
  keyspy_update_chat_setting: (args, ctx) => {
    const { id, ...updates } = args;
    return apiPut(ctx, `/api/chat-settings/${Number(id)}`, updates);
  },
  keyspy_delete_chat_setting: (args, ctx) => apiDelete(ctx, `/api/chat-settings/${Number(args.id)}`),

  // ---- 系统设置 ----
  keyspy_get_settings: (_args, ctx) => apiGet(ctx, "/api/settings"),
  keyspy_update_settings: (args, ctx) => apiPut(ctx, "/api/settings", args),
};

/** 工具 → 内部端点映射键（用于结果精简） */
const TOOL_SUMMARY_KEY: Record<string, string> = {
  keyspy_list_monitors: "GET /api/monitors",
  keyspy_get_dashboard: "GET /api/dashboard",
  keyspy_hunt_list_tasks: "GET /api/hunt/tasks",
  keyspy_hunt_get_task: "GET /api/hunt/tasks?id=",
  keyspy_hunt_list_results: "GET /api/hunt/results",
};

const TOOLS: McpTool[] = [
  {
    name: "keyspy_get_dashboard",
    title: "获取仪表盘概览",
    description:
      "获取所有监控端点的最新状态、延迟、检测时间线和可用性统计。可选 trendPeriod 指定可用性统计周期。",
    inputSchema: schema({ trendPeriod: t.enumStr("可用性统计周期，默认 7d", ["7d", "15d", "30d"]) }),
    handle: TOOL_HANDLERS.keyspy_get_dashboard,
  },
  {
    name: "keyspy_get_group",
    title: "获取分组视图",
    description: "按分组名获取该分组下所有监控的状态时间线和可用性统计。",
    inputSchema: schema(
      {
        groupName: t.str("分组名称"),
        trendPeriod: t.enumStr("可用性统计周期，默认 7d", ["7d", "15d", "30d"]),
      },
      ["groupName"]
    ),
    handle: TOOL_HANDLERS.keyspy_get_group,
  },
  {
    name: "keyspy_list_monitors",
    title: "列出监控配置",
    description: "列出全部监控配置（id、名称、类型、地址、模型、分组、启用状态）。",
    inputSchema: schema({}),
    handle: TOOL_HANDLERS.keyspy_list_monitors,
  },
  {
    name: "keyspy_get_monitor",
    title: "查看监控配置详情",
    description: "获取单个监控配置的完整详情，包含降级模型链与全量模型列表。",
    inputSchema: schema({ id: t.int("监控配置 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_get_monitor,
  },
  {
    name: "keyspy_create_monitor",
    title: "创建监控配置",
    description: "创建单个监控配置。fetch_models=true 时服务端会拉取 /v1/models 自动构建降级模型链。",
    inputSchema: schema(
      {
        name: t.str("监控名称"),
        base_url: t.str("API 端点地址"),
        api_key: t.str("API Key"),
        model: t.str("首选模型"),
        type: t.enumStr("协议类型，默认 openai", ["openai", "anthropic", "gemini"]),
        group_name: t.str("分组名称，可选"),
        enabled: t.bool("是否启用，默认 true"),
        fetch_models: t.bool("是否拉取全量模型构建降级链，默认 false"),
      },
      ["name", "base_url", "api_key", "model"]
    ),
    handle: TOOL_HANDLERS.keyspy_create_monitor,
  },
  {
    name: "keyspy_create_monitors_batch",
    title: "按模板批量创建监控",
    description:
      "基于模板批量创建监控：对每个 API Key 先并发测试模板内全部模型，自动选择可用模型，全部失败的 Key 会被跳过。耗时较长。",
    inputSchema: schema(
      {
        template_id: t.int("模板 ID（先用 keyspy_list_templates 查询）"),
        api_keys: { type: "array", items: { type: "string" }, description: "API Key 列表" },
        group_name: t.str("分组名称，可选"),
        name_prefix: t.str("监控名称前缀，默认模板名"),
        test_models: t.bool("是否先测试模型，默认 true"),
        fetch_models: t.bool("是否同时拉取全量模型，默认 false"),
      },
      ["template_id", "api_keys"]
    ),
    handle: TOOL_HANDLERS.keyspy_create_monitors_batch,
  },
  {
    name: "keyspy_update_monitor",
    title: "更新监控配置",
    description: "更新监控配置的任意字段（部分更新），如 name、model、group_name、enabled 等。",
    inputSchema: schema({
      id: t.int("监控配置 ID"),
      name: t.str("监控名称"),
      base_url: t.str("API 端点地址"),
      api_key: t.str("API Key"),
      model: t.str("首选模型"),
      type: t.enumStr("协议类型", ["openai", "anthropic", "gemini"]),
      group_name: t.str("分组名称"),
      enabled: t.bool("是否启用"),
    }),
    handle: TOOL_HANDLERS.keyspy_update_monitor,
  },
  {
    name: "keyspy_delete_monitor",
    title: "删除监控配置",
    description: "删除指定监控配置，不可恢复。删除前建议先用 keyspy_get_monitor 确认目标。",
    inputSchema: schema({ id: t.int("监控配置 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_delete_monitor,
  },
  {
    name: "keyspy_sync_monitor_models",
    title: "同步监控的全量模型",
    description: "重新拉取该监控 Key 名下的全量模型列表，首选模型仍在列表中时重建降级链。",
    inputSchema: schema({ id: t.int("监控配置 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_sync_monitor_models,
  },
  {
    name: "keyspy_list_key_models",
    title: "查询 Key 可用模型列表",
    description: "调用目标 /v1/models 接口，获取某个 API Key 名下的全量模型列表。",
    inputSchema: schema(
      {
        base_url: t.str("API 地址（可只填到 /v1）"),
        api_key: t.str("API Key"),
        type: t.enumStr("协议类型，默认 openai", ["openai", "anthropic", "gemini"]),
      },
      ["base_url", "api_key"]
    ),
    handle: TOOL_HANDLERS.keyspy_list_key_models,
  },
  {
    name: "keyspy_list_templates",
    title: "列出监控模板",
    description: "列出全部监控模板（含内置模板与自定义模板）。",
    inputSchema: schema({}),
    handle: TOOL_HANDLERS.keyspy_list_templates,
  },
  {
    name: "keyspy_get_template",
    title: "查看模板详情",
    description: "获取单个模板的完整信息。",
    inputSchema: schema({ id: t.int("模板 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_get_template,
  },
  {
    name: "keyspy_create_template",
    title: "创建监控模板",
    description: "创建可复用的监控模板。default_model 必须包含在 models 列表中。",
    inputSchema: schema(
      {
        name: t.str("模板名称（唯一）"),
        base_url: t.str("API 端点地址"),
        models: { type: "array", items: { type: "string" }, description: "模型列表" },
        default_model: t.str("默认模型"),
        type: t.enumStr("协议类型，默认 openai", ["openai", "anthropic", "gemini"]),
        description: t.str("模板描述，可选"),
      },
      ["name", "base_url", "models", "default_model"]
    ),
    handle: TOOL_HANDLERS.keyspy_create_template,
  },
  {
    name: "keyspy_update_template",
    title: "更新监控模板",
    description: "局部更新模板字段。更新后 default_model 仍必须在 models 列表中。",
    inputSchema: schema({
      id: t.int("模板 ID"),
      name: t.str("模板名称"),
      base_url: t.str("API 端点地址"),
      models: { type: "array", items: { type: "string" }, description: "模型列表" },
      default_model: t.str("默认模型"),
      type: t.enumStr("协议类型", ["openai", "anthropic", "gemini"]),
      description: t.str("模板描述"),
    }),
    handle: TOOL_HANDLERS.keyspy_update_template,
  },
  {
    name: "keyspy_delete_template",
    title: "删除监控模板",
    description: "删除模板。内置模板或被监控引用的模板无法删除。",
    inputSchema: schema({ id: t.int("模板 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_delete_template,
  },
  {
    name: "keyspy_hunt_start_scan",
    title: "启动 Hunt 扫描",
    description:
      "启动敏感信息扫描任务（异步执行）：爬取目录列表 → gitleaks + 正则扫描 → AI 分类分析。返回 taskId，用 keyspy_hunt_get_task 查询进度。",
    inputSchema: schema(
      {
        targets: {
          type: "array",
          description: "扫描目标列表",
          items: schema(
            {
              host: t.str("IP 或域名"),
              port: t.str("端口号"),
              protocol: t.enumStr("协议，默认 http", ["http", "https"]),
            },
            ["host"]
          ),
        },
      },
      ["targets"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_start_scan,
  },
  {
    name: "keyspy_hunt_abort_scan",
    title: "中断扫描任务",
    description: "中断正在运行的扫描任务。",
    inputSchema: schema({ taskId: t.int("任务 ID") }, ["taskId"]),
    handle: TOOL_HANDLERS.keyspy_hunt_abort_scan,
  },
  {
    name: "keyspy_hunt_list_tasks",
    title: "列出扫描任务",
    description: "列出全部扫描任务及状态（running / completed / failed）与进度。",
    inputSchema: schema({}),
    handle: TOOL_HANDLERS.keyspy_hunt_list_tasks,
  },
  {
    name: "keyspy_hunt_get_task",
    title: "查看扫描任务详情",
    description: "获取单个扫描任务详情及其发现（findings）列表。",
    inputSchema: schema({ taskId: t.int("任务 ID") }, ["taskId"]),
    handle: TOOL_HANDLERS.keyspy_hunt_get_task,
  },
  {
    name: "keyspy_hunt_list_results",
    title: "列出扫描发现",
    description: "列出扫描发现的疑似泄露凭据（自动去重）。可按任务过滤或分页。",
    inputSchema: schema({
      taskId: t.int("按任务 ID 过滤，可选"),
      limit: t.int("返回条数，默认 100"),
      offset: t.int("偏移量，默认 0"),
    }),
    handle: TOOL_HANDLERS.keyspy_hunt_list_results,
  },
  {
    name: "keyspy_hunt_add_result_to_monitor",
    title: "将发现添加到监控",
    description:
      "将扫描发现添加到监控配置。若该 Key 已存在会返回 duplicate 提示（可用 force: true 强制添加）。",
    inputSchema: schema(
      {
        findingId: t.int("发现记录 ID"),
        name: t.str("监控名称"),
        api_key: t.str("API Key"),
        model: t.str("模型名"),
        base_url: t.str("API 端点地址，可选（为空时按 provider 匹配内置模板）"),
        type: t.enumStr("协议类型，可选", ["openai", "anthropic", "gemini"]),
        group_name: t.str("分组名称，默认「Hunt 发现」"),
        force: t.bool("跳过重复检查，默认 false"),
      },
      ["findingId", "name", "api_key", "model"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_add_result_to_monitor,
  },
  {
    name: "keyspy_hunt_delete_result",
    title: "删除扫描发现",
    description:
      "删除扫描发现记录。action=remove_monitor 时仅从监控中移除（同时删除「Hunt 发现」分组下同 Key 的监控配置）。",
    inputSchema: schema(
      {
        id: t.int("发现记录 ID"),
        action: t.enumStr("操作类型，默认 delete", ["delete", "remove_monitor"]),
      },
      ["id"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_delete_result,
  },
  {
    name: "keyspy_hunt_test_key",
    title: "测试单个 Key 可用性",
    description:
      "对目标发起真实推理请求验证 Key 可用性，自动遍历多种 URL 格式。单次超时 30 秒。",
    inputSchema: schema(
      {
        api_key: t.str("API Key"),
        base_url: t.str("API 地址（可只填域名，会自动补全路径）"),
        model: t.str("模型名"),
        provider: t.str("提供商标识，决定协议（anthropic / gemini / 其他按 OpenAI 兼容）"),
      },
      ["api_key", "base_url", "model"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_test_key,
  },
  {
    name: "keyspy_hunt_test_key_all_templates",
    title: "自动检测 Key 可用性",
    description:
      "两级自动检测：若提供 base_url + model，先实测发现来源地址（覆盖中转/代理 Key）；来源不可用或信息不全时，再并发遍历所有内置模板及其全部模型。建议扫描发现测试时始终带上 finding 的 base_url、model、provider。耗时较长（最长 5 分钟）。",
    inputSchema: schema({
      api_key: t.str("API Key"),
      base_url: t.str("发现来源的 API 地址，可选（提供则优先实测）"),
      model: t.str("发现来源对应的模型名，可选"),
      provider: t.str("提供商标识，可选（anthropic / gemini / 其他按 OpenAI 兼容）"),
    }, ["api_key"]),
    handle: TOOL_HANDLERS.keyspy_hunt_test_key_all_templates,
  },
  {
    name: "keyspy_hunt_parse_targets",
    title: "AI 解析扫描目标",
    description: "用聊天 LLM 从混乱文本中智能提取 HTTP/HTTPS 扫描目标（host / port / protocol）。",
    inputSchema: schema(
      {
        text: t.str("待解析的文本"),
        chatSettingId: t.int("指定聊天配置 ID，可选（默认遍历所有启用配置）"),
      },
      ["text"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_parse_targets,
  },
  {
    name: "keyspy_hunt_delete_source",
    title: "删除远程泄露源文件",
    description:
      "向泄露文件所在服务器发送 DELETE 请求尝试删除源文件，并清除对应扫描结果。破坏性操作，仅在用户明确要求时执行。",
    inputSchema: schema(
      {
        urls: { type: "array", items: { type: "string" }, description: "源文件 URL 列表" },
        finding_id: t.int("关联的发现记录 ID，可选（同时删除本地记录）"),
      },
      ["urls"]
    ),
    handle: TOOL_HANDLERS.keyspy_hunt_delete_source,
  },
  {
    name: "keyspy_list_chat_settings",
    title: "列出聊天 LLM 配置",
    description: "列出系统内置用于 AI 分析/对话的 LLM 配置（API Key 已脱敏）。",
    inputSchema: schema({}),
    handle: TOOL_HANDLERS.keyspy_list_chat_settings,
  },
  {
    name: "keyspy_create_chat_setting",
    title: "创建聊天 LLM 配置",
    description: "添加一个聊天 LLM 配置，供 AI 分析、对话与文本解析使用。",
    inputSchema: schema(
      {
        name: t.str("配置名称"),
        provider: t.enumStr("提供商", ["openai", "anthropic", "google"]),
        api_key: t.str("API Key"),
        base_url: t.str("Base URL"),
        model: t.str("模型名"),
        enabled: t.bool("是否启用，默认 true"),
      },
      ["name", "provider", "api_key", "base_url", "model"]
    ),
    handle: TOOL_HANDLERS.keyspy_create_chat_setting,
  },
  {
    name: "keyspy_update_chat_setting",
    title: "更新聊天 LLM 配置",
    description: "局部更新聊天 LLM 配置。",
    inputSchema: schema({
      id: t.int("配置 ID"),
      name: t.str("配置名称"),
      provider: t.enumStr("提供商", ["openai", "anthropic", "google"]),
      api_key: t.str("API Key"),
      base_url: t.str("Base URL"),
      model: t.str("模型名"),
      enabled: t.bool("是否启用"),
    }),
    handle: TOOL_HANDLERS.keyspy_update_chat_setting,
  },
  {
    name: "keyspy_delete_chat_setting",
    title: "删除聊天 LLM 配置",
    description: "删除指定的聊天 LLM 配置。",
    inputSchema: schema({ id: t.int("配置 ID") }, ["id"]),
    handle: TOOL_HANDLERS.keyspy_delete_chat_setting,
  },
  {
    name: "keyspy_get_settings",
    title: "获取系统设置",
    description: "获取当前探测（轮询）频率设置。",
    inputSchema: schema({}),
    handle: TOOL_HANDLERS.keyspy_get_settings,
  },
  {
    name: "keyspy_update_settings",
    title: "更新探测频率",
    description: "更新监控探测频率，范围 10 秒 ~ 12 小时。",
    inputSchema: schema({ pollIntervalSeconds: t.int("探测间隔（秒），10 ~ 43200") }, ["pollIntervalSeconds"]),
    handle: TOOL_HANDLERS.keyspy_update_settings,
  },
];

// ====== JSON-RPC 方法处理 ======

async function handleToolCall(params: Record<string, unknown>, ctx: DelegateCtx): Promise<unknown> {
  const name = String(params.name || "");
  const args = (params.arguments || {}) as Record<string, unknown>;

  const tool = TOOLS.find((toolItem) => toolItem.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const data = await tool.handle(args, ctx);
    const summaryKey = TOOL_SUMMARY_KEY[name];
    const output = summaryKey ? summarize(summaryKey, data) : data;
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], isError: false };
  } catch (err) {
    return {
      content: [{ type: "text", text: `调用失败: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

async function handleMessage(msg: JsonRpcRequest, ctx: DelegateCtx): Promise<JsonRpcResponse | null> {
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion || "");
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "KeySpy — AI API Key 泄露检测与可用性监控平台。提供监控配置、模板、Hunt 扫描与 Key 测试等工具（不含账户管理功能）。",
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // 通知无需响应

    case "ping":
      return rpcResult(msg.id, {});

    case "tools/list":
      return rpcResult(msg.id, {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case "tools/call": {
      const result = await handleToolCall(msg.params || {}, ctx);
      return rpcResult(msg.id, result);
    }

    default:
      if (isNotification) return null;
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ====== HTTP 入口 ======

/** 从 Authorization 头校验 MCP Token，返回转发的认证头 */
function authenticate(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice(7).trim();
  const row = findEnabledMcpToken(token);
  if (!row) return null;

  touchMcpToken(row.id);
  return `Bearer ${token}`;
}

export async function POST(request: Request) {
  const authHeader = authenticate(request);
  if (!authHeader) {
    return jsonResponse(
      { error: "未授权：请在 Authorization 头中携带有效的 MCP Token（Bearer keyspy_mcp_xxx）" },
      { status: 401 }
    );
  }

  const ctx: DelegateCtx = {
    baseUrl: new URL(request.url).origin,
    authHeader,
  };

  let parsed: JsonRpcRequest | JsonRpcRequest[];
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error: 请求体不是有效 JSON"), { status: 400 });
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (messages.length === 0) {
    return jsonResponse(rpcError(null, -32600, "Invalid request: 空消息列表"), { status: 400 });
  }

  const responses: JsonRpcResponse[] = [];
  let initializeResponse: JsonRpcResponse | null = null;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      responses.push(rpcError(msg?.id ?? null, -32600, "Invalid request"));
      continue;
    }
    try {
      const res = await handleMessage(msg, ctx);
      if (res) {
        responses.push(res);
        if (msg.method === "initialize") initializeResponse = res;
      }
    } catch (err) {
      responses.push(rpcError(msg.id ?? null, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  // 纯通知请求 → 202 Accepted
  if (responses.length === 0) {
    return new Response(null, { status: 202 });
  }

  const headers: Record<string, string> = {};
  if (initializeResponse?.result && typeof initializeResponse.result === "object") {
    headers["MCP-Protocol-Version"] = (initializeResponse.result as { protocolVersion: string }).protocolVersion;
  }

  return jsonResponse(Array.isArray(parsed) ? responses : responses[0], { headers });
}

/** Streamable HTTP：客户端可选建立 SSE 流，本服务端为无状态模式，不支持 */
export async function GET() {
  return new Response("SSE stream not supported. Use POST for stateless Streamable HTTP.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function DELETE() {
  return new Response("Session management not supported (stateless server).", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
