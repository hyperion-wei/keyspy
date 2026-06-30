"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/components/auth-guard";
import { cn } from "@/lib/utils";
import {
  Crosshair,
  ListChecks,
  FileSearch,
  ArrowLeft,
  Play,
  Pause,
  CheckSquare,
  Square,
  Loader2,
  RotateCcw,
  Copy,
  Check,
  Search,
  Sparkles,
  Plus,
  ExternalLink,
  Clock,
  AlertCircle,
  Pencil,
  FlaskConical,
  Trash2,
  X,
  ChevronDown,
  Zap,
  StopCircle,
} from "lucide-react";

// ===== 类型定义 =====

interface ParsedTarget {
  id: string;
  host: string;
  port: string;
  protocol: "http" | "https";
  url: string;
  scanned: boolean;
  lastScanTime?: string;
}

interface HuntTask {
  id: number;
  status: string;
  total: number;
  completed: number;
  findings_count: number;
  error: string | null;
  progress: string | null;
  created_at: string;
}

interface TargetProgress {
  url: string;
  phase: 'downloading' | 'scanning' | 'classifying' | 'done' | 'error';
  filesDownloaded: number;
  dirsScanned: number;
  rawFindings: number;
  llmFindings: number;
  error?: string;
}

interface HuntFinding {
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

// ===== URL 解析逻辑 =====

function parseTargetsFromText(raw: string): ParsedTarget[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const results: ParsedTarget[] = [];
  const seen = new Set<string>();

  // 模式 1: 已经是完整 URL
  const urlRegex = /^(https?:\/\/[^\s\/]+(?::\d+)?)/i;

  // 模式 2: host:port 或 host:port:protocol
  const hostPortRegex = /^([\d.]+)\s*[:|｜]\s*(\d+)(?:\s*[:|｜]\s*(https?))?$/i;

  // 模式 3: 分行的 IP/端口/协议
  const ipRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
  const portRegex = /^(\d{2,5})$/;
  const protoRegex = /^(https?)$/i;

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 尝试完整 URL
    const urlMatch = line.match(urlRegex);
    if (urlMatch) {
      const url = urlMatch[1];
      try {
        const parsed = new URL(url);
        const protocol = (parsed.protocol.replace(":", "") || "http") as
          | "http"
          | "https";
        const host = parsed.hostname;
        const port = parsed.port || (protocol === "https" ? "443" : "80");
        addResult(results, seen, host, port, protocol);
      } catch {
        /* skip invalid URL */
      }
      i++;
      continue;
    }

    // 尝试 host:port:protocol 单行
    const hpMatch = line.match(hostPortRegex);
    if (hpMatch) {
      const host = hpMatch[1];
      const port = hpMatch[2];
      const protocol = (hpMatch[3]?.toLowerCase() || "http") as
        | "http"
        | "https";
      addResult(results, seen, host, port, protocol);
      i++;
      continue;
    }

    // 尝试分行的 IP
    const ipMatch = line.match(ipRegex);
    if (ipMatch && isValidIP(ipMatch[1])) {
      let host = ipMatch[1];
      let port = "";
      let protocol: "http" | "https" = "http";

      // 向前查找端口和协议
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const portMatch = nextLine.match(portRegex);
        if (portMatch) {
          const portNum = parseInt(portMatch[1], 10);
          if (portNum >= 1 && portNum <= 65535) {
            port = portMatch[1];
            i++;

            // 再向前找协议
            if (i + 1 < lines.length) {
              const protoMatch = lines[i + 1].match(protoRegex);
              if (protoMatch) {
                protocol = protoMatch[1].toLowerCase() as "http" | "https";
                i++;
              }
            }
          }
        }
      }

      if (port) {
        addResult(results, seen, host, port, protocol);
      }
    }

    i++;
  }

  return results;
}

function addResult(
  results: ParsedTarget[],
  seen: Set<string>,
  host: string,
  port: string,
  protocol: "http" | "https",
) {
  const url = `${protocol}://${host}:${port}`;
  if (!seen.has(url)) {
    seen.add(url);
    results.push({
      id: `t-${results.length}-${Date.now()}`,
      host,
      port,
      protocol,
      url,
      scanned: false,
    });
  }
}

function isValidIP(ip: string): boolean {
  return ip.split(".").every((p) => {
    const n = parseInt(p, 10);
    return n >= 0 && n <= 255 && String(n) === p;
  });
}

// ===== 主页面 =====

export default function HuntPage() {
  return (
    <AuthGuard>
      <HuntContent />
    </AuthGuard>
  );
}

function HuntContent() {
  const [activeTab, setActiveTab] = useState<"targets" | "tasks" | "results">(
    "targets",
  );

  const tabs = [
    {
      id: "targets" as const,
      label: "目标获取",
      icon: Crosshair,
    },
    {
      id: "tasks" as const,
      label: "任务进度",
      icon: ListChecks,
    },
    {
      id: "results" as const,
      label: "扫描结果",
      icon: FileSearch,
    },
  ];

  return (
    <div className="py-8 md:py-16">
      {/* Top bar */}
      <div className="mx-auto mb-6 flex w-full max-w-[1600px] items-center justify-between gap-3 px-3 sm:px-6 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          首页
        </Link>
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">KeySpy - Key 泄露扫描</span>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 sm:gap-8 sm:px-6 lg:px-12">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border/40 bg-muted/50 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "targets" && <TargetAcquisitionTab onScanStarted={() => setActiveTab("tasks")} />}
        {activeTab === "tasks" && <TaskProgressTab onViewResults={() => setActiveTab("results")} />}
        {activeTab === "results" && <ScanResultsTab />}
      </main>
    </div>
  );
}

// ===== 目标获取 Tab =====

function TargetAcquisitionTab({ onScanStarted }: { onScanStarted: () => void }) {
  const [rawInput, setRawInput] = useState("");
  const [targets, setTargets] = useState<ParsedTarget[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);

  async function handleAIParse() {
    if (!rawInput.trim()) return;
    setAiParsing(true);
    try {
      const res = await fetch("/api/hunt/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawInput }),
      });
      const data = await res.json();
      if (data.success && data.targets) {
        setTargets(data.targets);
        setSelectedIds(new Set());
        // 可选：显示使用了哪个模型
        if (data.usedModel) {
          console.log(`[AI 解析] 使用模型: ${data.usedModel}`);
        }
      } else {
        const msg = data.details
          ? `${data.error}\n\n${data.details.join("\n")}`
          : data.error || "AI 解析失败";
        alert(msg);
      }
    } catch (err) {
      alert(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiParsing(false);
    }
  }

  function handleParse() {
    if (!rawInput.trim()) return;
    const parsed = parseTargetsFromText(rawInput);
    setTargets(parsed);
    setSelectedIds(new Set());
  }

  function handleClear() {
    setRawInput("");
    setTargets([]);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === targets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(targets.map((t) => t.id)));
    }
  }

  function handleCopyUrl(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleStartScan() {
    if (selectedIds.size === 0) return;
    setScanning(true);

    const selectedTargets = targets.filter((t) => selectedIds.has(t.id));

    try {
      const res = await fetch("/api/hunt/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: selectedTargets }),
      });
      const data = await res.json();
      if (data.success && data.taskId) {
        // 切换到任务进度 Tab
        onScanStarted();
      } else {
        alert(data.error || "启动扫描失败");
      }
    } catch (err) {
      alert(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
    }
  }

  const selectedCount = selectedIds.size;
  const allSelected =
    targets.length > 0 && selectedIds.size === targets.length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* 左侧：输入区域 */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">输入目标数据</h3>
            <span className="text-xs text-muted-foreground">
              支持 IP、端口、URL 等多种格式，也可用 AI 智能解析混乱文本
            </span>
          </div>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={`粘贴目标数据，例如：\n\n124.223.83.97\n9119\nhttp\n\n118.196.99.97\n8080\nhttp\n\n或一行一个 URL：\nhttp://example.com:8080\nhttps://api.test.com:443\n\n也支持 host:port 格式：\n192.168.1.1:8080`}
            className="h-64 w-full resize-none rounded-lg border border-border/60 bg-background/50 p-3 font-mono text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleAIParse}
              disabled={!rawInput.trim() || aiParsing}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {aiParsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {aiParsing ? "AI 解析中..." : "AI 智能解析"}
            </button>
            <button
              type="button"
              onClick={handleParse}
              disabled={!rawInput.trim() || aiParsing}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border border-border/60 px-4 py-2.5 text-sm font-medium transition-colors",
                "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Search className="h-4 w-4" />
              正则解析
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={!rawInput && targets.length === 0}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border border-border/60 px-4 py-2.5 text-sm transition-colors",
                "hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <RotateCcw className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        {/* 提示信息 */}
        <div className="rounded-xl border border-border/40 bg-card p-4">
          <h4 className="mb-2 text-xs font-semibold text-muted-foreground">
            支持的输入格式
          </h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">分行格式：</span>{" "}
              IP / 端口 / 协议（每行一项）
            </li>
            <li>
              <span className="font-medium text-foreground">完整 URL：</span>{" "}
              http://host:port
            </li>
            <li>
              <span className="font-medium text-foreground">冒号分隔：</span>{" "}
              host:port 或 host:port:protocol
            </li>
            <li>
              <span className="font-medium text-foreground">混合输入：</span>{" "}
              自动识别并提取有效目标
            </li>
          </ul>
        </div>
      </div>

      {/* 右侧：解析结果 */}
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border/40 bg-card p-4">
          {/* 标题栏 */}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              解析结果{" "}
              {targets.length > 0 && (
                <span className="ml-1 text-muted-foreground">
                  ({targets.length} 个目标)
                </span>
              )}
            </h3>
            {targets.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {allSelected ? (
                    <CheckSquare className="h-3.5 w-3.5" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                  {allSelected ? "取消全选" : "全选"}
                </button>
              </div>
            )}
          </div>

          {/* 列表 */}
          {targets.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-center text-sm text-muted-foreground">
              <div>
                <Crosshair className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p>暂无解析结果</p>
                <p className="mt-1 text-xs">在左侧输入目标数据后点击"解析"</p>
              </div>
            </div>
          ) : (
            <div className="max-h-[400px] space-y-1 overflow-y-auto">
              {targets.map((target) => (
                <div
                  key={target.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                    selectedIds.has(target.id)
                      ? "border-primary/50 bg-primary/5"
                      : "border-border/30 hover:border-border/60",
                  )}
                >
                  {/* 选择框 */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(target.id)}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {selectedIds.has(target.id) ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>

                  {/* 扫描状态 */}
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      target.scanned ? "bg-green-500" : "bg-muted-foreground/40",
                    )}
                    title={target.scanned ? "已扫描" : "未扫描"}
                  />

                  {/* URL 信息 */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">
                      {target.url}
                    </div>
                  </div>

                  {/* 复制按钮 */}
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(target.url, target.id)}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    title="复制 URL"
                  >
                    {copiedId === target.id ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 操作栏 */}
        {targets.length > 0 && (
          <div className="rounded-xl border border-border/40 bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                已选择{" "}
                <span className="font-semibold text-foreground">
                  {selectedCount}
                </span>{" "}
                / {targets.length} 个目标
              </span>
              <button
                type="button"
                onClick={handleStartScan}
                disabled={selectedCount === 0 || scanning}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {scanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {scanning ? "扫描中..." : "发起扫描"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 任务进度 Tab =====

function getPhaseLabel(phase: string): string {
  switch (phase) {
    case 'downloading': return '下载中';
    case 'scanning': return '扫描中';
    case 'classifying': return '分析中';
    case 'done': return '完成';
    case 'error': return '错误';
    default: return phase;
  }
}

function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'downloading': return 'text-blue-500';
    case 'scanning': return 'text-yellow-500';
    case 'classifying': return 'text-purple-500';
    case 'done': return 'text-green-500';
    case 'error': return 'text-red-500';
    default: return 'text-muted-foreground';
  }
}

function getPhaseBg(phase: string): string {
  switch (phase) {
    case 'downloading': return 'bg-blue-500/10';
    case 'scanning': return 'bg-yellow-500/10';
    case 'classifying': return 'bg-purple-500/10';
    case 'done': return 'bg-green-500/10';
    case 'error': return 'bg-red-500/10';
    default: return 'bg-muted';
  }
}

function TaskProgressTab({ onViewResults }: { onViewResults: () => void }) {
  const [tasks, setTasks] = useState<HuntTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [abortingId, setAbortingId] = useState<number | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/hunt/tasks");
      if (res.ok) {
        setTasks(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2000); // 2秒自动刷新
    return () => clearInterval(interval);
  }, [fetchTasks]);

  async function handleAbortTask(taskId: number) {
    setAbortingId(taskId);
    try {
      const res = await fetch("/api/hunt/scan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, action: "abort" }),
      });
      const data = await res.json();
      if (data.success) {
        fetchTasks();
      }
    } catch (err) {
      alert(`中断失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAbortingId(null);
    }
  }

  async function handleDeleteTask(taskId: number) {
    if (!confirm(`确定删除任务 #${taskId} 及其所有发现？`)) return;
    setDeletingId(taskId);
    try {
      const res = await fetch(`/api/hunt/tasks?id=${taskId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchTasks();
      }
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteAllTasks() {
    const deletableTasks = tasks.filter(t => t.status !== "running");
    if (deletableTasks.length === 0) {
      alert("没有可删除的任务");
      return;
    }
    if (!confirm(`确定删除 ${deletableTasks.length} 个任务及其所有发现？此操作不可恢复。`)) return;

    setDeletingAll(true);
    let deleted = 0;
    for (const task of deletableTasks) {
      try {
        const res = await fetch(`/api/hunt/tasks?id=${task.id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) deleted++;
      } catch { /* ignore */ }
    }
    setDeletingAll(false);
    alert(`已删除 ${deleted}/${deletableTasks.length} 个任务`);
    fetchTasks();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border/40 bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border/40 bg-card">
        <ListChecks className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">暂无扫描任务</p>
        <p className="mt-1 text-xs text-muted-foreground">
          在目标获取 Tab 发起扫描后，任务进度会显示在这里
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 <span className="font-semibold text-foreground">{tasks.length}</span> 个扫描任务
        </p>
        <button
          onClick={handleDeleteAllTasks}
          disabled={deletingAll || tasks.filter(t => t.status !== "running").length === 0}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {deletingAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {deletingAll ? "删除中..." : "一键删除全部"}
        </button>
      </div>

      {tasks.map((task) => {
        const progress = task.total > 0 ? Math.round((task.completed / task.total) * 100) : 0;
        const isRunning = task.status === "running";
        const isCompleted = task.status === "completed";
        const isFailed = task.status === "failed";

        // 解析详细进度
        let targetProgressList: TargetProgress[] = [];
        try {
          const progressObj = task.progress ? JSON.parse(task.progress) : {};
          targetProgressList = Object.values(progressObj);
        } catch { /* ignore */ }

        // 统计各阶段数量
        const phaseStats = {
          downloading: targetProgressList.filter(p => p.phase === 'downloading').length,
          scanning: targetProgressList.filter(p => p.phase === 'scanning').length,
          classifying: targetProgressList.filter(p => p.phase === 'classifying').length,
          done: targetProgressList.filter(p => p.phase === 'done').length,
          error: targetProgressList.filter(p => p.phase === 'error').length,
        };

        return (
          <div
            key={task.id}
            className="rounded-xl border border-border/40 bg-card p-4"
          >
            {/* 任务头部 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold",
                    isRunning && "bg-blue-500/10 text-blue-600",
                    isCompleted && "bg-green-500/10 text-green-600",
                    isFailed && "bg-red-500/10 text-red-600"
                  )}
                >
                  {isRunning && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isCompleted && <Check className="h-4 w-4" />}
                  {isFailed && <AlertCircle className="h-4 w-4" />}
                </span>
                <div>
                  <p className="text-sm font-medium">
                    任务 #{task.id}
                    {isRunning && <span className="ml-2 text-xs text-blue-500 animate-pulse">并发扫描中...</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(task.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">
                  <span className="text-primary">{task.findings_count}</span> 个发现
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.completed}/{task.total} 完成
                </p>
              </div>
            </div>

            {/* 阶段统计条 */}
            {isRunning && targetProgressList.length > 0 && (
              <div className="mb-3 flex gap-1.5 flex-wrap">
                {phaseStats.downloading > 0 && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", getPhaseBg('downloading'), getPhaseColor('downloading'))}>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    下载 {phaseStats.downloading}
                  </span>
                )}
                {phaseStats.scanning > 0 && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", getPhaseBg('scanning'), getPhaseColor('scanning'))}>
                    <Search className="h-3 w-3" />
                    扫描 {phaseStats.scanning}
                  </span>
                )}
                {phaseStats.classifying > 0 && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", getPhaseBg('classifying'), getPhaseColor('classifying'))}>
                    <Sparkles className="h-3 w-3" />
                    分析 {phaseStats.classifying}
                  </span>
                )}
                {phaseStats.done > 0 && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", getPhaseBg('done'), getPhaseColor('done'))}>
                    <Check className="h-3 w-3" />
                    完成 {phaseStats.done}
                  </span>
                )}
                {phaseStats.error > 0 && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", getPhaseBg('error'), getPhaseColor('error'))}>
                    <AlertCircle className="h-3 w-3" />
                    错误 {phaseStats.error}
                  </span>
                )}
              </div>
            )}

            {/* 总进度条 */}
            <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-2">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  isFailed ? "bg-red-500" : isCompleted ? "bg-green-500" : "bg-gradient-to-r from-blue-500 to-indigo-500"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* 进度百分比 + 操作按钮 */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {isRunning && `${progress}%`}
                {isCompleted && "扫描完成"}
                {isFailed && `失败: ${task.error?.slice(0, 60)}...`}
              </span>
              <div className="flex items-center gap-2">
                {/* 运行中：显示中断按钮 */}
                {isRunning && (
                  <button
                    onClick={() => handleAbortTask(task.id)}
                    disabled={abortingId === task.id}
                    className={cn(
                      "flex items-center gap-1 rounded-md border border-orange-500/30 px-2 py-1 text-orange-500 transition-colors hover:bg-orange-500/10",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    title="中断任务"
                  >
                    {abortingId === task.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <StopCircle className="h-3 w-3" />
                    )}
                    中断
                  </button>
                )}
                {isCompleted && task.findings_count > 0 && (
                  <button
                    onClick={onViewResults}
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    查看结果
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
                {/* 删除按钮：所有状态都可以删除 */}
                <button
                  onClick={() => handleDeleteTask(task.id)}
                  disabled={deletingId === task.id}
                  className="flex items-center gap-1 text-red-500/70 hover:text-red-500 disabled:opacity-50"
                  title="删除任务"
                >
                  {deletingId === task.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            {/* 详细目标进度列表（运行中时展开） */}
            {isRunning && targetProgressList.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-3 space-y-1.5 max-h-48 overflow-y-auto">
                {targetProgressList.map((tp, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", 
                      tp.phase === 'done' ? 'bg-green-500' :
                      tp.phase === 'error' ? 'bg-red-500' :
                      'bg-blue-500 animate-pulse'
                    )} />
                    <span className="truncate font-mono text-[11px] flex-1">
                      {tp.url}
                    </span>
                    <span className={cn("shrink-0", getPhaseColor(tp.phase))}>
                      {getPhaseLabel(tp.phase)}
                    </span>
                    {tp.phase === 'downloading' && tp.filesDownloaded > 0 && (
                      <span className="shrink-0 text-muted-foreground">{tp.filesDownloaded} 文件</span>
                    )}
                    {tp.phase === 'scanning' && tp.rawFindings > 0 && (
                      <span className="shrink-0 text-muted-foreground">{tp.rawFindings} 原始</span>
                    )}
                    {tp.phase === 'done' && tp.llmFindings > 0 && (
                      <span className="shrink-0 text-green-600 dark:text-green-400">{tp.llmFindings} 发现</span>
                    )}
                    {tp.phase === 'error' && tp.error && (
                      <span className="shrink-0 text-red-500 truncate max-w-24" title={tp.error}>
                        {tp.error.slice(0, 20)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== 扫描结果 Tab =====

/**
 * 已知 LLM 提供商的域名 → 正确的 chat completions 路径映射
 */
const KNOWN_PROVIDER_DOMAINS: Record<string, string> = {
  "api.openai.com": "/v1/chat/completions",
  "api.anthropic.com": "/v1/messages",
  "api.minimaxi.com": "/v1/chat/completions",
  "api.minimax.chat": "/v1/chat/completions",
  "api.deepseek.com": "/v1/chat/completions",
  "dashscope.aliyuncs.com": "/compatible-mode/v1/chat/completions",
  "openrouter.ai": "/api/v1/chat/completions",
  "api.together.xyz": "/v1/chat/completions",
  "api.groq.com": "/openai/v1/chat/completions",
  "api.mistral.ai": "/v1/chat/completions",
  "api.perplexity.ai": "/chat/completions",
};

/**
 * 标准化 base_url：确保包含完整的 chat completions 路径
 */
function normalizeBaseUrl(baseUrl: string | null | undefined): string {
  if (!baseUrl) return "";
  const trimmed = baseUrl.replace(/\/+$/, '');
  
  if (trimmed.endsWith('/v1/chat/completions') || 
      trimmed.endsWith('/chat/completions') ||
      trimmed.endsWith('/messages')) {
    return trimmed;
  }

  try {
    const u = new URL(trimmed);
    const knownPath = KNOWN_PROVIDER_DOMAINS[u.hostname];
    if (knownPath && !knownPath.includes('{model}')) {
      return u.origin + knownPath;
    }
  } catch { /* ignore */ }

  if (trimmed.endsWith('/v1')) {
    return trimmed + '/chat/completions';
  }

  return trimmed + '/v1/chat/completions';
}

interface EditForm {
  provider: string;
  base_url: string;
  model: string;
  key_value: string;
}

interface WorkedTemplate {
  template: string;
  templateId: number;
  type: string;
  base_url: string;
  model: string;
}

interface TestResult {
  success: boolean;
  latency_ms: number;
  message: string;
  response_preview?: string;
  worked?: WorkedTemplate[];
}

function ScanResultsTab() {
  const [findings, setFindings] = useState<HuntFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ provider: "", base_url: "", model: "", key_value: "" });
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [expandedAnalyses, setExpandedAnalyses] = useState<Set<number>>(new Set());
  const [deletingSource, setDeletingSource] = useState<number | null>(null);
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ tested: number; total: number } | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const fetchFindings = useCallback(async () => {
    try {
      const res = await fetch("/api/hunt/results");
      if (res.ok) {
        const data = await res.json();
        setFindings(data.findings || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  function openEdit(finding: HuntFinding) {
    setEditingId(finding.id);
    setEditForm({
      provider: finding.provider || "",
      base_url: finding.base_url || "",
      model: finding.model || "",
      key_value: finding.key_value || "",
    });
  }

  async function saveEdit() {
    if (editingId === null) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/hunt/results", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...editForm }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        fetchFindings();
      } else {
        alert(data.error || "保存失败");
      }
    } catch (err) {
      alert(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEdit(false);
    }
  }

  /**
   * 核心测试函数（可复用）
   * - 信息完整：先用现有信息测试，失败再遍历模板
   * - 信息不全：直接遍历模板
   * - 模板测试通过：自动更新 finding 的 provider/base_url/model
   */
  async function testFinding(f: HuntFinding): Promise<TestResult> {
    const apiKey = f.key_value;
    if (!apiKey) return { success: false, latency_ms: 0, message: "无 API Key" };

    // 信息完整 → 先用现有信息测试
    if (f.base_url && f.model) {
      try {
        const res = await fetch("/api/hunt/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            base_url: f.base_url,
            model: f.model,
            provider: f.provider,
          }),
        });
        const data = await res.json();
        if (data.success) {
          return { success: true, latency_ms: data.latency_ms || 0, message: "Key 可用", response_preview: data.response_preview };
        }
        // 现有信息失败 → fallback 遍历模板
      } catch (err) {
        // 网络错误也 fallback 遍历模板
      }
    }

    // 信息不全 或 现有信息失败 → 遍历模板
    try {
      const res = await fetch("/api/hunt/test-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const data = await res.json();
      const workedList: WorkedTemplate[] = data.worked || [];
      const workedNames = workedList.map((w: { template: string }) => w.template).join(", ") || "";

      // 模板测试通过 → 自动更新 finding
      if (data.usable && workedList.length > 0) {
        const best = workedList[0];
        try {
          await fetch("/api/hunt/results", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: f.id,
              provider: best.type,
              base_url: best.base_url,
              model: best.model,
            }),
          });
        } catch { /* ignore */ }
      }

      return {
        success: !!data.usable,
        latency_ms: 0,
        message: data.usable
          ? `可用: ${workedNames}`
          : `不可用 (测试了 ${data.results?.length || 0} 个模板均失败)`,
        worked: workedList,
      };
    } catch (err) {
      return { success: false, latency_ms: 0, message: `请求失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 单个测试：设置 UI 状态 + 调用核心函数 */
  async function handleTest(finding: HuntFinding) {
    if (!finding.key_value) { alert("该发现没有 API Key"); return; }
    setTestingIds(prev => new Set(prev).add(finding.id));
    setTestResults(prev => ({ ...prev, [finding.id]: undefined as unknown as TestResult }));
    const result = await testFinding(finding);
    setTestResults(prev => ({ ...prev, [finding.id]: result }));
    setTestingIds(prev => { const next = new Set(prev); next.delete(finding.id); return next; });
    if (result.success) fetchFindings();
  }

  async function handleDelete(findingId: number) {
    if (!confirm("确定删除该条发现？")) return;
    try {
      const res = await fetch(`/api/hunt/results?id=${findingId}&action=delete`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchFindings();
      }
    } catch (err) {
      alert(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleRemoveMonitor(findingId: number) {
    if (!confirm("确定从监控中移除？")) return;
    setAddingId(findingId);
    try {
      const res = await fetch(`/api/hunt/results?id=${findingId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchFindings();
      }
    } catch (err) {
      alert(`移除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddingId(null);
    }
  }

  async function handleDeleteSource(finding: HuntFinding) {
    let urls: string[] = [];
    try { urls = JSON.parse(finding.source_urls || '[]'); } catch { /* ignore */ }
    if (urls.length === 0) urls = [finding.target_url];

    if (!confirm(`确定要从服务器删除 ${urls.length} 个源文件吗？此操作不可恢复。`)) return;
    setDeletingSource(finding.id);
    try {
      const res = await fetch("/api/hunt/delete-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, finding_id: finding.id }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`源文件已删除（${data.deleted} 成功/${data.failed} 失败），扫描结果已清除`);
        fetchFindings();
      } else {
        alert(data.error || "删除失败");
      }
    } catch (err) {
      alert(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingSource(null);
    }
  }

  async function handleAddToMonitor(finding: HuntFinding, force = false, workedIdx?: number) {
    if (!finding.key_value) {
      alert("无有效的 API Key");
      return;
    }

    // 从测试结果中获取可用的模板
    const testResult = testResults[finding.id];
    const worked = testResult?.worked || [];

    // 如果有可用模板但还没选，让用户选择
    if (worked.length > 1 && workedIdx === undefined) {
      const choices = worked.map((w, i) => `${i + 1}. ${w.template} (${w.model})`).join("\n");
      const input = prompt(`该 Key 在以下模板可用，请选择一个：\n\n${choices}\n\n输入数字选择（回车用第一个）：`);
      if (input === null) return; // 取消
      const idx = parseInt(input, 10) - 1;
      if (idx >= 0 && idx < worked.length) {
        handleAddToMonitor(finding, force, idx);
        return;
      }
      // 默认第一个
    }

    const selectedWorked = workedIdx !== undefined ? worked[workedIdx] : worked[0];

    setAddingId(finding.id);
    try {
      const res = await fetch("/api/hunt/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId: finding.id,
          name: `Hunt: ${selectedWorked?.template || finding.provider || "unknown"} - ${finding.target_url}`,
          type: selectedWorked?.type || finding.provider || "openai",
          base_url: selectedWorked?.base_url || normalizeBaseUrl(finding.base_url || finding.target_url),
          api_key: finding.key_value,
          model: selectedWorked?.model || finding.model || "gpt-3.5-turbo",
          provider: finding.provider,
          group_name: "Hunt 发现",
          force,
        }),
      });
      const data = await res.json();

      // 去重提示：该 key 已存在于监控中
      if (data.duplicate) {
        const names = data.existingConfigs.map((c: { name: string }) => c.name).join("、");
        if (confirm(`该 Key 已存在于监控配置「${names}」中，是否仍然要重复添加？`)) {
          handleAddToMonitor(finding, true, workedIdx);
          return;
        }
        return;
      }

      if (data.success) {
        fetchFindings();
        // 显示模板匹配信息
        if (data.templateUsed) {
          alert(`✅ ${data.message}\n\n模板: ${data.templateUsed.name}\nBase URL: ${data.templateUsed.base_url}\n默认模型: ${data.templateUsed.model}`);
        }
      } else {
        alert(data.error || "添加失败");
      }
    } catch (err) {
      alert(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddingId(null);
    }
  }

  /**
   * 一键测试全部：并发调用 testFinding
   */
  async function handleBatchTestAll() {
    const testable = findings.filter(f => f.key_value);
    if (testable.length === 0) { alert("没有可测试的 Key"); return; }
    if (!confirm(`将并发测试 ${testable.length} 个 Key，是否继续？`)) return;

    setBatchTesting(true);
    setBatchProgress({ tested: 0, total: testable.length });

    let testedCount = 0;
    await Promise.all(testable.map(async (f) => {
      setTestingIds(prev => new Set(prev).add(f.id));
      const result = await testFinding(f);
      setTestResults(prev => ({ ...prev, [f.id]: result }));
      setTestingIds(prev => { const next = new Set(prev); next.delete(f.id); return next; });
      testedCount++;
      setBatchProgress({ tested: testedCount, total: testable.length });
    }));

    setBatchTesting(false);
    setBatchProgress(null);
    fetchFindings();
  }

  /**
   * 一键删除不可用：没有测试结果的先跑测试，然后删除失败的
   */
  async function handleDeleteUnavailable() {
    const testable = findings.filter(f => f.key_value);
    const notTested = testable.filter(f => !testResults[f.id]);

    if (notTested.length > 0) {
      if (!confirm(`有 ${notTested.length} 个 Key 未测试，是否先测试？(共 ${testable.length} 个)`)) return;
    }

    // 本地记录新测试结果（避免 React 状态延迟）
    const newResults = new Map<number, boolean>();

    if (notTested.length > 0) {
      setBatchTesting(true);
      setBatchProgress({ tested: 0, total: notTested.length });

      let testedCount = 0;
      await Promise.all(notTested.map(async (f) => {
        setTestingIds(prev => new Set(prev).add(f.id));
        const result = await testFinding(f);
        newResults.set(f.id, result.success);
        setTestResults(prev => ({ ...prev, [f.id]: result }));
        setTestingIds(prev => { const next = new Set(prev); next.delete(f.id); return next; });
        testedCount++;
        setBatchProgress({ tested: testedCount, total: notTested.length });
      }));

      setBatchTesting(false);
      setBatchProgress(null);
      fetchFindings();
    }

    // 找出所有失败的（旧 state + 新本地 Map）
    const failedIds: number[] = [];
    for (const f of testable) {
      const newRes = newResults.get(f.id);
      if (newRes !== undefined) {
        if (!newRes) failedIds.push(f.id);
      } else {
        const result = testResults[f.id];
        if (!result?.success) failedIds.push(f.id);
      }
    }

    if (failedIds.length === 0) {
      alert("所有 Key 至少在一个模板上可用，无需删除");
      return;
    }

    if (!confirm(`发现 ${failedIds.length} 个 Key 不可用，是否删除？`)) return;

    setBatchDeleting(true);
    let deleted = 0;
    await Promise.all(failedIds.map(async (id) => {
      try {
        const res = await fetch(`/api/hunt/results?id=${id}&action=delete`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) deleted++;
      } catch { /* ignore */ }
    }));
    setBatchDeleting(false);
    alert(`已删除 ${deleted}/${failedIds.length} 个不可用 Key`);
    fetchFindings();
  }

  function getConfidenceColor(confidence: string) {
    switch (confidence) {
      case "high":
        return "bg-red-500/10 text-red-600 dark:text-red-400";
      case "medium":
        return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border/40 bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-border/40 bg-card">
        <FileSearch className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium">暂无扫描结果</p>
        <p className="mt-1 text-xs text-muted-foreground">
          扫描完成后，发现的 LLM Key 泄露会显示在这里
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          共发现 <span className="font-semibold text-foreground">{findings.length}</span> 个潜在泄露
          {batchProgress && (
            <span className="ml-2 text-xs text-blue-600">
              (测试中: {batchProgress.tested}/{batchProgress.total})
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* 一键测试全部 */}
          <button
            onClick={handleBatchTestAll}
            disabled={batchTesting || findings.length === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {batchTesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" />
            )}
            {batchTesting ? "测试中..." : "一键测试全部"}
          </button>
          {/* 一键删除不可用 */}
          <button
            onClick={handleDeleteUnavailable}
            disabled={batchTesting || batchDeleting || findings.length === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {batchDeleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {batchDeleting ? "删除中..." : "一键删除不可用"}
          </button>
        </div>
      </div>

      {findings.map((finding) => {
        const testResult = testResults[finding.id];
        const isTesting = testingIds.has(finding.id);
        const hasKey = !!finding.key_value;

        return (
          <div
            key={finding.id}
            className="rounded-xl border border-border/40 bg-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      getConfidenceColor(finding.confidence)
                    )}
                  >
                    {finding.confidence} 置信度
                  </span>
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {finding.finding_type}
                  </span>
                  {finding.provider && finding.provider !== "unknown" && (
                    <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                      {finding.provider}
                    </span>
                  )}
                  {finding.added_to_monitor ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      已加入监控
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1 text-sm">
                  {/* 来源 URL */}
                  {(() => {
                    let urls: string[] = [];
                    try { urls = JSON.parse(finding.source_urls || '[]'); } catch { /* ignore */ }
                    if (urls.length === 0) urls = [finding.target_url];
                    return (
                      <div className="flex items-start gap-2">
                        <span className="w-16 shrink-0 text-xs text-muted-foreground">
                          {urls.length > 1 ? `${urls.length}处来源:` : 'URL:'}
                        </span>
                        <div className="flex flex-col gap-0.5">
                          {urls.map((u, i) => (
                            <span key={i} className="truncate font-mono text-xs">{u}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {finding.key_value && (
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">Key:</span>
                      <span className="truncate font-mono text-xs">
                        {finding.key_value.slice(0, 20)}••••••
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">模型:</span>
                    <span className={cn("text-xs", !finding.model && "text-muted-foreground/50 italic")}>
                      {finding.model || "未设置"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">Base:</span>
                    <span className={cn("truncate font-mono text-xs", !finding.base_url && "text-muted-foreground/50 italic")}>
                      {finding.base_url || "未设置"}
                    </span>
                  </div>
                </div>

                {/* AI 分析 - 可折叠 */}
                {finding.analysis && (
                  <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5">
                    <button
                      onClick={() => {
                        setExpandedAnalyses(prev => {
                          const next = new Set(prev);
                          if (next.has(finding.id)) next.delete(finding.id);
                          else next.add(finding.id);
                          return next;
                        });
                      }}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-violet-700 dark:text-violet-400 transition-colors hover:bg-violet-500/10 rounded-lg"
                    >
                      <Sparkles className="h-3 w-3" />
                      AI 泄露分析
                      <ChevronDown className={cn(
                        "ml-auto h-3.5 w-3.5 transition-transform",
                        expandedAnalyses.has(finding.id) && "rotate-180"
                      )} />
                    </button>
                    {expandedAnalyses.has(finding.id) && (
                      <div className="border-t border-violet-500/20 px-3 py-2">
                        <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-muted-foreground">
                          {finding.analysis}
                        </pre>
                        {/* 删除源文件按钮 */}
                        <button
                          onClick={() => handleDeleteSource(finding)}
                          disabled={deletingSource === finding.id}
                          className={cn(
                            "mt-2 flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10",
                            "disabled:cursor-not-allowed disabled:opacity-50"
                          )}
                        >
                          {deletingSource === finding.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          删除源文件
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 测试结果 */}
                {testResult && (
                  <div className={cn(
                    "mt-2 rounded-lg border px-3 py-2 text-xs",
                    testResult.success
                      ? "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400"
                      : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
                  )}>
                    <div className="flex items-center gap-2">
                      {testResult.success ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                      <span className="font-medium">{testResult.message}</span>
                      <span className="text-muted-foreground">({testResult.latency_ms}ms)</span>
                    </div>
                    {testResult.response_preview && (
                      <p className="mt-1 truncate font-mono text-[11px] opacity-70">{testResult.response_preview.slice(0, 100)}</p>
                    )}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex shrink-0 flex-col gap-1.5">
                <div className="flex gap-1.5">
                  {/* 编辑 */}
                  <button
                    onClick={() => openEdit(finding)}
                    className="flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                    title="编辑"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  {/* 测试 */}
                  <button
                    onClick={() => handleTest(finding)}
                    disabled={isTesting || !hasKey}
                    className={cn(
                      "flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      "border border-border/60 hover:bg-muted",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    title={!hasKey ? "无 API Key" : !finding.base_url || !finding.model ? "遍历模板测试" : "测试 Key 可用性"}
                  >
                    {isTesting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FlaskConical className="h-3.5 w-3.5" />
                    )}
                    {isTesting ? "测试中" : "测试"}
                  </button>
                </div>
                <div className="flex gap-1.5">
                  {finding.added_to_monitor ? (
                    <button
                      onClick={() => handleRemoveMonitor(finding.id)}
                      disabled={addingId === finding.id}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        "bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                      title="点击移除监控"
                    >
                      {addingId === finding.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      已监控
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAddToMonitor(finding)}
                      disabled={addingId === finding.id || !finding.key_value}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                        "bg-primary text-primary-foreground hover:bg-primary/90",
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                    >
                      {addingId === finding.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      加入监控
                    </button>
                  )}
                  {/* 删除 */}
                  <button
                    onClick={() => handleDelete(finding.id)}
                    className="flex items-center justify-center rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* 编辑弹窗 */}
      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingId(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">编辑扫描发现 #{editingId}</h3>
              <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Provider</label>
                <input
                  value={editForm.provider}
                  onChange={e => setEditForm(f => ({ ...f, provider: e.target.value }))}
                  placeholder="e.g. openai, deepseek, minimax"
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Base URL</label>
                <input
                  value={editForm.base_url}
                  onChange={e => setEditForm(f => ({ ...f, base_url: e.target.value }))}
                  placeholder="https://api.example.com/v1/chat/completions"
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Model</label>
                <input
                  value={editForm.model}
                  onChange={e => setEditForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="e.g. gpt-4o-mini, deepseek-chat"
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">API Key</label>
                <input
                  value={editForm.key_value}
                  onChange={e => setEditForm(f => ({ ...f, key_value: e.target.value }))}
                  placeholder="sk-..."
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEditingId(null)}
                className="rounded-lg border border-border/60 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {savingEdit && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
