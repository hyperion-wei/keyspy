"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  Settings,
  Activity,
  LogOut,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Clock,
  Check,
  Layers,
  ChevronDown,
  ChevronRight,
  X,
  Hash,
  Copy,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Wrench,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";
import { ChatPanel } from "@/components/chat-panel";

interface MonitorConfig {
  id: number;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  model: string;
  group_name: string;
  enabled: number;
  template_id?: number | null;
  fallback_models?: string;
  active_model?: string;
  created_at: string;
  updated_at: string;
}

interface MonitorTemplate {
  id: number;
  name: string;
  type: string;
  base_url: string;
  models: string[];
  default_model: string;
  description: string;
  built_in: number;
}

type FormData = {
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  model: string;
  group_name: string;
  enabled: boolean;
};

const EMPTY_FORM: FormData = {
  name: "",
  type: "openai",
  base_url: "",
  api_key: "",
  model: "",
  group_name: "",
  enabled: true,
};

const TYPE_OPTIONS = [
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
];

const POLL_PRESETS = [
  { label: "30秒", value: 30 },
  { label: "1分钟", value: 60 },
  { label: "5分钟", value: 300 },
  { label: "15分钟", value: 900 },
  { label: "30分钟", value: 1800 },
  { label: "1小时", value: 3600 },
  { label: "2小时", value: 7200 },
  { label: "6小时", value: 21600 },
  { label: "12小时", value: 43200 },
];

const PRESET_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com",
  anthropic: "https://api.anthropic.com/v1/messages",
};

export default function ManagePage() {
  return (
    <AuthGuard>
      <ManageContent />
    </AuthGuard>
  );
}

function ManageContent() {
  const [configs, setConfigs] = useState<MonitorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [username, setUsername] = useState<string>("");
  const [pollInterval, setPollInterval] = useState<number>(300);
  const [pollSaving, setPollSaving] = useState(false);
  const [pollSaved, setPollSaved] = useState(false);

  // 模板系统相关
  const [templates, setTemplates] = useState<MonitorTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [apiKeysText, setApiKeysText] = useState<string>("");
  const [customModelMode, setCustomModelMode] = useState<boolean>(false);

  // 分组展开状态（默认全部展开）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupsInitialized, setGroupsInitialized] = useState(false);
  // 复制反馈
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);
  // 批量选择
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  // Dashboard 数据（可用性状态）
  const [dashboardData, setDashboardData] = useState<any>(null);
  // AI 聊天面板
  const [showChat, setShowChat] = useState(false);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/monitors");
      if (res.ok) {
        setConfigs(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        setTemplates(await res.json());
      }
    } catch {
      /* ignore */
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        setDashboardData(await res.json());
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
    fetchTemplates();
    fetchDashboard();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => d.user && setUsername(d.user.username))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => d.pollIntervalSeconds && setPollInterval(d.pollIntervalSeconds))
      .catch(() => {});
  }, [fetchConfigs, fetchTemplates, fetchDashboard]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSelectedTemplateId("");
    setIsBatchMode(false);
    setApiKeysText("");
    setCustomModelMode(false);
    setError("");
    setShowForm(true);
  }

  function openEdit(config: MonitorConfig) {
    setEditingId(config.id);
    setForm({
      name: config.name,
      type: config.type,
      base_url: config.base_url,
      api_key: config.api_key,
      model: config.model,
      group_name: config.group_name,
      enabled: Boolean(config.enabled),
    });
    setSelectedTemplateId(config.template_id ? String(config.template_id) : "");
    setIsBatchMode(false);
    setApiKeysText("");
    setCustomModelMode(Boolean(config.template_id) && !templates.find((t) => t.id === config.template_id && t.models.includes(config.model)));
    setError("");
    setShowForm(true);
  }

  function handleTemplateChange(templateId: string) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templates.find((t) => String(t.id) === templateId);
    if (!tpl) return;
    setForm((f) => ({
      ...f,
      type: tpl.type,
      base_url: tpl.base_url,
      model: tpl.default_model,
      name: f.name || tpl.name,
    }));
    setCustomModelMode(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      if (isBatchMode && selectedTemplateId) {
        // ===== 批量模式 =====
        const apiKeys = apiKeysText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (apiKeys.length === 0) {
          setError("请填写至少一个 API Key");
          return;
        }
        const url = editingId ? `/api/monitors/${editingId}` : "/api/monitors";
        const method = editingId ? "PUT" : "POST";
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template_id: Number(selectedTemplateId),
            api_keys: apiKeys,
            name_prefix: form.name || undefined,
            group_name: form.group_name,
            enabled: form.enabled,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "操作失败");
          return;
        }
        setShowForm(false);
        fetchConfigs();
      } else if (editingId) {
        // ===== 编辑模式 =====
        const url = `/api/monitors/${editingId}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            template_id: selectedTemplateId ? Number(selectedTemplateId) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "操作失败");
          return;
        }
        setShowForm(false);
        fetchConfigs();
      } else {
        // ===== 单个创建模式 =====
        const res = await fetch("/api/monitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            template_id: selectedTemplateId ? Number(selectedTemplateId) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "操作失败");
          return;
        }
        setShowForm(false);
        fetchConfigs();
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定要删除这个监控配置吗？")) return;

    try {
      const res = await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchConfigs();
      }
    } catch {
      /* ignore */
    }
  }

  async function handleToggle(id: number, currentEnabled: number) {
    try {
      await fetch(`/api/monitors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      fetchConfigs();
    } catch {
      /* ignore */
    }
  }

  // 分组管理
  const groupedConfigs = useMemo(() => {
    return configs.reduce((acc, config) => {
      const group = config.group_name || "未分组";
      if (!acc[group]) acc[group] = [];
      acc[group].push(config);
      return acc;
    }, {} as Record<string, MonitorConfig[]>);
  }, [configs]);

  // 初始化时将所有分组设为展开（仅首次）
  useEffect(() => {
    const groups = Object.keys(groupedConfigs);
    if (groups.length > 0 && !groupsInitialized) {
      setExpandedGroups(new Set(groups));
      setGroupsInitialized(true);
    }
  }, [groupedConfigs, groupsInitialized]);

  function toggleGroup(group: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  // === 复制 Key ===
  async function handleCopyKey(configId: number, apiKey: string) {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedKeyId(configId);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      /* ignore */
    }
  }

  // === 批量选择 ===
  function toggleSelect(id: number) {
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
    if (selectedIds.size === configs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(configs.map((c) => c.id)));
    }
  }

  async function handleBatchDelete() {
    setBatchDeleting(true);
    try {
      for (const id of selectedIds) {
        await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      }
      setSelectedIds(new Set());
      setShowBatchDeleteConfirm(false);
      fetchConfigs();
      fetchDashboard();
    } catch {
      /* ignore */
    } finally {
      setBatchDeleting(false);
    }
  }

  // === 可用性数据提取 ===
  function getConfigStatus(configId: number) {
    if (!dashboardData?.providerTimelines) return null;
    const timeline = dashboardData.providerTimelines.find(
      (t: any) => t.id === String(configId)
    );
    if (!timeline?.latest) return null;
    const stats = dashboardData.availabilityStats?.[String(configId)]?.[0];
    return {
      status: timeline.latest.status,
      latencyMs: timeline.latest.latencyMs,
      availabilityPct: stats?.availabilityPct ?? null,
    };
  }

  async function handlePollChange(seconds: number) {
    setPollInterval(seconds);
    setPollSaving(true);
    setPollSaved(false);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollIntervalSeconds: seconds }),
      });
      setPollSaved(true);
      setTimeout(() => setPollSaved(false), 2000);
    } catch {
      /* ignore */
    } finally {
      setPollSaving(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleTypeChange(type: string) {
    setForm((f) => ({
      ...f,
      type,
      base_url: f.base_url === "" || PRESET_URLS[f.type] === f.base_url
        ? PRESET_URLS[type] || ""
        : f.base_url,
    }));
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Settings className="h-5 w-5 text-foreground" />
            <h1 className="text-lg font-semibold">监控配置管理</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/manage/templates"
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Layers className="h-3.5 w-3.5" />
              模板管理
            </Link>
            <button
              onClick={() => setShowChat(!showChat)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                showChat
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/40 text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              AI 助手
            </button>
            {username && (
              <span className="text-sm text-muted-foreground">{username}</span>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Poll Interval Settings */}
        <div className="mb-6 rounded-2xl border border-border/40 bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-foreground" />
            <h2 className="text-sm font-semibold text-foreground">探测频率</h2>
            {pollSaving && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            )}
            {pollSaved && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <Check className="h-3.5 w-3.5" /> 已保存
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {POLL_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handlePollChange(preset.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  pollInterval === preset.value
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            当前：每 <span className="font-medium text-foreground">{POLL_PRESETS.find((p) => p.value === pollInterval)?.label || `${pollInterval}秒`}</span> 探测一次各 API 端点存活状态
          </p>
        </div>

        {/* Actions */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              共 {configs.length} 个监控配置
            </p>
            {configs.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.size === configs.length && configs.length > 0}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-border"
                />
                全选
              </label>
            )}
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <Plus className="h-4 w-4" />
            添加监控
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && configs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Activity className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-medium text-foreground">
              还没有监控配置
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              点击「添加监控」开始配置您的 API 监控
            </p>
          </div>
        )}

        {/* Config List - Grouped */}
        <div className="space-y-4">
          {Object.entries(groupedConfigs).map(([group, groupConfigs]) => (
            <div key={group} className="rounded-2xl border border-border/40 bg-card overflow-hidden">
              {/* Group Header */}
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedGroups.has(group) ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h3 className="font-semibold text-foreground">{group}</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {groupConfigs.length} 个配置
                  </span>
                </div>
              </button>

              {/* Group Content */}
              {expandedGroups.has(group) && (
                <div className="border-t border-border/40 divide-y divide-border/40">
                  {groupConfigs.map((config) => {
                    const status = getConfigStatus(config.id);
                    return (
                      <div
                        key={config.id}
                        className={cn(
                          "p-5 transition-all hover:bg-muted/30",
                          !config.enabled && "opacity-60"
                        )}
                      >
                        <div className="flex items-start gap-4">
                          {/* Checkbox */}
                          <label className="flex items-center pt-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(config.id)}
                              onChange={() => toggleSelect(config.id)}
                              className="h-4 w-4 rounded border-border"
                            />
                          </label>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-foreground">
                                {config.name}
                              </h4>
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {TYPE_OPTIONS.find((t) => t.value === config.type)?.label || config.type}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                  config.enabled
                                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                    : "bg-gray-500/10 text-gray-500"
                                )}
                              >
                                {config.enabled ? "启用" : "停用"}
                              </span>
                              {/* 可用性状态 */}
                              {status && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                    status.status === "operational" && "bg-green-500/10 text-green-600 dark:text-green-400",
                                    status.status === "degraded" && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
                                    status.status === "error" && "bg-red-500/10 text-red-600 dark:text-red-400",
                                    status.status === "failed" && "bg-red-500/10 text-red-600 dark:text-red-400"
                                  )}
                                >
                                  {status.status === "operational" && <CheckCircle2 className="h-3 w-3" />}
                                  {status.status === "degraded" && <AlertCircle className="h-3 w-3" />}
                                  {status.status === "error" && <XCircle className="h-3 w-3" />}
                                  {status.status === "failed" && <XCircle className="h-3 w-3" />}
                                  {status.status === "operational" && "正常"}
                                  {status.status === "degraded" && "降级"}
                                  {status.status === "error" && "错误"}
                                  {status.status === "failed" && "失败"}
                                </span>
                              )}
                              {/* 可用性百分比 */}
                              {status?.availabilityPct !== null && status?.availabilityPct !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                  可用性: <span className="font-medium text-foreground">{status.availabilityPct}%</span>
                                </span>
                              )}
                              {/* 延迟 */}
                              {status?.latencyMs !== null && status?.latencyMs !== undefined && (
                                <span className="text-xs text-muted-foreground">
                                  延迟: <span className="font-medium text-foreground">{status.latencyMs}ms</span>
                                </span>
                              )}
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs">URL</span>
                                <span className="truncate">{config.base_url}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs">模型</span>
                                <span>{config.active_model || config.model}</span>
                                {config.active_model && config.active_model !== config.model && (
                                  <span className="inline-flex items-center gap-0.5 text-xs text-orange-600 dark:text-orange-400">
                                    <Wrench className="h-3 w-3" />
                                    降级
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs">Key</span>
                                <span className="font-mono">
                                  {showKeys[config.id]
                                    ? config.api_key
                                    : config.api_key.slice(0, 6) + "••••••"}
                                </span>
                                <button
                                  onClick={() =>
                                    setShowKeys((s) => ({
                                      ...s,
                                      [config.id]: !s[config.id],
                                    }))
                                  }
                                  className="text-muted-foreground/60 hover:text-foreground"
                                  title={showKeys[config.id] ? "隐藏" : "显示"}
                                >
                                  {showKeys[config.id] ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleCopyKey(config.id, config.api_key)}
                                  className="text-muted-foreground/60 hover:text-foreground"
                                  title="复制 Key"
                                >
                                  {copiedKeyId === config.id ? (
                                    <Check className="h-3.5 w-3.5 text-green-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => handleToggle(config.id, config.enabled)}
                              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              title={config.enabled ? "停用" : "启用"}
                            >
                              {config.enabled ? (
                                <ToggleRight className="h-5 w-5 text-green-500" />
                              ) : (
                                <ToggleLeft className="h-5 w-5" />
                              )}
                            </button>
                            <button
                              onClick={() => openEdit(config)}
                              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              title="编辑"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(config.id)}
                              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-xl">
              <h2 className="mb-6 text-lg font-semibold">
                {editingId ? "编辑监控配置" : "添加监控配置"}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}

                {/* 模板选择 */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                    模板
                    <span className="text-xs font-normal text-muted-foreground">(可选)</span>
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">不使用模板</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}{tpl.built_in ? " (内置)" : ""} - {tpl.description}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    选模板后自动填充类型、Base URL 和首选模型。未选中则需手动填写。
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">名称</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder={selectedTemplateId
                        ? templates.find((t) => String(t.id) === selectedTemplateId)?.name + " #1"
                        : "例：OpenAI 主力节点"}
                      className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">类型</label>
                    <select
                      value={form.type}
                      onChange={(e) => handleTypeChange(e.target.value)}
                      className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Base URL</label>
                  <input
                    type="url"
                    value={form.base_url}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, base_url: e.target.value }))
                    }
                    placeholder="https://api.example.com/v1/chat/completions"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>

                {/* 批量模式开关（仅创建时） */}
                {!editingId && (
                  <div className="rounded-xl border border-border/40 bg-muted/20 p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsBatchMode(!isBatchMode)}
                        disabled={!selectedTemplateId}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          isBatchMode ? "bg-blue-500" : "bg-muted",
                          !selectedTemplateId && "cursor-not-allowed opacity-40"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                            isBatchMode ? "translate-x-5" : "translate-x-1"
                          )}
                        />
                      </button>
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                        批量创建
                      </span>
                      {!selectedTemplateId && (
                        <span className="text-xs text-muted-foreground">(需先选模板)</span>
                      )}
                    </div>
                    {isBatchMode && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        每个 API Key 生成一个监控配置，命名为「{form.name || "模板名"} #1、#2、…」。当首选模型不可用时，会自动按模板中其他模型降级。
                      </p>
                    )}
                  </div>
                )}

                {isBatchMode && !editingId ? (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      API Keys
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (每行一个)
                      </span>
                    </label>
                    <textarea
                      value={apiKeysText}
                      onChange={(e) => setApiKeysText(e.target.value)}
                      placeholder={"sk-key-1\nsk-key-2\nsk-key-3"}
                      rows={5}
                      className="w-full resize-none rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 font-mono text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      已输入 {apiKeysText.split(/\r?\n/).filter((s) => s.trim()).length} 个有效 Key
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">API Key</label>
                      <input
                        type="text"
                        value={form.api_key}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, api_key: e.target.value }))
                        }
                        placeholder="sk-..."
                        className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">模型</label>
                      {(() => {
                        const tpl = templates.find((t) => String(t.id) === selectedTemplateId);
                        if (tpl && !customModelMode) {
                          return (
                            <div className="flex gap-2">
                              <select
                                value={form.model}
                                onChange={(e) => {
                                  if (e.target.value === "__custom__") {
                                    setCustomModelMode(true);
                                  } else {
                                    setForm((f) => ({ ...f, model: e.target.value }));
                                  }
                                }}
                                className="flex-1 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                                required
                              >
                                {tpl.models.map((m) => (
                                  <option key={m} value={m}>
                                    {m}{m === tpl.default_model ? " (首选)" : ""}
                                  </option>
                                ))}
                                <option value="__custom__">+ 自定义...</option>
                              </select>
                            </div>
                          );
                        }
                        return (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={form.model}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, model: e.target.value }))
                              }
                              placeholder="gpt-4o"
                              className="flex-1 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                              required
                            />
                            {tpl && (
                              <button
                                type="button"
                                onClick={() => setCustomModelMode(false)}
                                className="flex items-center gap-1 rounded-xl border border-border/60 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted"
                                title="返回模板模型列表"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    分组名称{" "}
                    <span className="text-muted-foreground">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={form.group_name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, group_name: e.target.value }))
                    }
                    placeholder="例：生产环境"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, enabled: !f.enabled }))
                    }
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      form.enabled ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        form.enabled ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                  <span className="text-sm">
                    {form.enabled ? "启用" : "停用"}
                  </span>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 rounded-xl border border-border/60 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90",
                      saving && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {saving ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                    ) : isBatchMode && !editingId ? (
                      `批量创建${apiKeysText.split(/\r?\n/).filter((s) => s.trim()).length}个`
                    ) : editingId ? (
                      "保存修改"
                    ) : (
                      "添加"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Batch Delete Confirm Dialog */}
        {showBatchDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border/40 bg-background p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-semibold text-foreground">
                确认批量删除
              </h2>
              <p className="mb-4 text-sm text-muted-foreground">
                确定要删除以下 {selectedIds.size} 个监控配置吗？此操作不可撤销。
              </p>
              <div className="mb-4 max-h-48 overflow-y-auto rounded-xl bg-muted/50 p-3">
                <ul className="space-y-1">
                  {configs
                    .filter((c) => selectedIds.has(c.id))
                    .map((c) => (
                      <li key={c.id} className="text-sm text-foreground">
                        • {c.name}
                      </li>
                    ))}
                </ul>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  disabled={batchDeleting}
                  className="flex-1 rounded-xl border border-border/60 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600",
                    batchDeleting && "cursor-not-allowed opacity-60"
                  )}
                >
                  {batchDeleting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    `删除 ${selectedIds.size} 项`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Batch Action Bar */}
      {selectedIds.size > 0 && !showForm && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <div className="flex items-center gap-4 rounded-2xl border border-border/40 bg-background/95 px-6 py-3 shadow-lg backdrop-blur-sm">
            <span className="text-sm font-medium text-foreground">
              已选择 <span className="text-primary">{selectedIds.size}</span> 项
            </span>
            <button
              onClick={() => setShowBatchDeleteConfirm(true)}
              className="flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              <Trash2 className="h-4 w-4" />
              批量删除
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              取消选择
            </button>
          </div>
        </div>
      )}

      {/* AI Chat Panel */}
      <ChatPanel isOpen={showChat} onClose={() => setShowChat(false)} />
    </div>
  );
}
