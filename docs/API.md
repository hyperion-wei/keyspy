# KeySpy API 接口文档

> 基于 `app/api/` 路由源码整理，覆盖全部 24 个路由文件。

## 通用约定

- **Base URL**：`http://<host>:<port>`（默认端口 3000）
- **数据格式**：请求与响应均为 `application/json`（`POST /api/chat` 除外，为 SSE 流）
- **认证方式**：Cookie 会话。登录成功后服务端写入 `session`（HttpOnly）与 `auth` Cookie，后续所有接口自动携带。会话有效期 24 小时。
- **错误格式**：统一返回 `{ "error": "错误描述" }` + 对应 HTTP 状态码
- **常见状态码**：
  - `400` 参数缺失/非法
  - `401` 未登录（除标注外，所有接口均需登录）
  - `403` 需要管理员权限
  - `404` 资源不存在
  - `500/502` 服务端错误

## 接口总览

| 模块 | 方法 | 端点 | 说明 |
|------|------|------|------|
| 认证 | POST | `/api/auth` | 登录 |
| 认证 | POST | `/api/auth/logout` | 登出 |
| 认证 | GET | `/api/auth/me` | 获取当前用户 |
| 仪表盘 | GET | `/api/dashboard` | 仪表盘数据 |
| 分组 | GET | `/api/group/{groupName}` | 分组视图数据 |
| 监控 | GET/POST | `/api/monitors` | 监控配置列表 / 创建（单个+批量） |
| 监控 | GET/PUT/DELETE | `/api/monitors/{id}` | 单个监控配置 CRUD |
| 监控 | POST | `/api/monitors/{id}/sync-models` | 同步全量模型列表 |
| 模型 | POST | `/api/models/list` | 拉取 Key 名下模型列表 |
| 模板 | GET/POST | `/api/templates` | 模板列表 / 创建 |
| 模板 | GET/PUT/DELETE | `/api/templates/{id}` | 单个模板 CRUD |
| Hunt | POST/PUT | `/api/hunt/scan` | 启动 / 中断扫描 |
| Hunt | POST | `/api/hunt/parse` | AI 解析文本提取目标 |
| Hunt | GET/POST/PUT/DELETE | `/api/hunt/results` | 扫描结果管理 |
| Hunt | GET/DELETE | `/api/hunt/tasks` | 扫描任务管理 |
| Hunt | POST | `/api/hunt/test` | 测试单个 Key |
| Hunt | POST | `/api/hunt/test-all` | 全模板遍历测试 Key |
| Hunt | POST | `/api/hunt/delete-source` | 删除远程泄露源文件 |
| 对话 | POST | `/api/chat` | AI Agent 对话（流式） |
| LLM 配置 | GET/POST | `/api/chat-settings` | 聊天 LLM 配置列表 / 创建 |
| LLM 配置 | GET/PUT/DELETE | `/api/chat-settings/{id}` | 单个聊天配置 CRUD |
| 账户 | GET/POST/PUT/DELETE | `/api/users` | 用户管理（仅管理员） |
| 设置 | GET/PUT | `/api/settings` | 探测频率设置 |
| 通知 | GET | `/api/notifications` | 通知列表（当前为空数组） |

---

## 1. 认证 (Auth)

### 1.1 登录 — `POST /api/auth`

**请求体**

```json
{ "action": "login", "username": "admin", "password": "admin123" }
```

**成功响应**（200，同时设置 `session` / `auth` Cookie）

```json
{ "success": true, "user": { "id": 1, "username": "admin", "role": "admin" } }
```

**错误**：`400` 用户名/密码为空、action 无效；`401` 用户名或密码错误。

### 1.2 登出 — `POST /api/auth/logout`

无需请求体，清除会话后返回 `{ "success": true }`。

### 1.3 当前用户 — `GET /api/auth/me`

**响应**

```json
{ "user": { "id": 1, "username": "admin", "role": "admin" } }
```

未登录或会话过期返回 `{ "user": null }`。

---

## 2. 仪表盘 — `GET /api/dashboard`

获取全局监控数据（最近 60 条检测历史、可用性统计）。支持 ETag 协商，命中返回 `304`。

**Query 参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| `trendPeriod` | `7d` \| `15d` \| `30d` | 可用性统计周期，默认 `7d` |

**响应**（`DashboardData`）

```json
{
  "providerTimelines": [
    {
      "id": "1",
      "items": [
        {
          "id": "1", "name": "监控名", "type": "openai",
          "endpoint": "https://api.xxx.com/v1/chat/completions",
          "model": "gpt-4o-mini", "activeModel": "gpt-4o-mini",
          "isFallback": false,
          "status": "operational",          // operational | degraded | down | maintenance
          "latencyMs": 320, "pingLatencyMs": 80,
          "checkedAt": "2026-08-27T08:00:00Z", "message": "",
          "groupName": "OpenAI"
        }
      ],
      "latest": { "...": "同 items[0] 结构" }
    }
  ],
  "groupInfos": [{ "groupName": "OpenAI", "websiteUrl": null, "tags": "" }],
  "lastUpdated": "2026-08-27T08:00:00Z",
  "total": 5,
  "pollIntervalLabel": "5分钟",
  "pollIntervalMs": 300000,
  "availabilityStats": {
    "1": [{ "period": "7d", "totalChecks": 2016, "operationalCount": 1980, "availabilityPct": 98.2 }]
  },
  "trendPeriod": "7d",
  "generatedAt": 1787990400000
}
```

---

## 3. 分组视图 — `GET /api/group/{groupName}`

**Path 参数**：`groupName` — 分组名（需 URL 编码，服务端自动 `decodeURIComponent`）

**Query 参数**：`trendPeriod`（同上）

**响应**：结构与仪表盘类似，额外包含：

```json
{
  "groupName": "MiniMax",
  "displayName": "MiniMax",
  "tags": "",
  "websiteUrl": null,
  "providerTimelines": ["..."], "availabilityStats": {"...": "..."},
  "lastUpdated": "...", "total": 2,
  "pollIntervalLabel": "5分钟", "pollIntervalMs": 300000,
  "trendPeriod": "7d", "generatedAt": 1787990400000
}
```

**错误**：`404` `{ "error": "分组 \"xxx\" 暂无监控配置" }`

---

## 4. 监控配置 (Monitors)

### 4.1 获取全部 — `GET /api/monitors`

返回 `MonitorConfig[]`：

```json
[{
  "id": 1, "name": "OpenAI #1", "type": "openai",
  "base_url": "https://api.openai.com/v1/chat/completions",
  "api_key": "sk-xxx", "model": "gpt-4o-mini",
  "group_name": "OpenAI", "enabled": 1,
  "template_id": 1,
  "fallback_models": "[\"gpt-4o\",\"gpt-4-turbo\"]",   // JSON 字符串
  "active_model": "gpt-4o-mini",
  "all_models": "[...]",                                // JSON 字符串，可能为空
  "models_synced_at": null,
  "created_at": "...", "updated_at": "..."
}]
```

### 4.2 创建监控 — `POST /api/monitors`

支持两种模式（按 `template_id` 是否存在自动分流）：

**模式一：单个创建**

```json
{
  "name": "我的监控",            // 必填
  "base_url": "https://...",    // 必填
  "api_key": "sk-...",          // 必填
  "model": "gpt-4o-mini",       // 必填
  "type": "openai",             // 可选，默认 openai（openai|anthropic|gemini）
  "group_name": "OpenAI",       // 可选
  "enabled": true,              // 可选，默认 true
  "template_id": null,          // 可选
  "fallback_models": "[...]",   // 可选，JSON 字符串
  "fetch_models": true,         // 可选：服务端拉取 /v1/models 构建降级链
  "all_models": ["m1", "m2"]    // 可选：前端已拉取的全量模型（优先级高于 fetch_models）
}
```

成功返回 `201` + 创建后的 `MonitorConfig` 对象。

**模式二：模板批量创建**（每个 key 先并发测试模板内全部模型，全部失败的 key 跳过）

```json
{
  "template_id": 1,                       // 必填
  "api_keys": ["sk-a", "sk-b"],           // 必填，自动去空去重
  "group_name": "Hunt 发现",              // 可选
  "enabled": true,                        // 可选
  "name_prefix": "OpenAI",                // 可选，默认模板名；多 key 时自动加 "#1 #2"
  "fallback_models": ["m1", "m2"],        // 可选，覆盖默认降级链
  "test_models": true,                    // 可选，默认 true
  "fetch_models": false                   // 可选：同时拉取全量模型
}
```

成功返回 `201`：

```json
{
  "created": [
    { "id": 10, "name": "OpenAI #1", "model": "gpt-4o-mini",
      "fallback_models": "[...]", "_tested": "测试 5 个模型，3 个可用", "_models": 120 }
  ],
  "errors": [],
  "skipped": [{ "key_suffix": "abc123", "reason": "所有模型均不可用" }],
  "total": 1
}
```

**错误**：`400` 必填项缺失；`404` 模板不存在。超时上限 300 秒。

### 4.3 单个配置 — `/api/monitors/{id}`

| 方法 | 说明 | 响应 |
|------|------|------|
| `GET` | 获取单个 | `MonitorConfig` |
| `PUT` | 更新（body 为任意字段子集，`enabled` 布尔自动转 0/1） | 更新后的 `MonitorConfig` |
| `DELETE` | 删除 | `{ "success": true }` |

不存在时均返回 `404`。

### 4.4 同步模型列表 — `POST /api/monitors/{id}/sync-models`

重新调用目标 `/v1/models` 拉取全量模型。首选模型仍在列表中时重建降级链（截断到上限），并更新 `models_synced_at`。

**响应**

```json
{ "ok": true, "models": ["gpt-4o", "gpt-4o-mini", "..."], "config": { "..." } }
```

**错误**：`404` 配置不存在；`502` `{ "ok": false, "error": "获取模型列表失败" }`

---

## 5. 模型列表 — `POST /api/models/list`

动态获取某个 Key 名下的全量模型列表（调用目标 `/v1/models`）。

**请求体**

```json
{ "type": "openai", "base_url": "https://api.openai.com/v1", "api_key": "sk-xxx" }
```

`type` 可选（默认 `openai`）；`base_url`、`api_key` 必填。

**响应**：`{ "ok": true, "models": ["..."] }` 或 `{ "ok": false, "error": "..." }`

---

## 6. 模板 (Templates)

模板对象（`MonitorTemplateParsed`，`models` 已解析为数组）：

```json
{
  "id": 1, "name": "OpenAI", "type": "openai",
  "base_url": "https://api.openai.com/v1/chat/completions",
  "models": ["gpt-4o-mini", "gpt-4o"], "default_model": "gpt-4o-mini",
  "description": "", "built_in": 1,
  "created_at": "...", "updated_at": "..."
}
```

### 6.1 `GET /api/templates` — 返回模板数组

### 6.2 `POST /api/templates` — 创建模板

```json
{
  "name": "我的模板",                     // 必填，唯一
  "base_url": "https://...",              // 必填
  "models": ["m1", "m2"],                 // 必填，非空，自动去重去空
  "default_model": "m1",                  // 必填，且必须在 models 中
  "type": "openai",                       // 可选
  "description": ""                       // 可选
}
```

成功 `201` 返回模板对象。`400`：必填缺失 / 默认模型不在列表 / 名称已存在。

### 6.3 `/api/templates/{id}`

| 方法 | 说明 |
|------|------|
| `GET` | 获取单个，`404` 不存在 |
| `PUT` | 局部更新（支持 `name/type/base_url/description/models/default_model`，校验同上） |
| `DELETE` | 删除；失败返回 `400` `{ "error": "原因" }`（如内置模板/被引用），成功 `{ "ok": true }` |

---

## 7. Hunt 扫描

### 7.1 启动扫描 — `POST /api/hunt/scan`

异步任务：爬取目录列表 → gitleaks（默认+增强规则）+ 补充正则扫描 → 分类/AI 分析 → 入库。并发上限 3 个目标。

**请求体**

```json
{
  "targets": [{ "url": "http://1.2.3.4", "host": "1.2.3.4", "port": "80", "protocol": "http" }]
}
```

**响应**（200，任务立即返回，后台执行）

```json
{ "success": true, "taskId": 12, "message": "扫描任务已启动，共 2 个目标" }
```

**错误**：`400` 未提供目标；`500` gitleaks 工具不可用。超时上限 300 秒。

### 7.2 中断扫描 — `PUT /api/hunt/scan`

```json
{ "taskId": 12, "action": "abort" }
```

**响应**：`{ "success": true, "message": "任务已中断" }`；`400` 缺少 taskId / 未知 action。

### 7.3 AI 文本解析 — `POST /api/hunt/parse`

用聊天 LLM 从混乱文本中提取扫描目标。

**请求体**：`{ "text": "...", "chatSettingId": 1 }`（`chatSettingId` 可选，缺省遍历所有启用配置）

**成功响应**

```json
{
  "success": true,
  "usedModel": "GPT (gpt-4o-mini)",
  "targets": [
    { "id": "ai-0-1787990400000", "host": "1.2.3.4", "port": "8080",
      "protocol": "http", "url": "http://1.2.3.4:8080", "scanned": false }
  ],
  "total": 1
}
```

**错误**：`400` 文本为空 / 未配置聊天 LLM；`500` 所有 LLM 均失败（附 `details`）。

### 7.4 扫描结果 — `/api/hunt/results`

**GET** — 查询结果（自动按 key 去重合并）

| 参数 | 位置 | 说明 |
|------|------|------|
| `taskId` | Query | 指定任务的结果 |
| `limit` / `offset` | Query | 分页（默认 100 / 0） |

```json
{
  "findings": [{
    "id": 1, "task_id": 12, "target_url": "http://1.2.3.4/.env",
    "finding_type": "api_key",           // api_key | bearer_token | password | ...
    "raw_content": "OPENAI_API_KEY=...",
    "key_value": "sk-xxx",
    "provider": "openai", "model": "gpt-4o-mini",
    "base_url": "https://api.openai.com/v1/chat/completions",
    "confidence": "high",                 // high | medium | low
    "added_to_monitor": 0,
    "analysis": "该文件为环境变量...",
    "source_urls": "[\"http://...\"]",    // JSON 字符串
    "created_at": "..."
  }],
  "total": 3
}
```

**POST** — 将发现添加到监控（先按 key 查重，可按 provider 自动匹配内置模板）

```json
{
  "findingId": 1, "name": "OpenAI 泄露", "api_key": "sk-xxx", "model": "gpt-4o-mini",
  "type": "openai",                       // 可选
  "base_url": "https://...",              // 可选（为空时按 provider 匹配模板）
  "group_name": "Hunt 发现",              // 可选
  "force": false                          // true 时忽略重复检查
}
```

- 成功：`{ "success": true, "message": "已添加到监控配置", "templateUsed": null }`
- 重复且未强制：`200` `{ "success": false, "duplicate": true, "existingConfigs": [...], "message": "..." }`

**PUT** — 编辑 finding 字段

```json
{ "id": 1, "provider": "deepseek", "model": "...", "base_url": "...", "key_value": "...", "finding_type": "api_key" }
```

返回 `{ "success": true }`。

**DELETE** — `?id=1&action=delete|remove_monitor`

- `action=delete`：删除 finding，返回 `{ "success": true }`
- 默认：从监控移除（同时删除 `Hunt 发现` 分组下同 key 的监控配置），返回 `{ "success": true, "deletedConfigs": 1 }`

### 7.5 扫描任务 — `/api/hunt/tasks`

**GET**

- 无参数：返回全部任务数组（`HuntTask[]`：`id/status/total/completed/findings_count/error/progress/created_at/updated_at`，`status` ∈ running|completed|failed，`progress` 为各目标进度的 JSON 字符串）
- `?id=12`：返回 `{ "task": {...}, "findings": [...] }`

**DELETE** — `?id=12`：先中断运行中的任务，再删除任务及关联 findings，返回 `{ "success": true }`

### 7.6 测试单个 Key — `POST /api/hunt/test`

对目标发起真实推理请求（"Say hello in exactly one word."），自动遍历多种 URL 格式（`/v1/chat/completions`、`/chat/completions`、已知厂商路径等）。单次请求超时 30 秒。

**请求体**

```json
{ "api_key": "sk-xxx", "base_url": "https://api.deepseek.com", "model": "deepseek-chat", "provider": "openai" }
```

`provider` 决定协议：`anthropic` / `gemini`(google) / 其他均按 OpenAI 兼容。

**成功响应**

```json
{
  "success": true, "latency_ms": 320,
  "message": "Key 可用，API 响应正常",
  "response_preview": "Hello",
  "url_used": "https://api.deepseek.com/v1/chat/completions"
}
```

**失败响应**：`{ "success": false, "latency_ms": 0, "message": "...", "attempts": [...] }`（401/403/429 视为 key 无效直接返回，404 继续尝试下一 URL）

### 7.7 自动检测 Key 可用性 — `POST /api/hunt/test-all`

两级策略：若提供 `base_url` + `model`，先实测发现来源地址（覆盖中转/代理 Key）；来源不可用或信息不全时，再并发遍历**所有模板**（每个模板测试全部模型，第一个成功即止）。超时上限 300 秒。

**请求体**：`{ "api_key": "sk-xxx", "base_url"?, "model"?, "provider"? }`

**响应**

```json
{
  "usable": true,
  "worked": [{ "template": "发现来源", "templateId": null, "type": "openai",
               "base_url": "https://...", "model": "minimax-m2.7" }],
  "results": [
    { "template": "发现来源", "templateId": null, "type": "openai",
      "base_url": "...", "model": "minimax-m2.7",
      "success": true, "message": "Key 可用 (...)", "latency_ms": 1539 }
  ]
}
```

命中来源时 `worked[0].template` 为 `"发现来源"`；未提供来源信息或来源不可用时，`results` 为全部模板的测试结果。

### 7.8 删除远程源文件 — `POST /api/hunt/delete-source`

向泄露文件所在服务器发送 `DELETE` 请求尝试删除源文件，并清除本地扫描结果。

**请求体**：`{ "urls": ["http://x/.env"], "finding_id": 1 }`

**响应**：`{ "success": true, "deleted": 1, "failed": 0, "errors": [] }`

---

## 8. AI 对话 — `POST /api/chat`

AI Agent 对话接口（可操作监控配置），返回 **Vercel AI SDK UI Message Stream**（SSE 流，非普通 JSON），前端配合 `useChat` 使用。Agent 循环最多 10 步。

**请求体**

```json
{
  "messages": [{ "role": "user", "content": "列出所有监控" }],
  "chatSettingId": 1
}
```

`messages` 必填；`chatSettingId` 可选（缺省取第一个启用的聊天配置）。

**错误**：`400` 消息为空 / 未配置聊天 LLM；`500` 模型创建失败。

---

## 9. 聊天 LLM 配置 (Chat Settings)

### 9.1 `GET /api/chat-settings`

返回配置数组，**API Key 已脱敏**（`sk-123456••••••abcd` 格式）。

### 9.2 `POST /api/chat-settings`

```json
{
  "name": "GPT", "provider": "openai",          // openai | anthropic | google
  "api_key": "sk-xxx", "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini", "enabled": true
}
```

全部字段必填（`enabled` 可选，默认启用）。成功 `201` 返回配置对象。

### 9.3 `/api/chat-settings/{id}`

| 方法 | 说明 |
|------|------|
| `GET` | 单个配置（Key 脱敏），`404` 不存在 |
| `PUT` | 局部更新，`enabled` 布尔自动转 0/1 |
| `DELETE` | `{ "success": true }` |

---

## 10. 账户管理 — `/api/users`（仅管理员，否则 `403`）

用户对象：`{ "id": 1, "username": "admin", "role": "admin", "created_at": "..." }`

| 方法 | 请求 | 说明 |
|------|------|------|
| `GET` | — | `{ "users": [...] }` |
| `POST` | `{ "username", "password", "role" }` | 用户名 3-30 字符，密码 ≥6 位，role ∈ admin/user（默认 user）；`201` `{ "success": true, "user" }` |
| `PUT` | `{ "id", "password"?, "role"?, "username"? }` | 至少修改一项，可组合；`{ "success": true }` |
| `DELETE` | `?id=1`（Query） | `{ "success": true }` |

---

## 11. 系统设置 — `/api/settings`

探测（轮询）频率管理，无需登录。

**GET** → `{ "pollIntervalSeconds": 300, "pollIntervalLabel": "5分钟" }`

**PUT** — `{ "pollIntervalSeconds": 300 }`，范围 10 ~ 43200 秒（10 秒 ~ 12 小时），超范围返回 `400`。

---

## 12. 通知 — `GET /api/notifications`

当前为占位实现（stub），始终返回空数组 `[]`，带缓存头 `Cache-Control: public, max-age=60`。

---

## 13. MCP 服务器 — `POST /api/mcp`

KeySpy 内置 MCP（Model Context Protocol）服务器，采用 **Streamable HTTP 无状态模式**（JSON-RPC 2.0），覆盖全部非管理员功能（不含账户管理）。

### 认证

请求头必须携带有效的 MCP Token（在「管理 → MCP 管理」页面生成）：

```
Authorization: Bearer keyspy_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Token 以其创建者的身份执行操作；无效/停用的 Token 返回 `401`。

### 客户端配置示例

```json
{
  "mcpServers": {
    "keyspy": {
      "url": "http://<host>:<port>/api/mcp",
      "headers": { "Authorization": "Bearer keyspy_mcp_xxx" }
    }
  }
}
```

### 协议说明

| 方法 | 说明 |
|------|------|
| `POST` | JSON-RPC 消息（单条或批量数组）。通知类消息返回 `202` |
| `GET` / `DELETE` | `405`（无状态模式，不支持 SSE 流与会话管理） |

支持的 JSON-RPC 方法：`initialize`、`ping`、`tools/list`、`tools/call`、`notifications/initialized`。

> **内部回环地址**：`tools/call` 会内部调用本应用的 REST API，默认使用 `http://127.0.0.1:<PORT>`。部署在反向代理/SSL 之后若进程无法回环该地址，可通过环境变量 `INTERNAL_BASE_URL` 显式覆盖。

### 工具清单（32 个）

| 分组 | 工具 |
|------|------|
| 仪表盘 | `keyspy_get_dashboard`、`keyspy_get_group` |
| 监控配置 | `keyspy_list_monitors`、`keyspy_get_monitor`、`keyspy_create_monitor`、`keyspy_create_monitors_batch`、`keyspy_update_monitor`、`keyspy_delete_monitor`、`keyspy_sync_monitor_models`、`keyspy_list_key_models` |
| 模板 | `keyspy_list_templates`、`keyspy_get_template`、`keyspy_create_template`、`keyspy_update_template`、`keyspy_delete_template` |
| Hunt 扫描 | `keyspy_hunt_start_scan`、`keyspy_hunt_abort_scan`、`keyspy_hunt_list_tasks`、`keyspy_hunt_get_task`、`keyspy_hunt_list_results`、`keyspy_hunt_add_result_to_monitor`、`keyspy_hunt_delete_result`、`keyspy_hunt_test_key`、`keyspy_hunt_test_key_all_templates`、`keyspy_hunt_parse_targets`、`keyspy_hunt_delete_source` |
| LLM 配置 | `keyspy_list_chat_settings`、`keyspy_create_chat_setting`、`keyspy_update_chat_setting`、`keyspy_delete_chat_setting` |
| 系统设置 | `keyspy_get_settings`、`keyspy_update_settings` |

## 14. MCP Token 管理 — `/api/mcp-tokens`（仅管理员）

Token 对象：`{ id, name, token, created_by, creator_username, enabled, last_used_at, created_at }`

| 方法 | 请求 | 说明 |
|------|------|------|
| `GET` | — | `{ "tokens": [...] }` |
| `POST` | `{ "name"? }` | 生成新 Token，`201` `{ "success": true, "token": {...} }` |
| `PUT` | `{ "id", "enabled" }` | 启用/停用 |
| `DELETE` | `?id=1`（Query） | `{ "success": true }` |

非管理员访问返回 `403`。
