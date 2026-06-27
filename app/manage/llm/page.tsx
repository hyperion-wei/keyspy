"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  Download,
  Loader2,
  Check,
  Copy,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";

// ===== Types =====

interface ChatSetting {
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

interface MonitorConfig {
  id: number;
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  model: string;
  group_name: string;
  enabled: number;
}

interface DashboardData {
  providerTimelines?: {
    id: string;
    latest?: { status: string; latencyMs: number };
  }[];
}

type FormData = {
  name: string;
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  enabled: boolean;
};

const EMPTY_FORM: FormData = {
  name: "",
  provider: "openai",
  api_key: "",
  base_url: "",
  model: "",
  enabled: true,
};

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
];

const PRESET_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
};

// ===== Page =====

export default function LLMSettingsPage() {
  return (
    <AuthGuard>
      <LLMSettingsContent />
    </AuthGuard>
  );
}

function LLMSettingsContent() {
  const [settings, setSettings] = useState<ChatSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 导入相关
  const [showImport, setShowImport] = useState(false);
  const [aliveMonitors, setAliveMonitors] = useState<MonitorConfig[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<number>>(new Set());

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/chat-settings");
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(setting: ChatSetting) {
    setEditingId(setting.id);
    setForm({
      name: setting.name,
      provider: setting.provider,
      api_key: "", // 不预填 key
      base_url: setting.base_url,
      model: setting.model,
      enabled: Boolean(setting.enabled),
    });
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      if (editingId) {
        const body: Record<string, unknown> = {
          name: form.name,
          provider: form.provider,
          base_url: form.base_url,
          model: form.model,
          enabled: form.enabled,
        };
        // 只有填写了 key 才更新
        if (form.api_key.trim()) {
          body.api_key = form.api_key;
        }
        const res = await fetch(`/api/chat-settings/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "更新失败");
          return;
        }
      } else {
        const res = await fetch("/api/chat-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "创建失败");
          return;
        }
      }
      setShowForm(false);
      fetchSettings();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定删除此聊天 LLM 配置？")) return;
    try {
      await fetch(`/api/chat-settings/${id}`, { method: "DELETE" });
      fetchSettings();
    } catch {
      /* ignore */
    }
  }

  async function handleToggle(id: number, currentEnabled: number) {
    try {
      await fetch(`/api/chat-settings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      fetchSettings();
    } catch {
      /* ignore */
    }
  }

  function handleCopyKey(id: number, key: string) {
    // 先获取完整 key
    fetch(`/api/chat-settings/${id}`)
      .then((r) => r.json())
      .then((d) => {
        navigator.clipboard.writeText(d.api_key || key);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      })
      .catch(() => {
        navigator.clipboard.writeText(key);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      });
  }

  // ===== 导入存活 Key =====
  async function openImportDialog() {
    setShowImport(true);
    setImportLoading(true);
    setSelectedImportIds(new Set());
    try {
      // 获取监控配置和 Dashboard 数据
      const [monRes, dashRes] = await Promise.all([
        fetch("/api/monitors"),
        fetch("/api/dashboard"),
      ]);
      const monitors: MonitorConfig[] = monRes.ok ? await monRes.json() : [];
      const dashboard: DashboardData = dashRes.ok ? await dashRes.json() : {};

      // 找出存活的监控配置
      const aliveIds = new Set<string>();
      dashboard.providerTimelines?.forEach((t) => {
        if (t.latest?.status === "operational" || t.latest?.status === "degraded") {
          aliveIds.add(t.id);
        }
      });

      const alive = monitors.filter((m) => aliveIds.has(String(m.id)));
      setAliveMonitors(alive);
    } catch {
      /* ignore */
    } finally {
      setImportLoading(false);
    }
  }

  function toggleImportSelect(id: number) {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleImportSelectAll() {
    if (selectedImportIds.size === aliveMonitors.length) {
      setSelectedImportIds(new Set());
    } else {
      setSelectedImportIds(new Set(aliveMonitors.map((m) => m.id)));
    }
  }

  async function handleImport() {
    if (selectedImportIds.size === 0) return;
    setImporting(true);

    try {
      // 获取选中的监控配置的完整信息
      const selected = aliveMonitors.filter((m) => selectedImportIds.has(m.id));

      // 逐个获取完整 key 并创建 chat_setting
      for (const monitor of selected) {
        // 通过 monitors API 获取完整信息（包含 key）
        const detailRes = await fetch(`/api/monitors/${monitor.id}`);
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();

        // 创建 chat_setting
        await fetch("/api/chat-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `导入: ${detail.name}`,
            provider: detail.type || "openai",
            api_key: detail.api_key,
            base_url: normalizeBaseUrl(detail.base_url),
            model: detail.model,
            enabled: true,
          }),
        });
      }

      setShowImport(false);
      fetchSettings();
    } catch {
      /* ignore */
    } finally {
      setImporting(false);
    }
  }

  function normalizeBaseUrl(url: string): string {
    if (!url) return "";
    return url
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/$/, "");
  }

  // ===== 状态指示 =====
  function getStatusIcon(setting: ChatSetting) {
    if (!setting.enabled) return null;
    // 这里可以根据实际情况显示状态
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <MessageSquare className="h-5 w-5 text-foreground" />
            <h1 className="text-lg font-semibold">聊天 LLM 配置</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/manage"
              className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              监控管理
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* 说明卡片 */}
        <div className="mb-6 rounded-2xl border border-border/40 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10">
              <MessageSquare className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                聊天 LLM 配置说明
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                配置用于 AI 智能解析、对话式管理等功能的 LLM 服务。
                支持多个配置自动 fallback，当某个 key 不可用时自动切换到下一个。
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            共 {settings.length} 个聊天配置
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={openImportDialog}
              className="flex items-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Download className="h-4 w-4" />
              导入存活 Key
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              <Plus className="h-4 w-4" />
              添加配置
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && settings.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-medium text-foreground">还没有聊天 LLM 配置</p>
            <p className="mt-1 text-sm text-muted-foreground">
              添加一个 LLM 配置以启用 AI 智能解析和对话式管理功能
            </p>
          </div>
        )}

        {/* Settings List */}
        <div className="space-y-3">
          {settings.map((setting, idx) => (
            <div
              key={setting.id}
              className={cn(
                "rounded-2xl border border-border/40 bg-card p-5 transition-all hover:bg-card/80",
                !setting.enabled && "opacity-60"
              )}
            >
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/10 text-xs font-bold text-violet-600 dark:text-violet-400">
                      {idx + 1}
                    </span>
                    <h4 className="font-semibold text-foreground">{setting.name}</h4>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {PROVIDER_OPTIONS.find((p) => p.value === setting.provider)?.label || setting.provider}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        setting.enabled
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-gray-500/10 text-gray-500"
                      )}
                    >
                      {setting.enabled ? "启用" : "停用"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">URL</span>
                      <span className="truncate font-mono text-xs">{setting.base_url}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">模型</span>
                      <span className="text-xs">{setting.model}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">Key</span>
                      <span className="font-mono text-xs">
                        {showKeys[setting.id]
                          ? setting.api_key
                          : setting.api_key.slice(0, 12) + "••••••"}
                      </span>
                      <button
                        onClick={() =>
                          setShowKeys((s) => ({ ...s, [setting.id]: !s[setting.id] }))
                        }
                        className="text-muted-foreground/60 hover:text-foreground"
                      >
                        {showKeys[setting.id] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleCopyKey(setting.id, setting.api_key)}
                        className="text-muted-foreground/60 hover:text-foreground"
                      >
                        {copiedId === setting.id ? (
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
                    onClick={() => handleToggle(setting.id, setting.enabled)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={setting.enabled ? "停用" : "启用"}
                  >
                    {setting.enabled ? (
                      <ToggleRight className="h-5 w-5 text-green-500" />
                    ) : (
                      <ToggleLeft className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    onClick={() => openEdit(setting)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="编辑"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(setting.id)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Fallback 顺序提示 */}
        {settings.filter((s) => s.enabled).length > 1 && (
          <div className="mt-6 rounded-xl border border-border/40 bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="font-medium text-foreground">Fallback 顺序</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 解析时按编号顺序尝试启用的配置，遇到不可用的 key 自动切换到下一个。
              当前有 {settings.filter((s) => s.enabled).length} 个启用配置。
            </p>
          </div>
        )}
      </main>

      {/* ===== Form Modal ===== */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-xl">
            <h2 className="mb-6 text-lg font-semibold">
              {editingId ? "编辑聊天 LLM 配置" : "添加聊天 LLM 配置"}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">名称</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="例：DeepSeek 主力"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">提供商</label>
                  <select
                    value={form.provider}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        provider: e.target.value,
                        base_url: f.base_url === "" || Object.values(PRESET_URLS).includes(f.base_url)
                          ? PRESET_URLS[e.target.value] || ""
                          : f.base_url,
                      }))
                    }
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {PROVIDER_OPTIONS.map((opt) => (
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
                  type="text"
                  value={form.base_url}
                  onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  填写到 /v1 即可，不要包含 /chat/completions
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    API Key
                    {editingId && (
                      <span className="ml-1 text-xs text-muted-foreground">(留空不修改)</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    placeholder="sk-..."
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required={!editingId}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">模型</label>
                  <input
                    type="text"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="gpt-4o / deepseek-chat"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
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
                <span className="text-sm">{form.enabled ? "启用" : "停用"}</span>
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
                    <Loader2 className="h-4 w-4 animate-spin" />
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

      {/* ===== Import Dialog ===== */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold">导入存活 Key</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              从监控配置中选择状态正常的 key，一键导入为聊天 LLM 配置
            </p>

            {importLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">检测存活状态...</span>
              </div>
            ) : aliveMonitors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="mb-3 h-10 w-10 text-amber-500/60" />
                <p className="text-sm font-medium text-foreground">
                  没有检测到存活的监控配置
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  请确保有状态为"正常"或"降级"的监控配置
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    发现 {aliveMonitors.length} 个存活配置
                  </span>
                  <button
                    onClick={toggleImportSelectAll}
                    className="text-xs text-primary hover:underline"
                  >
                    {selectedImportIds.size === aliveMonitors.length ? "取消全选" : "全选"}
                  </button>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border/40 bg-muted/20 p-3">
                  {aliveMonitors.map((m) => {
                    const isSelected = selectedImportIds.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                          isSelected
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/30 hover:border-border/60"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleImportSelect(m.id)}
                          className="h-4 w-4 rounded border-border"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {m.name}
                            </span>
                            <span className="text-xs text-muted-foreground">{m.model}</span>
                          </div>
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {m.base_url}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowImport(false)}
                disabled={importing}
                className="flex-1 rounded-xl border border-border/60 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={selectedImportIds.size === 0 || importing}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:from-violet-500 hover:to-indigo-500",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {importing ? "导入中..." : `导入 ${selectedImportIds.size || ""} 个`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
