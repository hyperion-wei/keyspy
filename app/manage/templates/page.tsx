"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Layers,
  X,
  Lock,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";

interface MonitorTemplate {
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

interface FormData {
  name: string;
  type: string;
  base_url: string;
  models: string[];
  default_model: string;
  description: string;
}

const EMPTY_FORM: FormData = {
  name: "",
  type: "openai",
  base_url: "",
  models: [],
  default_model: "",
  description: "",
};

const TYPE_OPTIONS = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

const PRESET_URLS: Record<string, string> = {
  openai: "https://api.example.com/v1/chat/completions",
  anthropic: "https://api.example.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com",
};

export default function TemplatesPage() {
  return (
    <AuthGuard>
      <TemplatesContent />
    </AuthGuard>
  );
}

function TemplatesContent() {
  const [templates, setTemplates] = useState<MonitorTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [newModel, setNewModel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        setTemplates(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, models: [] });
    setNewModel("");
    setError("");
    setShowForm(true);
  }

  function openEdit(tpl: MonitorTemplate) {
    setEditingId(tpl.id);
    setForm({
      name: tpl.name,
      type: tpl.type,
      base_url: tpl.base_url,
      models: [...tpl.models],
      default_model: tpl.default_model,
      description: tpl.description,
    });
    setNewModel("");
    setError("");
    setShowForm(true);
  }

  function addModel() {
    const m = newModel.trim();
    if (!m) return;
    if (form.models.includes(m)) {
      setError("模型已存在");
      return;
    }
    setForm((f) => ({ ...f, models: [...f.models, m] }));
    setNewModel("");
    setError("");
  }

  function removeModel(m: string) {
    setForm((f) => ({
      ...f,
      models: f.models.filter((x) => x !== m),
      default_model: f.default_model === m ? (f.models.find((x) => x !== m) ?? "") : f.default_model,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      if (form.models.length === 0) {
        setError("至少添加一个模型");
        return;
      }
      if (!form.default_model || !form.models.includes(form.default_model)) {
        setError("默认模型必须从列表中选择");
        return;
      }

      const url = editingId ? `/api/templates/${editingId}` : "/api/templates";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }

      setShowForm(false);
      fetchTemplates();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`确定要删除模板「${name}」吗？`)) return;
    try {
      const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "删除失败");
        return;
      }
      fetchTemplates();
    } catch {
      /* ignore */
    }
  }

  function handleTypeChange(type: string) {
    setForm((f) => ({
      ...f,
      type,
      base_url: f.base_url === "" || f.base_url === PRESET_URLS[f.type]
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
              href="/manage"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Layers className="h-5 w-5 text-foreground" />
            <h1 className="text-lg font-semibold">模板管理</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-xl bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              <Plus className="h-4 w-4" />
              新建模板
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <p className="mb-4 text-sm text-muted-foreground">
          共 {templates.length} 个模板{loading ? "（加载中…）" : ""}
        </p>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Layers className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-lg font-medium text-foreground">还没有模板</p>
            <p className="mt-1 text-sm text-muted-foreground">
              点击「新建模板」创建你的第一个监控模板
            </p>
          </div>
        )}

        {/* Template List */}
        <div className="space-y-3">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className={cn(
                "group rounded-2xl border border-border/40 bg-card p-5 transition-all hover:border-border/60 hover:shadow-sm"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">{tpl.name}</h3>
                    {tpl.built_in ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <Lock className="h-3 w-3" />
                        内置
                      </span>
                    ) : null}
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {TYPE_OPTIONS.find((t) => t.value === tpl.type)?.label || tpl.type}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                      首选：{tpl.default_model}
                    </span>
                  </div>

                  {tpl.description && (
                    <p className="mt-1.5 text-sm text-muted-foreground">{tpl.description}</p>
                  )}

                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">URL</span>
                      <span className="truncate font-mono text-xs text-foreground/70">{tpl.base_url}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">模型</span>
                      <div className="flex flex-wrap gap-1">
                        {tpl.models.map((m) => (
                          <span
                            key={m}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs",
                              m === tpl.default_model
                                ? "bg-blue-500/15 font-semibold text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {m}
                            {m === tpl.default_model && <span className="text-[10px]">★</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openEdit(tpl)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="编辑"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!tpl.built_in && (
                    <button
                      onClick={() => handleDelete(tpl.id, tpl.name)}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background p-6 shadow-xl">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {editingId ? "编辑模板" : "新建模板"}
                </h2>
                {editingId && templates.find((t) => t.id === editingId)?.built_in ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Lock className="h-3 w-3" />
                    内置模板（可编辑不可删除）
                  </span>
                ) : null}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">名称 *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="例：MyProvider"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">描述</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="可选"
                      className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Base URL *</label>
                  <input
                    type="url"
                    value={form.base_url}
                    onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="https://api.example.com/v1/chat/completions"
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    模型列表 *
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (顺序 = 降级优先级)
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addModel();
                        }
                      }}
                      placeholder="如 gpt-4o-mini"
                      className="flex-1 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={addModel}
                      className="flex items-center gap-1 rounded-xl border border-border/60 px-3 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      <Plus className="h-4 w-4" />
                      添加
                    </button>
                  </div>
                  {form.models.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 rounded-xl bg-muted/30 p-2.5">
                      {form.models.map((m, idx) => (
                        <span
                          key={m}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs",
                            m === form.default_model
                              ? "bg-blue-500/15 font-semibold text-blue-700 ring-1 ring-blue-500/30 dark:text-blue-300"
                              : "bg-background text-foreground/70"
                          )}
                        >
                          <span className="text-[10px] text-muted-foreground">{idx + 1}.</span>
                          {m}
                          <button
                            type="button"
                            onClick={() => removeModel(m)}
                            className="ml-1 rounded p-0.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                            title="删除"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border/40 p-3 text-center text-xs text-muted-foreground">
                      还没有添加模型
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">默认模型 *</label>
                  <select
                    value={form.default_model}
                    onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))}
                    className="w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm font-mono focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  >
                    <option value="">-- 请选择 --</option>
                    {form.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    检测时优先尝试默认模型，失败后按列表顺序自动降级
                  </p>
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
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        {editingId ? "保存" : "创建"}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}