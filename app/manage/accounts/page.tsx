"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  Plus,
  Pencil,
  Trash2,
  LogOut,
  Shield,
  User,
  Check,
  X,
  Key,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";

interface UserItem {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export default function AccountsPage() {
  const [username, setUsername] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 表单
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("user");
  const [showPassword, setShowPassword] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (!res.ok) {
        if (res.status === 403) {
          setError("需要管理员权限");
          return;
        }
        throw new Error("获取用户列表失败");
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => d.user && setUsername(d.user.username))
      .catch(() => {});
  }, [fetchUsers]);

  function openAdd() {
    setEditingId(null);
    setFormUsername("");
    setFormPassword("");
    setFormRole("user");
    setError("");
    setShowForm(true);
  }

  function openEdit(user: UserItem) {
    setEditingId(user.id);
    setFormUsername(user.username);
    setFormPassword("");
    setFormRole(user.role);
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      if (editingId) {
        // 编辑模式
        const body: Record<string, unknown> = { id: editingId };
        if (formUsername) body.username = formUsername;
        if (formPassword) body.password = formPassword;
        if (formRole) body.role = formRole;

        const res = await fetch("/api/users", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "操作失败");
          return;
        }
      } else {
        // 创建模式
        if (!formUsername || !formPassword) {
          setError("用户名和密码不能为空");
          return;
        }
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: formUsername,
            password: formPassword,
            role: formRole,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "创建失败");
          return;
        }
      }
      setShowForm(false);
      fetchUsers();
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`确定要删除用户「${name}」？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "删除失败");
        return;
      }
      fetchUsers();
    } catch {
      alert("网络错误");
    }
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
              <Users className="h-5 w-5 text-foreground" />
              <h1 className="text-lg font-semibold">账户管理</h1>
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
          {/* 添加按钮 */}
          <div className="mb-6 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              共 {users.length} 个用户
            </div>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              添加用户
            </button>
          </div>

          {/* 错误提示 */}
          {error && !showForm && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* 表单 */}
          {showForm && (
            <div className="mb-6 rounded-2xl border border-border/40 bg-card p-6">
              <h2 className="mb-4 text-base font-semibold">
                {editingId ? "编辑用户" : "添加用户"}
              </h2>
              {error && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                    placeholder="3-30 个字符"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                    密码 {editingId && "(留空则不修改)"}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                      placeholder={editingId ? "留空不修改" : "至少 6 个字符"}
                      required={!editingId}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                    角色
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setFormRole("user")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        formRole === "user"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <User className="h-4 w-4" />
                      普通用户
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormRole("admin")}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        formRole === "admin"
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Shield className="h-4 w-4" />
                      管理员
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {editingId ? "保存" : "创建"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex items-center gap-1.5 rounded-lg border border-border/60 px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                    取消
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 用户列表 */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card p-12 text-center">
              <Users className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">暂无用户</p>
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-card p-4 transition-colors hover:border-border/60"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full",
                        user.role === "admin"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      )}
                    >
                      {user.role === "admin" ? (
                        <Shield className="h-5 w-5" />
                      ) : (
                        <User className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.username}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            user.role === "admin"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          )}
                        >
                          {user.role === "admin" ? "管理员" : "普通用户"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        创建于 {new Date(user.created_at).toLocaleDateString("zh-CN")}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(user)}
                      className="flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      title="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(user.id, user.username)}
                      disabled={user.username === "admin"}
                      className={cn(
                        "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        user.username === "admin"
                          ? "cursor-not-allowed border-border/30 text-muted-foreground/30"
                          : "border-red-500/30 text-red-500 hover:bg-red-500/10"
                      )}
                      title={user.username === "admin" ? "不能删除默认管理员" : "删除"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
