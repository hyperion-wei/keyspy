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
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { registerTask, unregisterTask, abortTask, activeTasks } from "@/lib/hunt-registry";

const execFileAsync = promisify(execFile);

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ====== gitleaks 跨平台配置 ======
const IS_WIN = process.platform === 'win32';

/**
 * 按优先级查找 gitleaks 可执行文件路径
 * 1. 环境变量 GITLEAKS_PATH（最高优先级）
 * 2. 项目本地 tools/ 目录
 * 3. 平台默认路径
 * 4. PATH 中的 gitleaks 命令
 */
function findGitleaksPath(): string {
  // 1. 环境变量
  if (process.env.GITLEAKS_PATH) return process.env.GITLEAKS_PATH;

  // 2. 项目本地 tools/ 目录
  const projectDir = process.cwd();
  const localPaths = [
    path.join(projectDir, 'tools', 'gitleaks', IS_WIN ? 'gitleaks.exe' : 'gitleaks'),
    path.join(projectDir, 'tools', IS_WIN ? 'gitleaks.exe' : 'gitleaks'),
  ];

  // 3. 平台默认路径
  const platformPaths = IS_WIN
    ? ['d:\\tools\\gitleaks\\gitleaks.exe', 'C:\\tools\\gitleaks\\gitleaks.exe']
    : ['/usr/local/bin/gitleaks', '/usr/bin/gitleaks', '/snap/bin/gitleaks'];

  for (const p of [...localPaths, ...platformPaths]) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* continue */ }
  }

  // 4. 尝试系统 PATH 中的 gitleaks
  return IS_WIN ? 'gitleaks.exe' : 'gitleaks';
}

function findEnhancedRules(): string | null {
  // 1. 环境变量
  if (process.env.GITLEAKS_ENHANCED_RULES) return process.env.GITLEAKS_ENHANCED_RULES;

  const candidates = [
    path.join(process.cwd(), 'tools', 'gitleaks', 'enhanced-rules.toml'),
    path.join(process.cwd(), 'tools', 'enhanced-rules.toml'),
    ...(IS_WIN
      ? ['d:\\tools\\gitleaks\\enhanced-rules.toml', 'C:\\tools\\gitleaks\\enhanced-rules.toml']
      : ['/usr/local/etc/gitleaks/enhanced-rules.toml']),
  ];

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch { /* continue */ }
  }
  return null;
}

const GITLEAKS_PATH = findGitleaksPath();
const GITLEAKS_ENHANCED_RULES = findEnhancedRules();
console.log(`[hunt/scan] gitleaks: path=${GITLEAKS_PATH}, enhanced_rules=${GITLEAKS_ENHANCED_RULES || '(未找到)'}`);

// ====== 目录爬取配置 ======
const MAX_DEPTH = 3;
const MAX_FILES = 300;
const FETCH_TIMEOUT = 8000;
const MAX_CONTENT_SIZE = 200000;
const MAX_CONCURRENCY = 3; // 最大并发数

// ====== 进度跟踪类型 ======
interface TargetProgress {
  url: string;
  phase: 'downloading' | 'scanning' | 'classifying' | 'done' | 'error';
  filesDownloaded: number;
  dirsScanned: number;
  rawFindings: number;
  llmFindings: number;
  error?: string;
}

const SENSITIVE_FILES = new Set([
  ".env", ".env.local", ".env.production", ".env.development",
  ".npmrc", ".bash_history", ".zsh_history", ".bashrc", ".zshrc", ".profile",
  ".gitconfig", ".git-credentials",
  "config.json", "config.yaml", "config.yml", "config.toml", "config.ini",
  "settings.json", "package.json", "docker-compose.yml", "docker-compose.yaml",
  "Dockerfile", "Makefile",
]);

const SCANNABLE_EXTS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg",
  ".env", ".txt", ".md", ".log", ".sh", ".bash", ".zsh", ".py", ".js", ".ts",
  ".html", ".htm", ".xml", ".csv", ".sql", ".properties",
  "",
]);

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

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", "__pycache__", ".cache",
  ".local", ".npm", ".cargo", ".rustup",
]);

// ====== gitleaks RuleID 过滤 ======
const LLM_RELATED_DEFAULT_RULES = new Set([
  "generic-api-key", "openai-api-key", "anthropic-api-key",
  "google-api-key", "aws-access-key-id", "aws-secret-access-key",
]);

const LLM_RELATED_ENHANCED_RULES = new Set([
  "env-secret", "plaintext-password",
  "connection-string", "plaintext-username-password",
  "json-api-key-sk-prefix", "json-api-key-uuid", "json-api-key-generic",
]);

// ====== Types ======

interface GitleaksResult {
  RuleID: string;
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string;
  Secret: string;
  File: string;
  SymlinkFile: string;
  Commit: string;
  Entropy: number;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
  Tags: string[];
  Fingerprint: string;
}

interface RawFinding {
  url: string;
  path: string;
  content: string;
  pattern: string;
  type: string;
  provider: string;
  matchedValue: string;
  ruleId: string;
}

interface ScanTarget {
  url: string;
  host: string;
  port: string;
  protocol: string;
}

interface CrawlStats {
  filesScanned: number;
  dirsScanned: number;
  filesSkipped: number;
}

// ====== 任务中断注册表 (使用 lib/hunt-registry) ======

// ====== API Endpoint ======

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "未授权" }, { status: 401 });

  const body = await request.json();
  const { targets } = body;
  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    return Response.json({ error: "请提供扫描目标" }, { status: 400 });
  }

  try {
    fs.accessSync(GITLEAKS_PATH, fs.constants.X_OK);
  } catch {
    const installHint = IS_WIN
      ? "Windows: 下载 gitleaks.exe 放入项目 tools/gitleaks/ 目录，或设置环境变量 GITLEAKS_PATH"
      : "Linux: apt install gitleaks 或下载二进制到 /usr/local/bin/gitleaks，或设置环境变量 GITLEAKS_PATH";
    return Response.json(
      { error: `gitleaks 工具不可用 (${GITLEAKS_PATH})。${installHint}` },
      { status: 500 }
    );
  }

  const task = createHuntTask(targets.length);
  registerTask(task.id);
  runScan(task.id, targets as ScanTarget[]).catch((err) => {
    console.error(`[hunt/scan] Task ${task.id} failed:`, err);
    updateHuntTask(task.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  }).finally(() => {
    unregisterTask(task.id);
  });

  return Response.json({ success: true, taskId: task.id, message: `扫描任务已启动，共 ${targets.length} 个目标` });
}

/**
 * PUT /api/hunt/scan
 * 暂停/中断扫描任务
 */
export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "未授权" }, { status: 401 });

  const body = await request.json();
  const { taskId, action } = body;

  if (!taskId) {
    return Response.json({ error: "缺少 taskId" }, { status: 400 });
  }

  if (action === "abort") {
    const wasRunning = abortTask(Number(taskId));
    if (wasRunning) {
      updateHuntTask(Number(taskId), { status: "failed", error: "用户手动中断" });
      return Response.json({ success: true, message: "任务已中断" });
    }
    // 不在活跃任务中，直接标记
    updateHuntTask(Number(taskId), { status: "failed", error: "用户手动中断" });
    return Response.json({ success: true, message: "任务已标记为中断" });
  }

  return Response.json({ error: "未知 action" }, { status: 400 });
}

// ====== 扫描主流程（多并发）======

async function runScan(taskId: number, targets: ScanTarget[]) {
  const tempDir = createTempDir();
  console.log(`[hunt/scan] Task #${taskId} 启动，共 ${targets.length} 个目标，并发数: ${MAX_CONCURRENCY}`);
  console.log(`[hunt/scan] 临时目录: ${tempDir}`);

  const ctrl = activeTasks.get(taskId);
  if (!ctrl) return;

  // 检查是否被中断
  function isAborted(): boolean {
    return ctrl!.aborted;
  }

  // 进度状态
  const progressMap = new Map<string, TargetProgress>();
  const completedCount = { value: 0 };
  let totalFindings = 0;

  // 更新进度的辅助函数
  function updateProgress() {
    const progressObj: Record<string, TargetProgress> = {};
    for (const [url, p] of progressMap) {
      progressObj[url] = p;
    }
    updateHuntTask(taskId, {
      completed: completedCount.value,
      progress: JSON.stringify(progressObj),
    });
  }

  // 初始化所有目标的进度
  for (const target of targets) {
    const baseUrl = `${target.protocol}://${target.host}:${target.port}`;
    progressMap.set(baseUrl, {
      url: baseUrl,
      phase: 'downloading',
      filesDownloaded: 0,
      dirsScanned: 0,
      rawFindings: 0,
      llmFindings: 0,
    });
  }
  updateProgress();

  // 并发池
  const processTarget = async (target: ScanTarget): Promise<void> => {
    if (isAborted()) return;
    const baseUrl = `${target.protocol}://${target.host}:${target.port}`;
    const targetTempDir = path.join(tempDir, `${target.host}_${target.port}`);
    const progress = progressMap.get(baseUrl)!;

    try {
      console.log(`[hunt/scan] Task #${taskId} 开始处理: ${baseUrl}`);

      // === Phase 1: 下载 ===
      progress.phase = 'downloading';
      updateProgress();

      const stats: CrawlStats = { filesScanned: 0, dirsScanned: 0, filesSkipped: 0 };
      const fileUrlMap = new Map<string, string>();
      await crawlAndDownload(baseUrl, baseUrl, 0, new Set(), stats, targetTempDir, fileUrlMap);

      if (isAborted()) {
        progress.phase = 'error';
        progress.error = '任务已中断';
        completedCount.value++;
        updateProgress();
        return;
      }

      progress.filesDownloaded = stats.filesScanned;
      progress.dirsScanned = stats.dirsScanned;
      console.log(`[hunt/scan] ${baseUrl} 下载完成: 文件=${stats.filesScanned}, 目录=${stats.dirsScanned}`);
      updateProgress();

      if (stats.filesScanned === 0) {
        progress.phase = 'done';
        completedCount.value++;
        updateProgress();
        return;
      }

      // === Phase 2: Gitleaks 扫描 ===
      progress.phase = 'scanning';
      updateProgress();

      const defaultResults = await runGitleaks(targetTempDir);
      if (isAborted()) {
        progress.phase = 'error';
        progress.error = '任务已中断';
        completedCount.value++;
        updateProgress();
        return;
      }

      const enhancedResults = await runGitleaks(targetTempDir, GITLEAKS_ENHANCED_RULES || undefined);
      if (isAborted()) {
        progress.phase = 'error';
        progress.error = '任务已中断';
        completedCount.value++;
        updateProgress();
        return;
      }

      const merged = mergeAndFilterReports(defaultResults, enhancedResults);

      progress.rawFindings = merged.length;
      console.log(`[hunt/scan] ${baseUrl} gitleaks: 默认=${defaultResults.length}, 增强=${enhancedResults.length}, 合并=${merged.length}`);
      updateProgress();

      // === Phase 3: 分类 + 聚合 + 存储 ===
      progress.phase = 'classifying';
      updateProgress();

      const findings = mapToFindings(merged, targetTempDir, baseUrl, fileUrlMap);

      // 分类并存储每个 finding
      const classified: Array<{
        finding: RawFinding;
        classified: { is_llm_related: boolean; finding_type?: string; provider?: string; model?: string | null; base_url?: string | null; confidence?: string };
      }> = [];

      for (const finding of findings) {
        if (isAborted()) break;
        const cls = await classifyFinding(finding);
        console.log(`[classify-result] ${finding.matchedValue.slice(0,30)} → is_llm_related=${cls.is_llm_related}, provider=${cls.provider}`);
        if (cls.is_llm_related) {
          classified.push({ finding, classified: cls });
        }
      }

      if (isAborted()) {
        progress.phase = 'error';
        progress.error = '任务已中断';
        completedCount.value++;
        updateProgress();
        return;
      }

      // 同文件聚合
      aggregateSameFileFindings(classified);

      // 去重
      const deduped = deduplicateByKey(classified);

      // AI 分析
      const analyzed = await analyzeFindings(deduped);

      if (isAborted()) {
        progress.phase = 'error';
        progress.error = '任务已中断';
        completedCount.value++;
        updateProgress();
        return;
      }

      // 存储到数据库
      let targetFindings = 0;
      for (const item of analyzed) {
        const cleanKey = item.finding.matchedValue ? sanitizeKey(item.finding.matchedValue).slice(0, 200) : '';
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
        targetFindings++;
      }

      progress.llmFindings = targetFindings;
      totalFindings += targetFindings;
      progress.phase = 'done';
      completedCount.value++;
      updateProgress();

      console.log(`[hunt/scan] ${baseUrl} 完成: ${targetFindings} 个发现`);
    } catch (err) {
      if (isAborted()) return;
      console.warn(`[hunt/scan] ${baseUrl} 失败:`, err);
      progress.phase = 'error';
      progress.error = err instanceof Error ? err.message : String(err);
      completedCount.value++;
      updateProgress();
    }
  };

  // 并发执行
  try {
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, targets.length) }, async (_, workerIdx) => {
      for (let i = workerIdx; i < targets.length; i += MAX_CONCURRENCY) {
        if (isAborted()) return;
        await processTarget(targets[i]);
      }
    });
    await Promise.all(workers);

    // 最终状态
    if (isAborted()) {
      console.log(`[hunt/scan] Task #${taskId} 已中断`);
    } else {
      updateHuntTask(taskId, {
        status: "completed",
        completed: targets.length,
        findings_count: totalFindings,
        progress: JSON.stringify(Object.fromEntries(progressMap)),
      });
      console.log(`[hunt/scan] Task #${taskId} 全部完成: ${totalFindings} 个发现`);
    }
  } finally {
    cleanupTempDir(tempDir);
  }
}

// ====== 临时目录 ======

function createTempDir(): string {
  const dir = path.join(os.tmpdir(), "hunt-scan", `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveToTempDir(tempDir: string, relativePath: string, content: string): string {
  const filePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function cleanupTempDir(tempDir: string) {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (err) { console.warn(`[hunt/scan] 清理临时目录失败:`, err); }
}

// ====== gitleaks CLI ======

async function runGitleaks(dir: string, configPath?: string): Promise<GitleaksResult[]> {
  const tag = configPath ? 'enhanced' : 'default';
  const reportPath = path.join(dir, `gitleaks-${tag}-${Date.now()}.json`);
  const args = ["dir", dir, "--no-color", "-f", "json", "-r", reportPath];
  if (configPath) args.push("-c", configPath);

  try {
    await execFileAsync(GITLEAKS_PATH, args, { timeout: 120000 });
    return []; // exit 0 = no leaks
  } catch (err: unknown) {
    const execErr = err as { code?: number; stderr?: string };
    if (execErr.code !== 1) {
      console.warn(`[gitleaks] 异常 (code=${execErr.code}): ${execErr.stderr?.slice(0, 200)}`);
      return [];
    }
    // exit 1 = leaks found
  }

  try {
    const report = fs.readFileSync(reportPath, "utf-8");
    const results: GitleaksResult[] = JSON.parse(report);
    try { fs.unlinkSync(reportPath); } catch { /* ignore */ }
    return results;
  } catch { return []; }
}

function mergeAndFilterReports(defaultResults: GitleaksResult[], enhancedResults: GitleaksResult[]): GitleaksResult[] {
  const seen = new Set<string>();
  const results: GitleaksResult[] = [];
  for (const r of defaultResults) {
    if (LLM_RELATED_DEFAULT_RULES.has(r.RuleID) && !seen.has(r.Fingerprint)) {
      seen.add(r.Fingerprint);
      results.push(r);
    }
  }
  for (const r of enhancedResults) {
    if (LLM_RELATED_ENHANCED_RULES.has(r.RuleID) && !seen.has(r.Fingerprint)) {
      seen.add(r.Fingerprint);
      results.push(r);
    }
  }
  return results;
}

// ====== 结果映射 ======

function mapToFindings(results: GitleaksResult[], tempDir: string, baseUrl: string, fileUrlMap: Map<string, string>): RawFinding[] {
  const findings: RawFinding[] = [];
  const normTemp = tempDir.replace(/\\/g, "/");

  for (const r of results) {
    let relativePath = r.File.replace(/\\/g, "/");
    if (relativePath.startsWith(normTemp)) relativePath = relativePath.slice(normTemp.length);
    if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
    if (relativePath.includes("gitleaks-") || relativePath.includes(".git/")) continue;

    const webUrl = fileUrlMap.get(relativePath) || `${baseUrl}/${relativePath}`;
    let content = "";
    try { content = fs.readFileSync(path.join(tempDir, relativePath), "utf-8").slice(0, 5000); } catch { /* ignore */ }

    let matchedValue = r.Secret;
    if (r.RuleID === "env-secret" && matchedValue.includes("=")) {
      matchedValue = matchedValue.slice(matchedValue.indexOf("=") + 1);
    }
    matchedValue = sanitizeKey(matchedValue);
    if (matchedValue.length < 8) {
      continue;
    }

    const { type, provider } = inferTypeAndProvider(r, content, matchedValue);
    findings.push({
      url: baseUrl, path: "/" + relativePath, content,
      pattern: `gitleaks:${r.RuleID}`, type, provider, matchedValue, ruleId: r.RuleID,
    });
  }
  return findings;
}

function inferTypeAndProvider(result: GitleaksResult, content: string, matchedValue: string): { type: string; provider: string } {
  // sk- 前缀识别（适用于 generic-api-key 和 json-api-key-sk-prefix）
  const isSkPrefix = result.RuleID === "generic-api-key" || result.RuleID === "json-api-key-sk-prefix";
  if (isSkPrefix) {
    if (matchedValue.startsWith("sk-ant-")) return { type: "api_key", provider: "anthropic" };
    if (matchedValue.startsWith("sk-proj-")) return { type: "api_key", provider: "openai" };
    if (matchedValue.startsWith("sk-cp-")) return { type: "api_key", provider: "minimax" };
    if (matchedValue.startsWith("sk-")) return { type: "api_key", provider: "openai-compatible" };
    if (matchedValue.startsWith("eyJ")) return { type: "api_key", provider: "unknown" };
    return { type: "api_key", provider: "unknown" };
  }

  // UUID 格式 key（火山引擎等）
  if (result.RuleID === "json-api-key-uuid") {
    return { type: "api_key", provider: "unknown" };
  }

  // JSON 中的通用长 key
  if (result.RuleID === "json-api-key-generic") {
    if (matchedValue.startsWith("sk-ant-")) return { type: "api_key", provider: "anthropic" };
    if (matchedValue.startsWith("sk-cp-")) return { type: "api_key", provider: "minimax" };
    if (matchedValue.startsWith("sk-")) return { type: "api_key", provider: "openai-compatible" };
    return { type: "api_key", provider: "unknown" };
  }

  if (result.RuleID.includes("openai")) return { type: "api_key", provider: "openai" };
  if (result.RuleID.includes("anthropic")) return { type: "api_key", provider: "anthropic" };
  if (result.RuleID.includes("google")) return { type: "api_key", provider: "google" };

  if (result.RuleID === "env-secret") {
    const varName = result.Match.split("=")[0].toLowerCase();
    const providerMap: Record<string, string> = {
      openai: "openai", anthropic: "anthropic", minimax: "minimax",
      deepseek: "deepseek", dashscope: "dashscope", qwen: "dashscope",
      google: "google", gemini: "google", openrouter: "openrouter",
      groq: "groq", together: "together", mistral: "mistral", perplexity: "perplexity",
      volcengine: "volcengine", doubao: "volcengine", ark: "volcengine",
      bailian: "dashscope", siliconflow: "siliconflow",
    };
    for (const [key, prov] of Object.entries(providerMap)) {
      if (varName.includes(key)) return { type: "api_key", provider: prov };
    }
    if (matchedValue.startsWith("sk-ant-")) return { type: "api_key", provider: "anthropic" };
    if (matchedValue.startsWith("sk-cp-")) return { type: "api_key", provider: "minimax" };
    if (matchedValue.startsWith("sk-") && matchedValue.length >= 32) return { type: "api_key", provider: "openai-compatible" };
    if (matchedValue.startsWith("eyJ")) return { type: "api_key", provider: "unknown" };
    return { type: "api_key", provider: "unknown" };
  }

  if (result.RuleID === "plaintext-password" || result.RuleID === "plaintext-username-password") {
    return { type: "password", provider: "unknown" };
  }
  if (result.RuleID === "connection-string") return { type: "connection_string", provider: "unknown" };
  return { type: "api_key", provider: "unknown" };
}

// ====== 递归目录爬取 ======

async function crawlAndDownload(
  baseUrl: string, currentUrl: string, depth: number, visited: Set<string>,
  stats: CrawlStats, tempDir: string, fileUrlMap: Map<string, string>,
): Promise<void> {
  if (depth > MAX_DEPTH || stats.filesScanned >= MAX_FILES || visited.has(currentUrl)) return;
  visited.add(currentUrl);

  try {
    const content = await fetchUrl(currentUrl);
    if (!content) return;

    const isDir = content.includes("Directory listing") || content.includes("Index of");
    if (isDir) {
      stats.dirsScanned++;
      const links = parseDirectoryLinks(content, currentUrl);
      const dirs: string[] = [];
      const files: string[] = [];

      for (const link of links) {
        const rel = link.replace(baseUrl, "");
        if (link.endsWith("/")) {
          const dirName = rel.replace(/\/$/, "").split("/").pop() || "";
          if (!SKIP_DIRS.has(dirName) && !dirName.startsWith(".")) dirs.push(link);
          else if (SENSITIVE_FILES.has(dirName) || dirName === ".config" || dirName === ".agents") dirs.push(link);
        } else {
          files.push(link);
        }
      }

      for (const fileUrl of prioritizeFiles(files)) {
        if (stats.filesScanned >= MAX_FILES) break;
        await downloadAndSaveFile(baseUrl, fileUrl, stats, tempDir, fileUrlMap);
      }
      for (const dirUrl of dirs) {
        if (stats.filesScanned >= MAX_FILES) break;
        await crawlAndDownload(baseUrl, dirUrl, depth + 1, visited, stats, tempDir, fileUrlMap);
      }
    } else {
      const relPath = (currentUrl.replace(baseUrl, "") || "/index.html").replace(/^\//, "");
      saveToTempDir(tempDir, relPath, content);
      fileUrlMap.set(relPath, currentUrl);
      stats.filesScanned++;
    }
  } catch { /* 网络错误，静默 */ }
}

async function downloadAndSaveFile(
  baseUrl: string, fileUrl: string, stats: CrawlStats,
  tempDir: string, fileUrlMap: Map<string, string>,
): Promise<void> {
  const fileName = fileUrl.split("/").pop() || "";
  const ext = getExt(fileName);
  if (BINARY_EXTS.has(ext) || (ext && !SCANNABLE_EXTS.has(ext))) { stats.filesSkipped++; return; }

  const content = await fetchUrl(fileUrl);
  if (!content) { stats.filesSkipped++; return; }

  stats.filesScanned++;
  const relPath = (fileUrl.replace(baseUrl, "") || fileName).replace(/^\//, "");
  saveToTempDir(tempDir, relPath, content);
  fileUrlMap.set(relPath, fileUrl);
}

async function fetchUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)", Accept: "text/html,text/plain,application/json,*/*" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("image/") || ct.includes("video/") || ct.includes("audio/")) return null;
    const cl = parseInt(res.headers.get("content-length") || "0", 10);
    if (cl > MAX_CONTENT_SIZE * 2) return null;
    const text = await res.text();
    return text.length > MAX_CONTENT_SIZE ? text.slice(0, MAX_CONTENT_SIZE) : text;
  } catch { clearTimeout(timeout); return null; }
}

// ====== 目录解析 ======

function parseDirectoryLinks(html: string, currentUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const hrefRegex = /href="([^"]+)"/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href === "../" || href === "/" || href.startsWith("?") || href.startsWith("#") || href.startsWith("http://") || href.startsWith("https://") || href.startsWith("%")) continue;
    const fullUrl = href.startsWith("/") ? `${new URL(currentUrl).origin}${href}` : (currentUrl.endsWith("/") ? `${currentUrl}${href}` : `${currentUrl}/${href}`);
    if (!seen.has(fullUrl)) { seen.add(fullUrl); links.push(fullUrl); }
  }
  return links;
}

function prioritizeFiles(fileUrls: string[]): string[] {
  return fileUrls.sort((a, b) => {
    const aN = a.split("/").pop() || "", bN = b.split("/").pop() || "";
    const aE = getExt(aN), bE = getExt(bN);
    const aBin = BINARY_EXTS.has(aE), bBin = BINARY_EXTS.has(bE);
    if (aBin !== bBin) return aBin ? 1 : -1;
    const aSens = SENSITIVE_FILES.has(aN), bSens = SENSITIVE_FILES.has(bN);
    if (aSens !== bSens) return aSens ? -1 : 1;
    const aScan = SCANNABLE_EXTS.has(aE), bScan = SCANNABLE_EXTS.has(bE);
    if (aScan !== bScan) return aScan ? -1 : 1;
    return 0;
  });
}

function getExt(filename: string): string {
  if (filename.startsWith(".") && !filename.includes(".", 1)) return "";
  const d = filename.lastIndexOf(".");
  return d >= 0 ? filename.slice(d) : "";
}

// ====== 分类 ======

const CLASSIFY_PROMPT = `分析以下从网站扫描中发现的敏感内容（由 gitleaks 检测），判断是否为 LLM/AI 模型相关的密钥泄露。

判断要点：
1. 是否为 LLM API Key（属于 openai/anthropic/google/minimax/deepseek/dashscope/openrouter/groq/together/mistral/perplexity 等）
2. 置信度（high/medium/low）

如果内容明显不是 LLM 相关的（如数据库密码、普通 Web API Key、session token 等），返回 {"is_llm_related": false}

只输出 JSON：
{"is_llm_related": true, "finding_type": "api_key", "provider": "openai", "confidence": "high"}
或
{"is_llm_related": false}`;

const LLM_API_DOMAINS = [
  "api.openai.com", "api.anthropic.com", "api.minimaxi.com", "api.minimax.chat",
  "api.deepseek.com", "dashscope.aliyuncs.com", "generativelanguage.googleapis.com",
  "openrouter.ai", "api.together.xyz", "api.groq.com", "api.mistral.ai",
  "api.cohere.com", "api.perplexity.ai", "api.replicate.com",
  "ark.cn-beijing.volces.com", "api.siliconflow.cn",
  "api.baichuan-ai.com", "api.moonshot.cn", "api.zhipuai.cn",
  "api.lingyiwanwu.com", "api.stepfun.com",
];

async function classifyFinding(finding: RawFinding): Promise<{
  is_llm_related: boolean; finding_type?: string; provider?: string;
  model?: string | null; base_url?: string | null; confidence?: string;
}> {
  // 已知 provider → high confidence
  if (finding.provider !== "unknown") {
    return { is_llm_related: true, finding_type: finding.type, provider: finding.provider, model: null, base_url: null, confidence: "high" };
  }

  // 非 LLM 核心类型
  if (finding.type === "password" || finding.type === "connection_string") {
    return { is_llm_related: false, finding_type: finding.type, provider: "unknown", confidence: "low" };
  }

  // 上下文推断 provider
  if (finding.type === "api_key" || finding.type === "bearer_token") {
    const keyIdx = finding.content.indexOf(finding.matchedValue);
    const ctxStart = Math.max(0, keyIdx >= 0 ? keyIdx - 500 : 0);
    const ctxEnd = Math.min(finding.content.length, (keyIdx >= 0 ? keyIdx : 0) + finding.matchedValue.length + 200);
    const ctx = finding.content.slice(ctxStart, ctxEnd).toLowerCase();

    let inferred = "unknown";
    if (ctx.includes("minimax") || ctx.includes("minimaxi")) inferred = "minimax";
    else if (ctx.includes("deepseek")) inferred = "deepseek";
    else if (ctx.includes("openrouter")) inferred = "openrouter";
    else if (ctx.includes("dashscope") || ctx.includes("qwen") || ctx.includes("aliyuncs") || ctx.includes("bailian")) inferred = "dashscope";
    else if (ctx.includes("volcengine") || ctx.includes("volces") || ctx.includes("doubao") || ctx.includes("cn-beijing")) inferred = "volcengine";
    else if (ctx.includes("siliconflow")) inferred = "siliconflow";
    else if (ctx.includes("anthropic") || ctx.includes("claude")) inferred = "anthropic";
    else if (ctx.includes("groq")) inferred = "groq";
    else if (ctx.includes("baichuan")) inferred = "baichuan";
    else if (ctx.includes("moonshot") || ctx.includes("kimi")) inferred = "moonshot";
    else if (ctx.includes("zhipuai") || ctx.includes("glm")) inferred = "zhipuai";
    else if (ctx.includes("lingyiwanwu") || ctx.includes("yi-")) inferred = "yi";
    else if (ctx.includes("stepfun")) inferred = "stepfun";
    else if ((ctx.includes("openai") && !ctx.includes("openai-completions") && !ctx.includes("openai-chat")) || ctx.includes("gpt-")) inferred = "openai";

    if (inferred !== "unknown") {
      return { is_llm_related: true, finding_type: finding.type, provider: inferred, model: null, base_url: null, confidence: "medium" };
    }

    if (finding.matchedValue.startsWith("sk-") && finding.matchedValue.length >= 20) {
      return { is_llm_related: true, finding_type: "api_key", provider: "unknown", model: null, base_url: null, confidence: "medium" };
    }

    // UUID 格式 key（火山引擎等）
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(finding.matchedValue)) {
      return { is_llm_related: true, finding_type: "api_key", provider: "unknown", model: null, base_url: null, confidence: "low" };
    }

    // 从 JSON apiKey 规则发现的长 key
    if (finding.ruleId?.startsWith("json-api-key") && finding.matchedValue.length >= 20) {
      return { is_llm_related: true, finding_type: "api_key", provider: "unknown", model: null, base_url: null, confidence: "medium" };
    }
  }

  // AI 分类 fallback
  const chatSettings = getAllChatSettings().filter((s) => s.enabled === 1);
  for (const setting of chatSettings) {
    try {
      const model = createModel(setting);
      const result = await generateText({
        model, system: CLASSIFY_PROMPT,
        prompt: `分析以下 gitleaks 发现：\n规则: ${finding.ruleId}\n类型: ${finding.type}\n匹配值: ${finding.matchedValue.slice(0, 50)}...\n来源: ${finding.path}`,
        temperature: 0.1,
      });
      const raw = result.text.trim();
      try { return JSON.parse(raw); } catch {
        const m = raw.match(/\{[\s\S]*"is_llm_related"[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
      }
    } catch { /* next */ }
  }

  // 最终规则
  const isSensPath = [...SENSITIVE_FILES].some(f => finding.path.includes(f));
  return {
    is_llm_related: finding.matchedValue.length >= 32 || (isSensPath && finding.matchedValue.length >= 20),
    finding_type: finding.type, provider: finding.provider, confidence: "low",
  };
}

// ====== Provider 默认映射 ======

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
  volcengine: { base_url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", model: "doubao-pro-32k" },
  siliconflow: { base_url: "https://api.siliconflow.cn/v1/chat/completions", model: "deepseek-ai/DeepSeek-V3" },
  baichuan: { base_url: "https://api.baichuan-ai.com/v1/chat/completions", model: "Baichuan4" },
  moonshot: { base_url: "https://api.moonshot.cn/v1/chat/completions", model: "moonshot-v1-8k" },
  zhipuai: { base_url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: "glm-4-flash" },
};

// ====== 同文件聚合 ======

function aggregateSameFileFindings(
  classifiedFindings: Array<{ finding: RawFinding; classified: { is_llm_related: boolean; finding_type?: string; provider?: string; model?: string | null; base_url?: string | null; confidence?: string } }>
) {
  const groups = new Map<string, typeof classifiedFindings>();
  for (const item of classifiedFindings) {
    const key = item.finding.url + item.finding.path;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const [, group] of groups) {
    const baseUrls: string[] = [];
    const models: string[] = [];
    for (const item of group) {
      if (item.classified.finding_type === "base_url" && item.classified.base_url) baseUrls.push(item.classified.base_url);
      if (item.classified.finding_type === "model" && item.classified.model) models.push(item.classified.model);
    }

    for (const item of group) {
      const isKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token" || item.classified.finding_type === "auth_header";
      if (isKey) {
        if (!item.classified.base_url && baseUrls.length > 0) item.classified.base_url = baseUrls[0];
        if (!item.classified.model && models.length > 0) item.classified.model = models[0];
        const defaults = PROVIDER_DEFAULTS[item.classified.provider || "unknown"];
        if (defaults) {
          if (!item.classified.base_url) item.classified.base_url = defaults.base_url;
          if (!item.classified.model) item.classified.model = defaults.model;
        }
      }
    }

    for (const item of group) {
      const isMeta = item.classified.finding_type === "base_url" || item.classified.finding_type === "model";
      const hasKey = group.some(g => g !== item && (g.classified.finding_type === "api_key" || g.classified.finding_type === "bearer_token" || g.classified.finding_type === "auth_header"));
      if (isMeta && hasKey) item.classified.is_llm_related = false;
    }
  }

  for (const item of classifiedFindings) {
    const isKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token";
    if (isKey && !item.classified.base_url) {
      const defaults = PROVIDER_DEFAULTS[item.classified.provider || "unknown"];
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
  classified: { is_llm_related: boolean; finding_type?: string; provider?: string; model?: string | null; base_url?: string | null; confidence?: string };
  sourceUrls: string[];
  target_url: string;
  analysis: string;
}

function deduplicateByKey(
  classifiedFindings: Array<{ finding: RawFinding; classified: { is_llm_related: boolean; finding_type?: string; provider?: string; model?: string | null; base_url?: string | null; confidence?: string } }>
): DedupedFinding[] {
  const result: DedupedFinding[] = [];
  const keyMap = new Map<string, DedupedFinding>();

  for (const item of classifiedFindings) {
    const isApiKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token" || item.classified.finding_type === "auth_header";
    const url = item.finding.url + item.finding.path;

    if (isApiKey && item.finding.matchedValue) {
      const existing = keyMap.get(item.finding.matchedValue);
      if (existing) {
        if (!existing.sourceUrls.includes(url)) existing.sourceUrls.push(url);
        continue;
      }
      const entry: DedupedFinding = { finding: item.finding, classified: item.classified, sourceUrls: [url], target_url: url, analysis: '' };
      keyMap.set(item.finding.matchedValue, entry);
      result.push(entry);
    } else {
      result.push({ finding: item.finding, classified: item.classified, sourceUrls: [url], target_url: url, analysis: '' });
    }
  }
  return result;
}

// ====== AI 泄露分析 ======

const AI_ANALYZE_PROMPT = `你是一个 API 安全分析师。分析以下包含 LLM API Key 的源文件内容，完成两个任务：

**任务 1：提取 Key 信息**
从文件上下文中提取：
- provider：属于哪个提供商（openai/anthropic/google/minimax/deepseek/dashscope/openrouter/groq/together/mistral/perplexity/unknown）
- base_url：如果上下文中有该 key 对应的 API 地址。**必须包含完整路径**。如 "https://api.deepseek.com" 应输出 "https://api.deepseek.com/v1/chat/completions"。Anthropic 应输出 https://api.anthropic.com/v1/messages。
- model：如果上下文中有该 key 对应的模型名
- key_value：实际的 API Key 值（仅包含密钥本身，不含空格、引号或其他字符）

**任务 2：生成分析报告**
输出一段简短的中文分析（3-5句话）：文件类型、Key 如何被暴露、风险等级和建议

**输出 JSON**：
{"provider":"deepseek","base_url":"https://api.deepseek.com/v1/chat/completions","model":"deepseek-chat","key_value":"sk-xxx","analysis":"该文件为 shell 历史记录..."}`;

interface AIAnalysisResult { provider?: string; base_url?: string; model?: string; key_value?: string; analysis?: string }

async function analyzeFindings(deduped: DedupedFinding[]): Promise<DedupedFinding[]> {
  const chatSettings = getAllChatSettings().filter((s) => s.enabled === 1);

  for (const item of deduped) {
    const isApiKey = item.classified.finding_type === "api_key" || item.classified.finding_type === "bearer_token";
    if (!isApiKey) continue;

    const content = item.finding.content.slice(0, 2000);
    for (const setting of chatSettings) {
      try {
        const model = createModel(setting);
        const result = await generateText({
          model,
          system: "你是一个 API 安全分析师。只输出 JSON，不要其他内容。不要使用思考标签。",
          prompt: AI_ANALYZE_PROMPT + "\n\n源文件内容：\n" + content,
          temperature: 0.2,
        });
        const text = result.text.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think[\s\S]*$/gi, '').trim();
        const parsed = parseAIAnalysis(text);
        if (parsed.analysis && parsed.analysis.length > 10) {
          if (parsed.provider && parsed.provider !== 'unknown') item.classified.provider = sanitizeKey(parsed.provider);
          if (parsed.base_url) item.classified.base_url = sanitizeKey(parsed.base_url);
          if (parsed.model) item.classified.model = sanitizeKey(parsed.model);
          // 只有当 AI 返回的 key_value 比原始值更长且更像真实 key 时才覆盖
          // 避免 AI 错误地提取上下文中的占位符（如 "minimax-oauth"）覆盖正确的 key
          if (parsed.key_value) {
            const aiKey = sanitizeKey(parsed.key_value);
            const originalKey = item.finding.matchedValue;
            // 只有当 AI key 更长且原始 key 看起来不完整时才覆盖
            if (aiKey.length > originalKey.length && aiKey.length >= 20) {
              item.finding.matchedValue = aiKey;
            }
          }
          item.analysis = parsed.analysis.slice(0, 800);
          break;
        }
      } catch { /* next */ }
    }

    if (!item.analysis) {
      const p = item.finding.path;
      const n = item.sourceUrls.length;
      item.analysis = `- 泄露来源：${p}${n > 1 ? `（${n} 个文件重复发现）` : ''}\n- 上下文：密钥出现在 ${p.split('/').pop() || p}\n- 风险评估：${item.classified.confidence === 'high' ? '高风险' : '中风险'}，建议立即轮换密钥`;
    }
  }
  return deduped;
}

function parseAIAnalysis(text: string): AIAnalysisResult {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*?"analysis"[\s\S]*?\}/);
    if (m) try { return JSON.parse(m[0]); } catch { /* ignore */ }
    return {};
  }
}

// ====== 工具函数 ======

function sanitizeKey(value: string): string {
  let result = value
    .replace(/[\u201C\u201D\u201E\uFF02]/g, '"').replace(/[\u2018\u2019\u201A\uFF07]/g, "'")
    .replace(/^['"]+|['"]+$/g, '').replace(/[^\x00-\xFF]/g, '');
  const wsIdx = result.search(/[\s\n\r\t]/);
  if (wsIdx > 0) result = result.slice(0, wsIdx);
  return result.trim();
}

function createModel(setting: ChatSetting) {
  let baseUrl = setting.base_url?.trim() || undefined;
  if (baseUrl) baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/\/$/, "");
  switch (setting.provider) {
    case "anthropic": { const a = createAnthropic({ apiKey: setting.api_key, baseURL: baseUrl }); return a(setting.model); }
    case "google": { const g = createGoogleGenerativeAI({ apiKey: setting.api_key, baseURL: baseUrl }); return g(setting.model); }
    default: { const o = createOpenAI({ apiKey: setting.api_key, baseURL: baseUrl }); return o.chat(setting.model); }
  }
}
