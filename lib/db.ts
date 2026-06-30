import Database from "better-sqlite3";
import { hashSync, compareSync } from "bcryptjs";
import { randomBytes } from "crypto";
import { join } from "path";
import { mkdirSync } from "fs";

const dbPath = process.env.DB_PATH || join(process.cwd(), "data", "app.db");

// 延迟初始化：避免构建时多个 worker 同时访问数据库
let _db: Database.Database | null = null;
let _initialized = false;

function getDb(): Database.Database {
  if (!_db) {
    // 确保目录存在
    const dir = dbPath.substring(0, dbPath.lastIndexOf("\\")) ||
                dbPath.substring(0, dbPath.lastIndexOf("/"));
    if (dir) {
      try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    }
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("busy_timeout = 5000");
  }
  return _db;
}

// 初始化表（应在应用启动时调用一次）
export function initDb() {
  if (_initialized) return;
  _initialized = true;

  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS monitor_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'openai',
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        group_name TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        template_id INTEGER REFERENCES monitor_templates(id) ON DELETE SET NULL,
        fallback_models TEXT DEFAULT '[]',
        active_model TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS monitor_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'openai',
        base_url TEXT NOT NULL,
        models TEXT NOT NULL,
        default_model TEXT NOT NULL,
        description TEXT DEFAULT '',
        built_in INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS check_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        ping_latency_ms REAL,
        checked_at TEXT NOT NULL,
        message TEXT,
        FOREIGN KEY (config_id) REFERENCES monitor_configs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_check_history_config_time
        ON check_history(config_id, checked_at DESC);

      CREATE TABLE IF NOT EXISTS chat_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'openai',
        api_key TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hunt_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL DEFAULT 'pending',
        total INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        findings_count INTEGER DEFAULT 0,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS hunt_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        target_url TEXT NOT NULL,
        finding_type TEXT NOT NULL,
        raw_content TEXT,
        key_value TEXT,
        provider TEXT,
        model TEXT,
        base_url TEXT,
        confidence TEXT DEFAULT 'medium',
        added_to_monitor INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES hunt_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_hunt_findings_task
        ON hunt_findings(task_id);
    `);

    // 兑容已存在的数据库：逐步为 monitor_configs 补充新列
    const addColumnSafely = (table: string, columnDef: string) => {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
      } catch {
        // 列已存在，安全忽略
      }
    };
    addColumnSafely("monitor_configs", "template_id INTEGER REFERENCES monitor_templates(id) ON DELETE SET NULL");
    addColumnSafely("monitor_configs", "fallback_models TEXT DEFAULT '[]'");
    addColumnSafely("monitor_configs", "active_model TEXT DEFAULT ''");
    addColumnSafely("hunt_findings", "analysis TEXT DEFAULT ''");
    addColumnSafely("hunt_findings", "source_urls TEXT DEFAULT '[]'");
    addColumnSafely("hunt_tasks", "progress TEXT DEFAULT '{}'");
    addColumnSafely("users", "role TEXT DEFAULT 'user'");

    // 初始化内置模板（仅在首次时插入）
    try {
      const existing = db.prepare("SELECT COUNT(*) as cnt FROM monitor_templates").get() as { cnt: number };
      if (existing.cnt === 0) {
        const insertTpl = db.prepare(`
          INSERT INTO monitor_templates (name, type, base_url, models, default_model, description, built_in)
          VALUES (@name, @type, @base_url, @models, @default_model, @description, 1)
        `);
        const builtIns = [
          {
            name: "OpenAI",
            type: "openai",
            base_url: "https://api.openai.com/v1/chat/completions",
            models: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "o4-mini"],
            default_model: "gpt-5.5",
            description: "OpenAI 官方接口",
          },
          {
            name: "MiniMax",
            type: "openai",
            base_url: "https://api.minimaxi.com/v1/chat/completions",
            models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"],
            default_model: "MiniMax-M3",
            description: "MiniMax OpenAI 兼容接口",
          },
          {
            name: "Anthropic",
            type: "anthropic",
            base_url: "https://api.anthropic.com/v1/messages",
            models: ["claude-opus-4-8-20260514", "claude-sonnet-4-6-20260414", "claude-3-5-haiku-20241022"],
            default_model: "claude-sonnet-4-6-20260414",
            description: "Anthropic Claude 系列",
          },
          {
            name: "Gemini",
            type: "gemini",
            base_url: "https://generativelanguage.googleapis.com",
            models: ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
            default_model: "gemini-2.5-flash",
            description: "Google Gemini 系列",
          },
          {
            name: "DeepSeek",
            type: "openai",
            base_url: "https://api.deepseek.com/v1/chat/completions",
            models: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"],
            default_model: "deepseek-chat",
            description: "DeepSeek OpenAI 兼容接口",
          },
          {
            name: "Kimi",
            type: "openai",
            base_url: "https://api.moonshot.cn/v1/chat/completions",
            models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
            default_model: "kimi-k2.6",
            description: "月之暗面 Kimi 通用系列",
          },
          {
            name: "Kimi Coding",
            type: "openai",
            base_url: "https://api.moonshot.cn/v1/chat/completions",
            models: ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"],
            default_model: "kimi-k2.7-code",
            description: "月之暗面 Kimi Coding Plan 专用模型",
          },
          {
            name: "智谱",
            type: "openai",
            base_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            models: ["glm-5.2", "glm-5", "glm-4-plus", "glm-4-flash"],
            default_model: "glm-5",
            description: "智谱 GLM 系列",
          },
          {
            name: "阿里百炼",
            type: "openai",
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            models: ["qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "qwen-max", "qwen-plus"],
            default_model: "qwen-max",
            description: "阿里云通义千问 DashScope",
          },
          {
            name: "腾讯混元",
            type: "openai",
            base_url: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
            models: ["hunyuan-turbos-latest", "hunyuan-turbos", "hunyuan-t1-latest", "hunyuan-lite"],
            default_model: "hunyuan-turbos-latest",
            description: "腾讯混元大模型 OpenAI 兼容接口",
          },
          {
            name: "豆包",
            type: "openai",
            base_url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
            models: ["doubao-seed-2.0-pro-250615", "doubao-seed-2.0-lite-250615", "doubao-1.5-pro-32k-250115", "doubao-1.5-pro-256k-250115", "doubao-1.5-lite-32k-250115"],
            default_model: "doubao-seed-2.0-pro-250615",
            description: "字节跳动火山方舟豆包模型（需使用 endpoint_id）",
          },
          {
            name: "硅基流动",
            type: "openai",
            base_url: "https://api.siliconflow.cn/v1/chat/completions",
            models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-32B", "THUDM/GLM-4.1V-9B-Thinking"],
            default_model: "deepseek-ai/DeepSeek-V3",
            description: "硅基流动 SiliconFlow 开源模型平台",
          },
        ];
        const insertMany = db.transaction((items: typeof builtIns) => {
          for (const item of items) {
            insertTpl.run({
              ...item,
              models: JSON.stringify(item.models),
            });
          }
        });
        insertMany(builtIns);
      }
    } catch {
      // 多 worker 并发初始化时可能冲突，安全忽略
    }

    // 迁移：更新已有内置模板的模型列表 + 插入新增模板（v3: Kimi拆分 + 腾讯/豆包/硅基流动）
    try {
      // 确保 kv_store 表存在
      db.exec(`CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT)`);

      const MIGRATION_KEY = "tpl_migration_v3";
      const migrated = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(MIGRATION_KEY);
      if (!migrated) {
        const upsertTpl = db.prepare(`
          UPDATE monitor_templates
          SET models = @models, default_model = @default_model, base_url = @base_url, description = @description, updated_at = datetime('now')
          WHERE name = @name AND built_in = 1
        `);
        const insertTplIfNotExist = db.prepare(`
          INSERT INTO monitor_templates (name, type, base_url, models, default_model, description, built_in)
          SELECT @name, @type, @base_url, @models, @default_model, @description, 1
          WHERE NOT EXISTS (SELECT 1 FROM monitor_templates WHERE name = @name AND built_in = 1)
        `);

        const updates: Array<{ name: string; base_url: string; models: string; default_model: string; description: string }> = [
          { name: "OpenAI", base_url: "https://api.openai.com/v1/chat/completions", models: JSON.stringify(["gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "o4-mini"]), default_model: "gpt-5.5", description: "OpenAI 官方接口" },
          { name: "MiniMax", base_url: "https://api.minimaxi.com/v1/chat/completions", models: JSON.stringify(["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]), default_model: "MiniMax-M3", description: "MiniMax OpenAI 兼容接口" },
          { name: "Anthropic", base_url: "https://api.anthropic.com/v1/messages", models: JSON.stringify(["claude-opus-4-8-20260514", "claude-sonnet-4-6-20260414", "claude-3-5-haiku-20241022"]), default_model: "claude-sonnet-4-6-20260414", description: "Anthropic Claude 系列" },
          { name: "Gemini", base_url: "https://generativelanguage.googleapis.com", models: JSON.stringify(["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"]), default_model: "gemini-2.5-flash", description: "Google Gemini 系列" },
          { name: "DeepSeek", base_url: "https://api.deepseek.com/v1/chat/completions", models: JSON.stringify(["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"]), default_model: "deepseek-chat", description: "DeepSeek OpenAI 兼容接口" },
          { name: "Kimi", base_url: "https://api.moonshot.cn/v1/chat/completions", models: JSON.stringify(["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"]), default_model: "kimi-k2.6", description: "月之暗面 Kimi 通用系列" },
          { name: "智谱", base_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", models: JSON.stringify(["glm-5.2", "glm-5", "glm-4-plus", "glm-4-flash"]), default_model: "glm-5", description: "智谱 GLM 系列" },
          { name: "阿里百炼", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", models: JSON.stringify(["qwen3.7-max", "qwen3.7-plus", "qwen3.6-flash", "qwen-max", "qwen-plus"]), default_model: "qwen-max", description: "阿里云通义千问 DashScope" },
        ];

        const inserts: Array<{ name: string; type: string; base_url: string; models: string; default_model: string; description: string }> = [
          { name: "Kimi Coding", type: "openai", base_url: "https://api.moonshot.cn/v1/chat/completions", models: JSON.stringify(["kimi-k2.7-code", "kimi-k2.7-code-highspeed"]), default_model: "kimi-k2.7-code", description: "月之暗面 Kimi Coding Plan 专用模型" },
          { name: "腾讯混元", type: "openai", base_url: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions", models: JSON.stringify(["hunyuan-turbos-latest", "hunyuan-turbos", "hunyuan-t1-latest", "hunyuan-lite"]), default_model: "hunyuan-turbos-latest", description: "腾讯混元大模型 OpenAI 兼容接口" },
          { name: "豆包", type: "openai", base_url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", models: JSON.stringify(["doubao-seed-2.0-pro-250615", "doubao-seed-2.0-lite-250615", "doubao-1.5-pro-32k-250115", "doubao-1.5-pro-256k-250115", "doubao-1.5-lite-32k-250115"]), default_model: "doubao-seed-2.0-pro-250615", description: "字节跳动火山方舟豆包模型（需使用 endpoint_id）" },
          { name: "硅基流动", type: "openai", base_url: "https://api.siliconflow.cn/v1/chat/completions", models: JSON.stringify(["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-32B", "THUDM/GLM-4.1V-9B-Thinking"]), default_model: "deepseek-ai/DeepSeek-V3", description: "硅基流动 SiliconFlow 开源模型平台" },
        ];

        const migrateAll = db.transaction(() => {
          for (const u of updates) upsertTpl.run(u);
          for (const ins of inserts) insertTplIfNotExist.run(ins);
          db.prepare("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)").run(MIGRATION_KEY, new Date().toISOString());
        });
        migrateAll();
      }
    } catch {
      // 迁移失败不阻塞启动
    }

    // 创建默认管理员账户（仅首次初始化时，多 worker 安全）
    try {
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get("admin");
      if (!existing) {
        const hash = hashSync("admin123", 10);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run("admin", hash, "admin");
      } else {
        // 修复：确保已存在的 admin 用户拥有正确的角色（兼容旧数据库迁移）
        db.prepare("UPDATE users SET role = 'admin' WHERE username = 'admin' AND (role IS NULL OR role != 'admin')").run();
      }
    } catch {
      // 多 worker 并发初始化时可能遇到 UNIQUE 冲突，安全忽略
    }

    // 首次启动后惰性启动后台轮询器（仅 Node.js runtime）
    bootstrapPoller();
  } catch {
    // 构建时可能无法访问数据库，安全忽略
    _initialized = false;
  }
}

// 惰性启动后台轮询器：
// - 通过 globalThis 标志避免重复启动（多 worker / 热重载安全）
// - 通过 setImmediate 推到下一个事件循环，避免 initDb 本身的同步流程被拖慢
// - 与 Edge Runtime instrumentation 冲突的备选方案：
//   instrumentation.ts 不能静态 import poller（Edge Runtime 会报错），
//   因此改为在首次访问 initDb() 时惰性启动
// - 使用 ESM 静态 import：Turbopack 编译时安全；循环依赖（poller.ts 也 import db.ts）
//   被 ESM 解析为命名空间引用，poller 顶层副作用会从 db 模块调用 initDb 时触发
import { startPoller } from "./poller";

let _pollerBootstrapped = false;
function bootstrapPoller(): void {
  if (_pollerBootstrapped) return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;
  if (typeof window !== "undefined") return;

  _pollerBootstrapped = true;
  setImmediate(() => {
    try {
      startPoller();
    } catch (error) {
      console.error("[keyspy] 启动后台轮询器失败", error);
    }
  });
}

// 模块加载时自动初始化数据库（仅 Node.js server runtime）。
// 这确保任何导入 db.ts 的 API 路由都能立即使用完整的表结构，
// 同时让 initDb() 末尾的 bootstrapPoller() 触发后台轮询器。
if (
  process.env.NEXT_RUNTIME === "nodejs" &&
  typeof window === "undefined" &&
  process.env.NODE_ENV !== "test"
) {
  // 使用 setImmediate 推到下一个事件循环，避免阻塞模块加载
  setImmediate(() => {
    try {
      initDb();
    } catch (error) {
      console.error("[keyspy] 自动初始化数据库失败", error);
    }
  });
}

// ============ Users ============

export interface User {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export function createUser(username: string, password: string, role: string = "user"): User {
  const hash = hashSync(password, 10);
  const stmt = getDb().prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id, username, role, created_at"
  );
  return stmt.get(username, hash, role) as User;
}

export function findUserByUsername(username: string): { id: number; username: string; password_hash: string; role: string } | undefined {
  const stmt = getDb().prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?");
  return stmt.get(username) as { id: number; username: string; password_hash: string; role: string } | undefined;
}

export function findUserById(id: number): { id: number; username: string; role: string } | undefined {
  const stmt = getDb().prepare("SELECT id, username, role FROM users WHERE id = ?");
  return stmt.get(id) as { id: number; username: string; role: string } | undefined;
}

export function verifyPassword(password: string, hash: string): boolean {
  return compareSync(password, hash);
}

/** 获取所有用户列表（管理用） */
export function getAllUsers(): User[] {
  return getDb().prepare("SELECT id, username, role, created_at FROM users ORDER BY id").all() as User[];
}

/** 删除用户（同时级联删除 sessions） */
export function deleteUser(id: number): boolean {
  const info = getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  return info.changes > 0;
}

/** 修改用户密码 */
export function changeUserPassword(id: number, newPassword: string): boolean {
  const hash = hashSync(newPassword, 10);
  const info = getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  return info.changes > 0;
}

/** 修改用户角色 */
export function updateUserRole(id: number, role: string): boolean {
  const info = getDb().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  return info.changes > 0;
}

/** 修改用户名 */
export function updateUsername(id: number, newUsername: string): boolean {
  const info = getDb().prepare("UPDATE users SET username = ? WHERE id = ?").run(newUsername, id);
  return info.changes > 0;
}

// ============ Sessions ============

export function createSession(userId: number, expiresInHours = 24): string {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  const stmt = getDb().prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)");
  stmt.run(id, userId, expiresAt);
  return id;
}

export function findSession(sessionId: string): { user_id: number; expires_at: string } | undefined {
  const stmt = getDb().prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?");
  return stmt.get(sessionId) as { user_id: number; expires_at: string } | undefined;
}

export function deleteSession(sessionId: string): void {
  const stmt = getDb().prepare("DELETE FROM sessions WHERE id = ?");
  stmt.run(sessionId);
}

export function cleanupExpiredSessions(): void {
  const stmt = getDb().prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");
  stmt.run();
}

// ============ Monitor Configs ============

export interface MonitorConfig {
  id: number;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  model: string;
  group_name: string;
  enabled: number;
  template_id: number | null;
  fallback_models: string;
  active_model: string;
  created_at: string;
  updated_at: string;
}

export type MonitorConfigInput = Pick<MonitorConfig, "name" | "type" | "base_url" | "api_key" | "model" | "group_name" | "enabled"> & {
  template_id?: number | null;
  fallback_models?: string;
};

// ============ Monitor Templates ============

export interface MonitorTemplate {
  id: number;
  name: string;
  type: string;
  base_url: string;
  models: string;
  default_model: string;
  description: string;
  built_in: number;
  created_at: string;
  updated_at: string;
}

export interface MonitorTemplateParsed {
  id: number;
  name: string;
  type: string;
  base_url: string;
  models: string[];
  default_model: string;
  description: string;
  built_in: number;
  created_at: string;
  updated_at: string;
}

export type MonitorTemplateInput = Pick<MonitorTemplateParsed, "name" | "type" | "base_url" | "models" | "default_model" | "description">;

function parseTemplate(row: MonitorTemplate): MonitorTemplateParsed {
  let models: string[] = [];
  try {
    const parsed = JSON.parse(row.models);
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string");
  } catch {
    // ignore
  }
  return { ...row, models };
}

export function getAllTemplates(): MonitorTemplateParsed[] {
  const rows = getDb()
    .prepare("SELECT * FROM monitor_templates ORDER BY built_in DESC, id ASC")
    .all() as MonitorTemplate[];
  return rows.map(parseTemplate);
}

export function getTemplateById(id: number): MonitorTemplateParsed | undefined {
  const row = getDb()
    .prepare("SELECT * FROM monitor_templates WHERE id = ?")
    .get(id) as MonitorTemplate | undefined;
  return row ? parseTemplate(row) : undefined;
}

export function createTemplate(input: MonitorTemplateInput): MonitorTemplateParsed {
  const stmt = getDb().prepare(`
    INSERT INTO monitor_templates (name, type, base_url, models, default_model, description, built_in)
    VALUES (@name, @type, @base_url, @models, @default_model, @description, 0)
  `);
  const info = stmt.run({
    name: input.name,
    type: input.type,
    base_url: input.base_url,
    models: JSON.stringify(input.models),
    default_model: input.default_model,
    description: input.description ?? "",
  });
  return getTemplateById(Number(info.lastInsertRowid))!;
}

export function updateTemplate(id: number, input: Partial<MonitorTemplateInput>): MonitorTemplateParsed | undefined {
  const existing = getTemplateById(id);
  if (!existing) return undefined;

  const merged = { ...existing, ...input };
  // 保护 name 唯一
  getDb()
    .prepare(`
      UPDATE monitor_templates
      SET name = @name, type = @type, base_url = @base_url,
          models = @models, default_model = @default_model, description = @description,
          updated_at = datetime('now')
      WHERE id = @id
    `)
    .run({
      id,
      name: merged.name,
      type: merged.type,
      base_url: merged.base_url,
      models: JSON.stringify(merged.models),
      default_model: merged.default_model,
      description: merged.description ?? "",
    });
  return getTemplateById(id);
}

export function deleteTemplate(id: number): { ok: boolean; reason?: string } {
  const tpl = getTemplateById(id);
  if (!tpl) return { ok: false, reason: "模板不存在" };
  if (tpl.built_in) return { ok: false, reason: "内置模板不可删除" };
  const info = getDb().prepare("DELETE FROM monitor_templates WHERE id = ?").run(id);
  return { ok: info.changes > 0 };
}

/** 更新某个 config 的当前可用模型（检测调用） */
export function updateActiveModel(configId: number, activeModel: string): void {
  getDb()
    .prepare("UPDATE monitor_configs SET active_model = ?, updated_at = datetime('now') WHERE id = ?")
    .run(activeModel, configId);
}

export function getAllMonitorConfigs(): MonitorConfig[] {
  return getDb().prepare("SELECT * FROM monitor_configs ORDER BY created_at DESC").all() as MonitorConfig[];
}

export function getMonitorConfigById(id: number): MonitorConfig | undefined {
  return getDb().prepare("SELECT * FROM monitor_configs WHERE id = ?").get(id) as MonitorConfig | undefined;
}

export function findMonitorConfigsByKey(apiKey: string): MonitorConfig[] {
  return getDb()
    .prepare("SELECT * FROM monitor_configs WHERE api_key = ? ORDER BY created_at DESC")
    .all(apiKey) as MonitorConfig[];
}

export function createMonitorConfig(input: MonitorConfigInput): MonitorConfig {
  const stmt = getDb().prepare(`
    INSERT INTO monitor_configs (name, type, base_url, api_key, model, group_name, enabled, template_id, fallback_models)
    VALUES (@name, @type, @base_url, @api_key, @model, @group_name, @enabled, @template_id, @fallback_models)
  `);
  const info = stmt.run({
    ...input,
    template_id: input.template_id ?? null,
    fallback_models: input.fallback_models ?? "[]",
  });
  return getMonitorConfigById(Number(info.lastInsertRowid))!;
}

export function updateMonitorConfig(id: number, input: Partial<MonitorConfigInput>): MonitorConfig | undefined {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  for (const key of ["name", "type", "base_url", "api_key", "model", "group_name", "enabled", "template_id", "fallback_models"] as const) {
    if (input[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = input[key];
    }
  }

  if (fields.length === 0) return getMonitorConfigById(id);

  fields.push("updated_at = datetime('now')");
  getDb().prepare(`UPDATE monitor_configs SET ${fields.join(", ")} WHERE id = @id`).run(values);
  return getMonitorConfigById(id);
}

export function deleteMonitorConfig(id: number): boolean {
  const info = getDb().prepare("DELETE FROM monitor_configs WHERE id = ?").run(id);
  return info.changes > 0;
}

export function getMonitorConfigsByGroup(groupName: string): MonitorConfig[] {
  return getDb().prepare("SELECT * FROM monitor_configs WHERE group_name = ? ORDER BY name").all(groupName) as MonitorConfig[];
}

export function getDistinctGroupNames(): string[] {
  const rows = getDb().prepare("SELECT DISTINCT group_name FROM monitor_configs WHERE group_name != '' ORDER BY group_name").all() as { group_name: string }[];
  return rows.map((r) => r.group_name);
}

// ============ App Settings ============

const DEFAULT_POLL_INTERVAL = 300; // 5 minutes in seconds

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare(
    "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(key, value);
}

export function getPollIntervalSeconds(): number {
  const val = getSetting("poll_interval_seconds");
  if (val) {
    const n = parseInt(val, 10);
    if (n >= 10 && n <= 43200) return n;
  }
  return DEFAULT_POLL_INTERVAL;
}

export function formatPollInterval(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

// ============ Check History ============

export interface CheckHistoryRow {
  id: number;
  config_id: number;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  checked_at: string;
  message: string | null;
}

export interface CheckHistoryInput {
  config_id: number;
  status: string;
  latency_ms: number | null;
  ping_latency_ms: number | null;
  message: string | null;
}

/** 批量写入检测结果 */
export function appendCheckHistory(results: CheckHistoryInput[]): void {
  if (results.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO check_history (config_id, status, latency_ms, ping_latency_ms, checked_at, message) VALUES (@config_id, @status, @latency_ms, @ping_latency_ms, @checked_at, @message)"
  );
  const now = new Date().toISOString();
  const insertMany = db.transaction((items: CheckHistoryInput[]) => {
    for (const item of items) {
      stmt.run({ ...item, checked_at: now });
    }
  });
  insertMany(results);
}

/** 按 config_id 分组取最新 N 条 */
export function getRecentHistory(limitPerConfig: number = 60): CheckHistoryRow[] {
  const sql = `
    SELECT * FROM check_history
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY config_id ORDER BY checked_at DESC) AS rn
        FROM check_history
      ) WHERE rn <= ?
    )
    ORDER BY config_id, checked_at DESC
  `;
  return getDb().prepare(sql).all(limitPerConfig) as CheckHistoryRow[];
}

/** 获取指定 config_ids 在时间段内的可用性统计 */
export function getAvailabilityStats(
  configIds: number[],
  period: string = "7d"
): Record<string, { totalChecks: number; operationalCount: number; availabilityPct: number | null }> {
  if (configIds.length === 0) return {};

  const intervalMap: Record<string, string> = {
    "7d": "7 days",
    "15d": "15 days",
    "30d": "30 days",
  };
  const interval = intervalMap[period] || "7 days";

  const placeholders = configIds.map(() => "?").join(",");
  const sql = `
    SELECT config_id,
      COUNT(*) AS totalChecks,
      SUM(CASE WHEN status IN ('operational', 'degraded') THEN 1 ELSE 0 END) AS operationalCount
    FROM check_history
    WHERE config_id IN (${placeholders})
      AND checked_at > datetime('now', '-' || ? || '')
    GROUP BY config_id
  `;

  const rows = getDb().prepare(sql).all(...configIds, interval) as {
    config_id: number;
    totalChecks: number;
    operationalCount: number;
  }[];

  const result: Record<string, { totalChecks: number; operationalCount: number; availabilityPct: number | null }> = {};
  for (const row of rows) {
    result[String(row.config_id)] = {
      totalChecks: row.totalChecks,
      operationalCount: row.operationalCount,
      availabilityPct: row.totalChecks > 0
        ? Math.round((row.operationalCount / row.totalChecks) * 10000) / 100
        : null,
    };
  }
  return result;
}

/** 清理过期历史（默认 30 天） */
export function pruneCheckHistory(retentionDays: number = 30): number {
  const info = getDb().prepare(
    "DELETE FROM check_history WHERE checked_at < datetime('now', '-' || ? || ' days')"
  ).run(String(retentionDays));
  return info.changes;
}

// ============ Chat Settings ============

export interface ChatSetting {
  id: number;
  name: string;
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export type ChatSettingInput = Pick<ChatSetting, "name" | "provider" | "api_key" | "base_url" | "model"> & {
  enabled?: number;
};

export function getAllChatSettings(): ChatSetting[] {
  return getDb().prepare("SELECT * FROM chat_settings ORDER BY id ASC").all() as ChatSetting[];
}

export function getChatSettingById(id: number): ChatSetting | undefined {
  return getDb().prepare("SELECT * FROM chat_settings WHERE id = ?").get(id) as ChatSetting | undefined;
}

export function getEnabledChatSetting(): ChatSetting | undefined {
  return getDb().prepare("SELECT * FROM chat_settings WHERE enabled = 1 LIMIT 1").get() as ChatSetting | undefined;
}

export function createChatSetting(input: ChatSettingInput): ChatSetting {
  const stmt = getDb().prepare(`
    INSERT INTO chat_settings (name, provider, api_key, base_url, model, enabled)
    VALUES (@name, @provider, @api_key, @base_url, @model, @enabled)
  `);
  const info = stmt.run({
    ...input,
    enabled: input.enabled ?? 1,
  });
  return getChatSettingById(Number(info.lastInsertRowid))!;
}

export function updateChatSetting(id: number, input: Partial<ChatSettingInput>): ChatSetting | undefined {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  for (const key of ["name", "provider", "api_key", "base_url", "model", "enabled"] as const) {
    if (input[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = input[key];
    }
  }

  if (fields.length === 0) return getChatSettingById(id);

  fields.push("updated_at = datetime('now')");
  getDb().prepare(`UPDATE chat_settings SET ${fields.join(", ")} WHERE id = @id`).run(values);
  return getChatSettingById(id);
}

export function deleteChatSetting(id: number): boolean {
  const info = getDb().prepare("DELETE FROM chat_settings WHERE id = ?").run(id);
  return info.changes > 0;
}

// ============ Hunt Tasks & Findings ============

export interface HuntTask {
  id: number;
  status: string;
  total: number;
  completed: number;
  findings_count: number;
  error: string | null;
  progress: string | null;
  created_at: string;
  updated_at: string;
}

export interface HuntFinding {
  id: number;
  task_id: number;
  target_url: string;
  finding_type: string;
  raw_content: string | null;
  key_value: string | null;
  provider: string | null;
  model: string | null;
  base_url: string | null;
  confidence: string;
  added_to_monitor: number;
  created_at: string;
  analysis: string | null;
  source_urls: string | null;
}

export function createHuntTask(total: number): HuntTask {
  const info = getDb().prepare(
    "INSERT INTO hunt_tasks (status, total) VALUES ('running', ?)"
  ).run(total);
  return getDb().prepare("SELECT * FROM hunt_tasks WHERE id = ?").get(info.lastInsertRowid) as HuntTask;
}

export function updateHuntTask(id: number, updates: Partial<Pick<HuntTask, 'status' | 'completed' | 'findings_count' | 'error' | 'progress'>>): void {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };
  for (const key of ['status', 'completed', 'findings_count', 'error', 'progress'] as const) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = updates[key];
    }
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  getDb().prepare(`UPDATE hunt_tasks SET ${fields.join(", ")} WHERE id = @id`).run(values);
}

export function getAllHuntTasks(): HuntTask[] {
  return getDb().prepare("SELECT * FROM hunt_tasks ORDER BY created_at DESC").all() as HuntTask[];
}

export function getHuntTaskById(id: number): HuntTask | undefined {
  return getDb().prepare("SELECT * FROM hunt_tasks WHERE id = ?").get(id) as HuntTask | undefined;
}

export function createHuntFinding(finding: Omit<HuntFinding, 'id' | 'created_at'>): void {
  getDb().prepare(`
    INSERT INTO hunt_findings (task_id, target_url, finding_type, raw_content, key_value, provider, model, base_url, confidence, added_to_monitor, analysis, source_urls)
    VALUES (@task_id, @target_url, @finding_type, @raw_content, @key_value, @provider, @model, @base_url, @confidence, @added_to_monitor, @analysis, @source_urls)
  `).run({
    ...finding,
    analysis: finding.analysis ?? '',
    source_urls: finding.source_urls ?? '[]',
  });
}

export function getHuntFindingsByTaskId(taskId: number): HuntFinding[] {
  return getDb().prepare("SELECT * FROM hunt_findings WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as HuntFinding[];
}

export function getAllHuntFindings(limit = 100, offset = 0): HuntFinding[] {
  return getDb().prepare("SELECT * FROM hunt_findings ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as HuntFinding[];
}

export function getHuntFindingsCount(): number {
  const result = getDb().prepare("SELECT COUNT(*) as cnt FROM hunt_findings").get() as { cnt: number };
  return result.cnt;
}

export function getHuntFindingById(id: number): HuntFinding | undefined {
  return getDb().prepare("SELECT * FROM hunt_findings WHERE id = ?").get(id) as HuntFinding | undefined;
}

export function updateHuntFindingMonitorStatus(id: number, added: boolean): void {
  getDb().prepare("UPDATE hunt_findings SET added_to_monitor = ? WHERE id = ?").run(added ? 1 : 0, id);
}

export function updateHuntFinding(id: number, updates: Partial<Pick<HuntFinding, 'provider' | 'model' | 'base_url' | 'key_value' | 'finding_type'>>): void {
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };
  for (const key of ['provider', 'model', 'base_url', 'key_value', 'finding_type'] as const) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = updates[key];
    }
  }
  if (fields.length === 0) return;
  getDb().prepare(`UPDATE hunt_findings SET ${fields.join(", ")} WHERE id = @id`).run(values);
}

export function deleteHuntFinding(id: number): boolean {
  const info = getDb().prepare("DELETE FROM hunt_findings WHERE id = ?").run(id);
  return info.changes > 0;
}

export function deleteHuntTask(id: number): boolean {
  // 先删关联的 findings，再删 task（ON DELETE CASCADE 也会自动处理）
  const db = getDb();
  const deleteMany = db.transaction(() => {
    db.prepare("DELETE FROM hunt_findings WHERE task_id = ?").run(id);
    db.prepare("DELETE FROM hunt_tasks WHERE id = ?").run(id);
  });
  deleteMany();
  return true;
}

export { getDb as getDatabase };
