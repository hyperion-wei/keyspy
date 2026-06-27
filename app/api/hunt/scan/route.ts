import { generateText } from "ai";
import {
  initDb,
  createHuntTask,
  updateHuntTask,
  createHuntFinding,
  getAllChatSettings,
  type ChatSetting,
} from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ====== LLM Key 检测正则模式 ======
const LLM_KEY_PATTERNS = [
  // OpenAI / 通用 sk- keys (最先匹配，优先级高)
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, type: "api_key", provider: "openai" },
  // Anthropic keys (sk-ant- 开头，比通用 sk- 更具体)
  { pattern: /sk-ant-[a-zA-Z0-9]{20,}/g, type: "api_key", provider: "anthropic" },
  // MiniMax keys (eyJ... JWT format)
  { pattern: /eyJ[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{20,}/g, type: "api_key", provider: "minimax" },
  // API Key 赋值 (含 xxx_API_KEY= 等环境变量格式)
  { pattern: /(?:[\w_]*api[_-]?key[\w]*)\s*[:=]\s*["']?([a-zA-Z0-9_\-]{20,})["']?/gi, type: "api_key", provider: "unknown" },
  // hermes config set API_key "xxx" 格式
  { pattern: /config\s+set\s+[\w_]*(?:API|api|Api)[\w_]*\s+["']([^"']+)["']/g, type: "api_key", provider: "unknown" },
  // Bearer tokens
  { pattern: /Bearer\s+([a-zA-Z0-9._\-]{20,})/gi, type: "bearer_token", provider: "unknown" },
  // Authorization header
  { pattern: /Authorization\s*[:=]\s*["']?Bearer\s+([a-zA-Z0-9._\-]{20,})["']?/gi, type: "auth_header", provider: "unknown" },
  // Base URL patterns (含 inference_base_url 等)
  { pattern: /(?:[\w_]*base[_-]?url[\w]*)\s*[:=]\s*["']?(https?:\/\/[^\s"'<>]+)["']?/gi, type: "base_url", provider: "unknown" },
  // Model names
  { pattern: /(?:model|MODEL)\s*[:=]\s*["']?((?:gpt-|claude-|gemini-|MiniMax-|deepseek-|qwen-)[a-zA-Z0-9._-]+)["']?/gi, type: "model", provider: "unknown" },
];

// ====== 目录爬取配置 ======
const MAX_DEPTH = 3;           // 最大递归深度
const MAX_FILES = 300;         // 最大扫描文件数
const FETCH_TIMEOUT = 8000;    // 单次请求超时
const MAX_CONTENT_SIZE = 200000; // 单文件最大 200KB

// 敏感文件扩展名/名称（优先扫描）
const SENSITIVE_FILES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  ".npmrc", ".bash_history", ".zsh_history", ".bashrc", ".zshrc", ".profile",
  ".gitconfig", ".git-credentials",
  "config.json", "config.yaml", "config.yml", "config.toml", "config.ini",
  "settings.json", "package.json", "docker-compose.yml", "docker-compose.yaml",
  "Dockerfile", "Makefile",
]);

// 要扫描的文本文件扩展名
const SCANNABLE_EXTS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg",
  ".env", ".txt", ".md", ".log", ".sh", ".bash", ".zsh", ".py", ".js", ".ts",
  ".html", ".htm", ".xml", ".csv", ".sql", ".properties",
  "", // 无扩展名文件（如 .bash_history, .npmrc）
]);

// 跳过的二进制扩展名
const BINARY_EXTS = new Set([
  ".db", ".sqlite", ".sqlite3", ".db-shm", ".db-wal",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
  ".mp4", ".mp3", ".wav", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".md5", ".sha1", ".sha256",
  ".lock", ".pid",
  ".woff", ".woff2", ".ttf", ".eot",
]);

// 跳过的目录名
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "__pycache__", ".cache",
  ".local", ".npm", ".cargo", ".rustup",
]);

/**
 * 清理 Key 值中的非 ASCII 字符（智能引号、中文等）
 * 源文件中常见：`"sk-xxx"` 其中引号是 U+201C/U+201D
 * 还要处理 key 后面可能跟着的源文件上下文垃圾（空格、换行等）
 */
function sanitizeKey(value: string): string {
  let result = value
    .replace(/[\u201C\u201D\u201E\uFF02]/g, '"')  // 智能双引号 → ASCII
    .replace(/[\u2018\u2019\u201A\uFF07]/g, "'")  // 智能单引号 → ASCII
    .replace(/^['"]+|['"]+$/g, '')               // 去掉首尾引号
    .replace(/[^\x00-\xFF]/g, '');                // 移除其他非 ASCII
  // 截断到第一个空白字符（换行/空格/Tab），因为 key 不应包含空格
  const wsIdx = result.search(/[\s\n\r\t]/);
  if (wsIdx > 0) {
    result = result.slice(0, wsIdx);
  }
  return result.trim();
}

// AI 分类 Prompt
const CLASSIFY_PROMPT = `分析以下从网站扫描中发现的敏感内容，判断是否为 LLM/AI 模型相关的密钥泄露。

你需要判断：
1. 这是什么类型的内容（api_key, base_url, model, bearer_token, auth_header, 或 unknown）
2. 可能属于哪个提供商（openai, anthropic, google, minimax, deepseek, 或其他）
3. 置信度（high, medium, low）

如果内容明显不是 LLM 相关的（比如普通的 session token），返回 {"is_llm_related": false}

只输出 JSON，格式如下：
{"is_llm_related": true, "finding_type": "api_key", "provider": "openai", "model": null, "base_url": null, "confidence": "high"}
或
{"is_llm_related": false}`;

// AI 综合分析 Prompt：提取 key 信息 + 生成分析报告
const AI_ANALYZE_PROMPT = `你是一个 API 安全分析师。分析以下包含 LLM API Key 的源文件内容，完成两个任务：

**任务 1：提取 Key 信息**
从文件上下文中提取：
- provider：属于哪个提供商（openai/anthropic/google/minimax/deepseek/dashscope/openrouter/groq/together/mistral/perplexity/unknown）
- base_url：如果上下文中有该 key 对应的 API 地址。**必须包含完整路径，格式为 https://domain/v1/chat/completions 或类似**。如果只有域名则补上 /v1/chat/completions。例如 "https://api.deepseek.com" 应输出 "https://api.deepseek.com/v1/chat/completions"。Anthropic 应输出 https://api.anthropic.com/v1/messages。
- model：如果上下文中有该 key 对应的模型名
- key_value：实际的 API Key 值（仅包含密钥本身，不包含空格、引号或其他字符）

**任务 2：生成分析报告**
输出一段简短的中文分析（3-5句话）：
- 这是什么类型的文件
- Key 是如何被暴露的
- 风险等级和建议

**输出格式（只输出 JSON，不要其他内容）**：
{
  "provider": "deepseek",
  "base_url": "https://api.deepseek.com/v1/chat/completions",
  "model": "deepseek-chat",
  "key_value": "sk-xxx",
  "analysis": "该文件为 shell 命令历史记录，记录了用户配置 DeepSeek API Key 的操作..."
}`;

interface ScanTarget {
  url: string;
  host: string;
  port: string;
  protocol: string;
}

interface RawFinding {
  url: string;
  path: string;
  content: string;
  pattern: string;
  type: string;
  provider: string;
  matchedValue: string;
}

interface CrawlStats {
  filesScanned: number;
  dirsScanned: number;
  filesSkipped: number;
  findingsFound: number;
}

/**
 * POST /api/hunt/scan
 * 启动扫描任务
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { targets } = body;

  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    return Response.json({ error: "请提供扫描目标" }, { status: 400 });
  }

  const task = createHuntTask(targets.length);

  runScan(task.id, targets as ScanTarget[]).catch((err) => {
    console.error(`[hunt/scan] Task ${task.id} failed:`, err);
    updateHuntTask(task.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return Response.json({
    success: true,
    taskId: task.id,
    message: `扫描任务已启动，共 ${targets.length} 个目标`,
  });
}

/**
 * 后台执行扫描
 */
async function runScan(taskId: number, targets: ScanTarget[]) {
  let completed = 0;
  const allClassified: Array<{
    finding: RawFinding;
    classified: {
      is_llm_related: boolean;
      finding_type?: string;
      provider?: string;
      model?: string | null;
      base_url?: string | null;
      confidence?: string;
    };
  }> = [];

  // 第一步：扫描所有目标，收集分类结果
  for (const target of targets) {
    try {
      const baseUrl = `${target.protocol}://${target.host}:${target.port}`;
      console.log(`[hunt/scan] Task #${taskId} 开始扫描目标: ${baseUrl}`);

      const stats: CrawlStats = { filesScanned: 0, dirsScanned: 0, filesSkipped: 0, findingsFound: 0 };
      const findings = await crawlAndScan(baseUrl, baseUrl, 0, new Set<string>(), stats);

      console.log(`[hunt/scan] Task #${taskId} 目标 ${baseUrl} 爬取完成: 文件=${stats.filesScanned}, 目录=${stats.dirsScanned}, 跳过=${stats.filesSkipped}, 发现=${stats.findingsFound}`);

      for (const finding of findings) {
        const classified = await classifyFinding(finding);
        if (classified.is_llm_related) {
          allClassified.push({ finding, classified });
        }
      }

      completed++;
      updateHuntTask(taskId, { completed });
    } catch (err) {
      console.warn(`[hunt/scan] Failed to scan ${target.url}:`, err);
      completed++;
      updateHuntTask(taskId, { completed });
    }
  }

  // 第二步：同文件聚合
  aggregateSameFileFindings(allClassified);

  // 第三步：密钥去重——相同 key_value 的 api_key finding 合并
  const deduped = deduplicateByKey(allClassified);

  // 第四步：AI 分析泄露上下文
  const analyzed = await analyzeFindings(deduped);

  // 第五步：清理 key 中的 Unicode 字符后存储到数据库
  let findingsCount = 0;
  for (const item of analyzed) {
    const cleanKey = item.finding.matchedValue
      ? sanitizeKey(item.finding.matchedValue).slice(0, 200)
      : '';
    createHuntFinding({
      task_id: taskId,
      target_url: item.target_url,
      finding_type: item.classified.finding_type || item.finding.type,
      raw_content: item.finding.content.slice(0, 500),
      key_value: cleanKey,
      provider: item.classified.provider || item.finding.provider,
      model: item.classified.model || null,
      base_url: item.classified.base_url || null,
      confidence: item.classified.confidence || "medium",
      added_to_monitor: 0,
      analysis: item.analysis || '',
      source_urls: JSON.stringify(item.sourceUrls || []),
    });
    findingsCount++;
  }

  updateHuntTask(taskId, {
    status: "completed",
    completed,
    findings_count: findingsCount,
  });

  console.log(`[hunt/scan] Task #${taskId} 全部完成: ${completed} 目标, ${findingsCount} 发现 (去重前: ${allClassified.length})`);
}

// ====== Provider 默认 base_url / model 映射 ======

const PROVIDER_DEFAULTS: Record<string, { base_url: string; model: string }> = {
  openai: { base_url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  anthropic: { base_url: "https://api.anthropic.com/v1/messages", model: "claude-sonnet-4-20250514" },
  minimax: { base_url: "https://api.minimaxi.com/v1/chat/completions", model: "MiniMax-M2.7" },
  deepseek: { base_url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat" },
  dashscope: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-turbo" },
  google: { base_url: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  openrouter: { base_url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-4o-mini" },
  groq: { base_url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile" },
  together: { base_url: "https://api.together.xyz/v1/chat/completions", model: "meta-llama/Llama-3-70b-chat-hf" },
  mistral: { base_url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  perplexity: { base_url: "https://api.perplexity.ai/chat/completions", model: "llama-3.1-sonar-small-128k-online" },
};

/**
 * 同文件聚合：将同一文件中的 base_url 和 model 关联到 api_key 类型的 finding。
 * 并为缺少 base_url/model 的 api_key finding 填充 provider 默认值。
 * 独立的 base_url / model finding 在聚合后标记为 is_llm_related=false 以跳过存储。
 */
function aggregateSameFileFindings(
  classifiedFindings: Array<{
    finding: RawFinding;
    classified: {
      is_llm_related: boolean;
      finding_type?: string;
      provider?: string;
      model?: string | null;
      base_url?: string | null;
      confidence?: string;
    };
  }>
) {
  // 按文件分组（finding.url + finding.path）
  const groups = new Map<string, typeof classifiedFindings>();
  for (const item of classifiedFindings) {
    const key = item.finding.url + item.finding.path;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const [, group] of groups) {
    // 收集组内的 base_url 和 model
    const baseUrls: string[] = [];
    const models: string[] = [];
    for (const item of group) {
      if (item.classified.finding_type === "base_url" && item.classified.base_url) {
        baseUrls.push(item.classified.base_url);
      }
      if (item.classified.finding_type === "model" && item.classified.model) {
        models.push(item.classified.model);
      }
    }

    // 将 base_url 和 model 关联到 api_key 类型的 finding
    for (const item of group) {
      if (item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token" || item.classified.finding_type === "auth_header") {
        if (!item.classified.base_url && baseUrls.length > 0) {
          item.classified.base_url = baseUrls[0];
        }
        if (!item.classified.model && models.length > 0) {
          item.classified.model = models[0];
        }
        // 填充 provider 默认值
        const provider = item.classified.provider || "unknown";
        const defaults = PROVIDER_DEFAULTS[provider];
        if (defaults) {
          if (!item.classified.base_url) item.classified.base_url = defaults.base_url;
          if (!item.classified.model) item.classified.model = defaults.model;
        }
      }
    }

    // 独立的 base_url / model finding 标记为不需要单独存储
    for (const item of group) {
      if ((item.classified.finding_type === "base_url" || item.classified.finding_type === "model") && group.some(g => g !== item && (g.classified.finding_type === "api_key" || g.classified.finding_type === "bearer_token" || g.classified.finding_type === "auth_header"))) {
        item.classified.is_llm_related = false;
      }
    }
  }

  // 为孤立的 api_key finding（没有同文件 base_url/model）填充 provider 默认值
  for (const item of classifiedFindings) {
    if ((item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token") && !item.classified.base_url) {
      const provider = item.classified.provider || "unknown";
      const defaults = PROVIDER_DEFAULTS[provider];
      if (defaults) {
        if (!item.classified.base_url) item.classified.base_url = defaults.base_url;
        if (!item.classified.model) item.classified.model = defaults.model;
      }
    }
  }
}

// ====== 密钥去重 ======

interface DedupedFinding {
  finding: RawFinding;
  classified: {
    is_llm_related: boolean;
    finding_type?: string;
    provider?: string;
    model?: string | null;
    base_url?: string | null;
    confidence?: string;
  };
  sourceUrls: string[];
  target_url: string;
  analysis: string;
}

/**
 * 密钥去重：相同 key_value 的 api_key finding 合并
 * 非 api_key 类型的 finding 保留不动
 */
function deduplicateByKey(
  classifiedFindings: Array<{
    finding: RawFinding;
    classified: {
      is_llm_related: boolean;
      finding_type?: string;
      provider?: string;
      model?: string | null;
      base_url?: string | null;
      confidence?: string;
    };
  }>
): DedupedFinding[] {
  const result: DedupedFinding[] = [];
  const keyMap = new Map<string, DedupedFinding>();

  for (const item of classifiedFindings) {
    const isApiKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token" || item.classified.finding_type === "auth_header";
    const url = item.finding.url + item.finding.path;

    if (isApiKey && item.finding.matchedValue) {
      const existing = keyMap.get(item.finding.matchedValue);
      if (existing) {
        // 相同 key，追加来源 URL
        if (!existing.sourceUrls.includes(url)) {
          existing.sourceUrls.push(url);
        }
        continue;
      }
      const entry: DedupedFinding = {
        finding: item.finding,
        classified: item.classified,
        sourceUrls: [url],
        target_url: url,
        analysis: '',
      };
      keyMap.set(item.finding.matchedValue, entry);
      result.push(entry);
    } else {
      // 非 api_key 类型，直接保留
      result.push({
        finding: item.finding,
        classified: item.classified,
        sourceUrls: [url],
        target_url: url,
        analysis: '',
      });
    }
  }

  return result;
}

// ====== AI 泄露分析 ======

interface AIAnalysisResult {
  provider?: string;
  base_url?: string;
  model?: string;
  key_value?: string;
  analysis?: string;
}

/**
 * 用 AI 分析每个 finding 的源文件上下文，同时提取 key 信息和生成分析报告
 * 仅分析 api_key 类型，其他类型直接返回
 */
async function analyzeFindings(deduped: DedupedFinding[]): Promise<DedupedFinding[]> {
  const chatSettings = getAllChatSettings().filter((s) => s.enabled === 1);

  for (const item of deduped) {
    const isApiKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token";
    if (!isApiKey) continue;

    // 取完整文件内容（最多 2000 字符）给 AI 分析
    const content = item.finding.content.slice(0, 2000);

    // 尝试 AI 分析
    if (chatSettings.length > 0) {
      for (const setting of chatSettings) {
        try {
          const model = createModel(setting);
          const result = await generateText({
            model,
            system: "你是一个 API 安全分析师。只输出 JSON，不要其他内容。不要使用思考标签。",
            prompt: AI_ANALYZE_PROMPT + "\n\n源文件内容：\n" + content,
            temperature: 0.2,
          });
          // 剥离 <think> 标签内容
          const text = result.text.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think[\s\S]*$/gi, '').trim();
          // 尝试解析 JSON
          const parsed = parseAIAnalysis(text);
          if (parsed.analysis && parsed.analysis.length > 10) {
            // 用 AI 提取的信息覆盖正则分类结果
            if (parsed.provider && parsed.provider !== 'unknown') {
              item.classified.provider = sanitizeKey(parsed.provider);
            }
            if (parsed.base_url) {
              item.classified.base_url = sanitizeKey(parsed.base_url);
            }
            if (parsed.model) {
              item.classified.model = sanitizeKey(parsed.model);
            }
            if (parsed.key_value) {
              item.finding.matchedValue = sanitizeKey(parsed.key_value);
            }
            item.analysis = parsed.analysis.slice(0, 800);
            break;
          }
        } catch {
          // 尝试下一个配置
        }
      }
    }

    // AI 分析失败时使用规则生成
    if (!item.analysis) {
      const path = item.finding.path;
      const sourceCount = item.sourceUrls.length;
      const parts: string[] = [];
      parts.push(`- 泄露来源：${path}`);
      if (sourceCount > 1) parts.push(`（在 ${sourceCount} 个文件中重复发现）`);
      parts.push(`\n- 上下文：密钥出现在 ${path.split('/').pop() || path} 文件中`);
      parts.push(`\n- 风险评估：${item.classified.confidence === 'high' ? '高风险' : '中风险'}，建议立即轮换密钥`);
      item.analysis = parts.join('');
    }
  }

  return deduped;
}

function parseAIAnalysis(text: string): AIAnalysisResult {
  try {
    return JSON.parse(text);
  } catch {
    // 尝试从文本中提取 JSON 块
    const jsonMatch = text.match(/\{[\s\S]*?"analysis"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch { /* ignore */ }
    }
    return {};
  }
}

// ====== 递归目录爬取 + 扫描 ======

/**
 * 递归爬取目录列表并扫描文件内容
 */
async function crawlAndScan(
  baseUrl: string,
  currentUrl: string,
  depth: number,
  visited: Set<string>,
  stats: CrawlStats,
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  if (depth > MAX_DEPTH) return findings;
  if (stats.filesScanned >= MAX_FILES) return findings;
  if (visited.has(currentUrl)) return findings;
  visited.add(currentUrl);

  try {
    const content = await fetchUrl(currentUrl);
    if (!content) return findings;

    // 判断是否为目录列表页
    const isDirListing = content.includes("Directory listing") || content.includes("Index of");

    if (isDirListing) {
      stats.dirsScanned++;
      console.log(`[hunt/scan] [depth=${depth}] 目录: ${currentUrl.replace(baseUrl, '') || '/'}`);

      // 解析目录列表中的所有链接
      const links = parseDirectoryLinks(content, currentUrl);

      // 分离目录和文件，目录在前（深度优先）
      const dirs: string[] = [];
      const files: string[] = [];

      for (const link of links) {
        const relativePath = link.replace(baseUrl, "");
        if (link.endsWith("/")) {
          // 是目录
          const dirName = relativePath.replace(/\/$/, "").split("/").pop() || "";
          if (!SKIP_DIRS.has(dirName) && !dirName.startsWith(".")) {
            dirs.push(link);
          } else if (SENSITIVE_FILES.has(dirName) || dirName === ".config" || dirName === ".agents") {
            // 允许某些以.开头的目录
            dirs.push(link);
          }
        } else {
          files.push(link);
        }
      }

      // 优先扫描当前目录下的敏感文件
      const prioritizedFiles = prioritizeFiles(files);

      // 扫描文件
      for (const fileUrl of prioritizedFiles) {
        if (stats.filesScanned >= MAX_FILES) break;
        const fileFindings = await scanFile(baseUrl, fileUrl, stats);
        findings.push(...fileFindings);
      }

      // 递归扫描子目录
      for (const dirUrl of dirs) {
        if (stats.filesScanned >= MAX_FILES) break;
        const dirFindings = await crawlAndScan(baseUrl, dirUrl, depth + 1, visited, stats);
        findings.push(...dirFindings);
      }
    } else {
      // 非目录列表页，直接作为文件扫描
      const fileFindings = scanContent(baseUrl, currentUrl.replace(baseUrl, "") || "/", content);
      findings.push(...fileFindings);
      stats.filesScanned++;
      stats.findingsFound += fileFindings.length;
    }
  } catch (err) {
    // 网络错误，静默继续
  }

  return findings;
}

/**
 * 获取 URL 内容（带超时和大小限制）
 */
async function fetchUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)",
        Accept: "text/html,text/plain,application/json,*/*",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("image/") || contentType.includes("video/") || contentType.includes("audio/")) {
      return null;
    }

    // 检查 Content-Length
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_CONTENT_SIZE * 2) return null;

    const text = await res.text();
    if (text.length > MAX_CONTENT_SIZE) return text.slice(0, MAX_CONTENT_SIZE);
    return text;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * 解析目录列表 HTML 中的链接
 */
function parseDirectoryLinks(html: string, currentUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  // 匹配 href="xxx" 中的链接
  const hrefRegex = /href="([^"]+)"/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    // 跳过上级目录、排序链接、绝对外部链接
    if (href === "../" || href === "/" || href.startsWith("?") || href.startsWith("#")) continue;
    if (href.startsWith("http://") || href.startsWith("https://")) continue;
    if (href.startsWith("%")) continue; // 跳过 URL 编码的文件名（如中文文件名）

    // 构造完整 URL
    let fullUrl: string;
    if (href.startsWith("/")) {
      const base = new URL(currentUrl);
      fullUrl = `${base.protocol}//${base.host}${href}`;
    } else {
      fullUrl = currentUrl.endsWith("/") ? `${currentUrl}${href}` : `${currentUrl}/${href}`;
    }

    if (!seen.has(fullUrl)) {
      seen.add(fullUrl);
      links.push(fullUrl);
    }
  }

  return links;
}

/**
 * 文件优先级排序：敏感文件优先
 */
function prioritizeFiles(fileUrls: string[]): string[] {
  return fileUrls.sort((a, b) => {
    const aName = a.split("/").pop() || "";
    const bName = b.split("/").pop() || "";
    const aExt = getExt(aName);
    const bExt = getExt(bName);

    // 跳过二进制文件
    const aBinary = BINARY_EXTS.has(aExt);
    const bBinary = BINARY_EXTS.has(bExt);
    if (aBinary && !bBinary) return 1;
    if (!aBinary && bBinary) return -1;
    if (aBinary && bBinary) return 0;

    // 敏感文件优先
    const aSensitive = SENSITIVE_FILES.has(aName);
    const bSensitive = SENSITIVE_FILES.has(bName);
    if (aSensitive && !bSensitive) return -1;
    if (!aSensitive && bSensitive) return 1;

    // 可扫描扩展名优先
    const aScannable = SCANNABLE_EXTS.has(aExt);
    const bScannable = SCANNABLE_EXTS.has(bExt);
    if (aScannable && !bScannable) return -1;
    if (!aScannable && bScannable) return 1;

    return 0;
  });
}

/**
 * 获取文件扩展名
 */
function getExt(filename: string): string {
  // 处理无扩展名的文件（如 .bash_history）
  if (filename.startsWith(".") && !filename.includes(".", 1)) return "";
  const dotIdx = filename.lastIndexOf(".");
  return dotIdx >= 0 ? filename.slice(dotIdx) : "";
}

/**
 * 扫描单个文件
 */
async function scanFile(baseUrl: string, fileUrl: string, stats: CrawlStats): Promise<RawFinding[]> {
  const fileName = fileUrl.split("/").pop() || "";
  const ext = getExt(fileName);

  // 跳过二进制文件
  if (BINARY_EXTS.has(ext)) {
    stats.filesSkipped++;
    return [];
  }

  // 检查扩展名是否可扫描
  if (ext && !SCANNABLE_EXTS.has(ext)) {
    stats.filesSkipped++;
    return [];
  }

  const content = await fetchUrl(fileUrl);
  if (!content) {
    stats.filesSkipped++;
    return [];
  }

  stats.filesScanned++;
  const path = fileUrl.replace(baseUrl, "") || "/";
  console.log(`[hunt/scan] 扫描文件 [${stats.filesScanned}/${MAX_FILES}]: ${path}`);

  const findings = scanContent(baseUrl, path, content);
  stats.findingsFound += findings.length;

  if (findings.length > 0) {
    console.log(`[hunt/scan] !! 发现 ${findings.length} 个匹配: ${path}`);
    for (const f of findings) {
      console.log(`[hunt/scan]    -> ${f.type} (${f.provider}): ${f.matchedValue.slice(0, 30)}...`);
    }
  }

  return findings;
}

/**
 * 在内容中执行正则匹配
 */
function scanContent(baseUrl: string, path: string, content: string): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const { pattern, type, provider } of LLM_KEY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      let matchedValue = match[1] || match[0];
      // 对 api_key / bearer_token / auth_header 类型提前清理，避免 Unicode 垃圾进入去重逻辑
      if (type === 'api_key' || type === 'bearer_token' || type === 'auth_header') {
        matchedValue = sanitizeKey(matchedValue);
      }
      // 去重 + 过滤噪音
      if (matchedValue.length < 10) continue;
      if (!findings.some((f) => f.matchedValue === matchedValue)) {
        findings.push({
          url: baseUrl,
          path,
          content,
          pattern: pattern.source,
          type,
          provider,
          matchedValue,
        });
      }
    }
  }

  return findings;
}

// 已知 LLM API 域名
const LLM_API_DOMAINS = [
  "api.openai.com", "api.anthropic.com", "api.minimaxi.com", "api.minimax.chat",
  "api.deepseek.com", "dashscope.aliyuncs.com", "generativelanguage.googleapis.com",
  "openrouter.ai", "api.together.xyz", "api.groq.com", "api.mistral.ai",
  "api.cohere.com", "api.perplexity.ai", "api.replicate.com",
];

/**
 * 使用规则或 AI 分类发现
 */
async function classifyFinding(finding: RawFinding): Promise<{
  is_llm_related: boolean;
  finding_type?: string;
  provider?: string;
  model?: string | null;
  base_url?: string | null;
  confidence?: string;
}> {
  // 已知 provider 的直接标记 high
  // 但 "openai" 只是 sk- 正则的默认值，需要用上下文进一步确认
  if (finding.provider !== "unknown" && finding.provider !== "openai") {
    return {
      is_llm_related: true,
      finding_type: finding.type,
      provider: finding.provider,
      model: null,
      base_url: null,
      confidence: "high",
    };
  }

  // base_url: 检查是否包含已知 LLM API 域名
  if (finding.type === "base_url") {
    const isKnownLLM = LLM_API_DOMAINS.some(d => finding.matchedValue.includes(d));
    if (isKnownLLM) {
      // 从域名推断 provider
      let provider = "unknown";
      if (finding.matchedValue.includes("openai")) provider = "openai";
      else if (finding.matchedValue.includes("anthropic")) provider = "anthropic";
      else if (finding.matchedValue.includes("minimaxi") || finding.matchedValue.includes("minimax")) provider = "minimax";
      else if (finding.matchedValue.includes("deepseek")) provider = "deepseek";
      else if (finding.matchedValue.includes("googleapis")) provider = "google";
      else if (finding.matchedValue.includes("dashscope") || finding.matchedValue.includes("aliyuncs")) provider = "dashscope";
      else if (finding.matchedValue.includes("openrouter")) provider = "openrouter";
      else if (finding.matchedValue.includes("groq")) provider = "groq";
      else if (finding.matchedValue.includes("together")) provider = "together";
      else if (finding.matchedValue.includes("mistral")) provider = "mistral";
      else if (finding.matchedValue.includes("perplexity")) provider = "perplexity";
      return {
        is_llm_related: true,
        finding_type: "base_url",
        provider,
        model: null,
        base_url: finding.matchedValue,
        confidence: "high",
      };
    }
    // 包含 /v1 路径的也可能是 LLM API
    if (finding.matchedValue.includes("/v1")) {
      return {
        is_llm_related: true,
        finding_type: "base_url",
        provider: "unknown",
        model: null,
        base_url: finding.matchedValue,
        confidence: "medium",
      };
    }
  }

  // model: 直接标记
  if (finding.type === "model") {
    return {
      is_llm_related: true,
      finding_type: "model",
      provider: "unknown",
      model: finding.matchedValue,
      base_url: null,
      confidence: "high",
    };
  }

  // api_key/bearer_token: 从 key 附近的上下文推断 provider
  if (finding.type === "api_key" || finding.type === "bearer_token" || finding.type === "auth_header") {
    // 取 matchedValue 附近的上下文（500字符前 + 200字符后），避免远处的噪音
    const keyIdx = finding.content.indexOf(finding.matchedValue);
    const ctxStart = Math.max(0, keyIdx - 500);
    const ctxEnd = Math.min(finding.content.length, keyIdx + finding.matchedValue.length + 200);
    const context = finding.content.slice(ctxStart, ctxEnd).toLowerCase();

    // 按优先级匹配 provider（先检查更具体的，再检查通用的）
    let inferredProvider = "unknown";
    if (context.includes("minimax") || context.includes("minimaxi")) inferredProvider = "minimax";
    else if (context.includes("deepseek")) inferredProvider = "deepseek";
    else if (context.includes("openrouter")) inferredProvider = "openrouter";
    else if (context.includes("dashscope") || context.includes("qwen") || context.includes("aliyuncs")) inferredProvider = "dashscope";
    else if (context.includes("anthropic") || context.includes("claude")) inferredProvider = "anthropic";
    else if (context.includes("groq")) inferredProvider = "groq";
    // "openai" 需排除 "openai-completions"/"openai-chat" 这类 API 类型名
    else if ((context.includes("openai") && !context.includes("openai-completions") && !context.includes("openai-chat")) || context.includes("gpt-")) inferredProvider = "openai";

    if (inferredProvider !== "unknown") {
      return {
        is_llm_related: true,
        finding_type: finding.type,
        provider: inferredProvider,
        model: null,
        base_url: null,
        confidence: "medium",
      };
    }

    // key 长度 >= 32 的 sk- 开头大概率是 LLM key
    if (finding.matchedValue.startsWith("sk-") && finding.matchedValue.length >= 32) {
      return {
        is_llm_related: true,
        finding_type: "api_key",
        provider: "unknown",
        model: null,
        base_url: null,
        confidence: "medium",
      };
    }
  }

  // 尝试 AI 分类
  const chatSettings = getAllChatSettings().filter((s) => s.enabled === 1);
  if (chatSettings.length > 0) {
    for (const setting of chatSettings) {
      try {
        const model = createModel(setting);
        const result = await generateText({
          model,
          system: CLASSIFY_PROMPT,
          prompt: `分析以下发现的内容：\n类型: ${finding.type}\n匹配值: ${finding.matchedValue.slice(0, 50)}...\n来源路径: ${finding.path}`,
          temperature: 0.1,
        });

        const raw = result.text.trim();
        try {
          return JSON.parse(raw);
        } catch {
          const jsonMatch = raw.match(/\{[\s\S]*"is_llm_related"[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      } catch {
        // 尝试下一个配置
      }
    }
  }

  // 最终规则：长 key 值 + 在敏感文件中 → 可能是 LLM 相关
  const isSensitivePath = [...SENSITIVE_FILES].some(f => finding.path.includes(f));
  return {
    is_llm_related: finding.matchedValue.length >= 32 || (isSensitivePath && finding.matchedValue.length >= 20),
    finding_type: finding.type,
    provider: finding.provider,
    confidence: "low",
  };
}

function createModel(setting: ChatSetting) {
  let baseUrl = setting.base_url?.trim() || undefined;
  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/\/$/, "");
  }

  switch (setting.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: setting.api_key, baseURL: baseUrl });
      return anthropic(setting.model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: setting.api_key, baseURL: baseUrl });
      return google(setting.model);
    }
    default: {
      const openai = createOpenAI({ apiKey: setting.api_key, baseURL: baseUrl });
      return openai.chat(setting.model);
    }
  }
}
