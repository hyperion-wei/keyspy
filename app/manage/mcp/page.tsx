"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cable,
  Plus,
  Trash2,
  LogOut,
  Copy,
  Check,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";

interface McpTokenItem {
  id: number;
  name: string;
  token: string;
  created_by: number;
  creator_username: string | null;
  enabled: number;
  last_used_at: string | null;
  created_at: string;
}

function buildMcpConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        keyspy: {
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function McpManagePage() {
  const [username, setUsername] = useState("");
  const [tokens, setTokens] = useState<McpTokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 生成表单
  const [formName, setFormName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<McpTokenItem | null>(null);

  // 可见性 / 复制状态
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState("");

  const [mcpUrl, setMcpUrl] = useState("");

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
    fetchTokens();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => d.user && setUsername(d.user.username))
      .catch(() => {});
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp-tokens");
      if (!res.ok) {
        if (res.status === 403) {
          setError("需要管理员权限");
          return;
        }
        throw new Error("获取 Token 列表失败");
      }
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  function markCopied(key: string) {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 2000);
  }

  async function handleCopy(key: string, text: string) {
    if (await copyText(text)) markCopied(key);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "生成失败");
        return;
      }
      setNewToken(data.token);
      setFormName("");
      fetchTokens();
    } catch {
      setError("网络错误");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(item: McpTokenItem) {
    try {
      const res = await fetch("/api/mcp-tokens", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "操作失败");
        return;
      }
      fetchTokens();
    } catch {
      alert("网络错误");
    }
  }

  async function handleDelete(item: McpTokenItem) {
    if (!confirm(`确定要删除 Token「${item.name}」？使用该 Token 的 MCP 客户端将立即失效。`)) return;
    try {
      const res = await fetch(`/api/mcp-tokens?id=${item.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "删除失败");
        return;
      }
      if (newToken?.id === item.id) setNewToken(null);
      fetchTokens();
    } catch {
      alert("网络错误");
    }
  }

  function toggleVisible(id: number) {
    setVisibleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function maskToken(token: string): string {
    if (token.length <= 20) return token;
    return `${token.slice(0, 14)}••••••••${token.slice(-6)}`;
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-10 border-b border-border/40 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Link
                href="/manage"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <Cable className="h-5 w-5 text-foreground" />
              <h1 className="text-lg font-semibold">MCP 管理</h1>
            </div>
            <div className="flex items-center gap-3">
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

        <main className="mx-auto max-w-4xl px-4 py-6">
          {/* MCP 服务说明 */}
          <div className="mb-6 rounded-2xl border border-border/40 bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">MCP 服务端点</h2>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              KeySpy 内置 MCP 服务器（Streamable HTTP，无状态），提供监控管理、模板管理、Hunt
              扫描、Key 测试等全部非管理员功能。在 AI 客户端（Qoder / Cursor / Cherry Studio
              等）中添加以下配置即可使用。
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm">
                {mcpUrl || "…"}
              </code>
              <button
                onClick={() => handleCopy("url", mcpUrl)}
                className="flex items-center gap-1 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {copiedKey === "url" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedKey === "url" ? "已复制" : "复制"}
              </button>
            </div>
          </div>

          {/* 生成 Token */}
          <div className="mb-6 rounded-2xl border border-border/40 bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="h-4 w-4 text-foreground" />
              <h2 className="text-sm font-semibold">生成 MCP Token</h2>
            </div>
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                placeholder="Token 名称（如：qoder、cursor），留空自动生成"
                maxLength={50}
              />
              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                生成
              </button>
            </form>

            {/* 新生成的 Token 展示 + 一键复制配置 */}
            {newToken && (
              <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                <p className="mb-2 text-xs font-medium text-green-600 dark:text-green-400">
                  Token「{newToken.name}」已生成，请妥善保存（删除后无法找回）
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-border/60 bg-background px-3 py-2 font-mono text-sm">
                    {newToken.token}
                  </code>
                  <button
                    onClick={() => handleCopy(`new-token-${newToken.id}`, newToken.token)}
                    className="flex items-center gap-1 rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {copiedKey === `new-token-${newToken.id}` ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    复制 Token
                  </button>
                  <button
                    onClick={() => handleCopy(`new-config-${newToken.id}`, buildMcpConfig(mcpUrl, newToken.token))}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {copiedKey === `new-config-${newToken.id}` ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedKey === `new-config-${newToken.id}` ? "已复制" : "一键复制 MCP 配置"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Token 列表 */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Token 列表</h2>
            <div className="text-sm text-muted-foreground">共 {tokens.length} 个</div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card p-12 text-center">
              <Cable className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">
                暂无 Token，请在上方生成一个
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tokens.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-xl border border-border/40 bg-card p-4 transition-colors hover:border-border/60",
                    !item.enabled && "opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        <Cable className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.name}</span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              item.enabled
                                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {item.enabled ? "启用中" : "已停用"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          创建者：{item.creator_username || "未知"} · 创建于{" "}
                          {new Date(item.created_at).toLocaleDateString("zh-CN")}
                          {item.last_used_at &&
                            ` · 最近使用 ${new Date(item.last_used_at).toLocaleDateString("zh-CN")}`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleVisible(item.id)}
                        className="rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:text-foreground"
                        title={visibleIds.has(item.id) ? "隐藏" : "显示"}
                      >
                        {visibleIds.has(item.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleCopy(`token-${item.id}`, item.token)}
                        className="flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {copiedKey === `token-${item.id}` ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Token
                      </button>
                      <button
                        onClick={() => handleCopy(`config-${item.id}`, buildMcpConfig(mcpUrl, item.token))}
                        className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        {copiedKey === `config-${item.id}` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedKey === `config-${item.id}` ? "已复制" : "复制配置"}
                      </button>
                      <button
                        onClick={() => handleToggle(item)}
                        className="rounded-lg border border-border/60 p-2 text-muted-foreground transition-colors hover:text-foreground"
                        title={item.enabled ? "停用" : "启用"}
                      >
                        {item.enabled ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <code className="block truncate rounded-lg border border-border/40 bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground">
                      {visibleIds.has(item.id) ? item.token : maskToken(item.token)}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 配置格式说明 */}
          <div className="mt-8 rounded-2xl border border-border/40 bg-card p-5">
            <h3 className="mb-2 text-sm font-semibold">配置格式说明</h3>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              「复制配置」生成的 JSON 格式如下，可直接粘贴到支持 Streamable HTTP 的 MCP
              客户端配置中（Qoder、Cursor、Cherry Studio、Cline 等）：
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background p-3 font-mono text-xs leading-relaxed text-muted-foreground">
{`{
  "mcpServers": {
    "keyspy": {
      "url": "${mcpUrl || "http://<host>:<port>/api/mcp"}",
      "headers": { "Authorization": "Bearer keyspy_mcp_xxx" }
    }
  }
}`}
            </pre>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
