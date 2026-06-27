"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Send,
  MessageSquare,
  Bot,
  User,
  Loader2,
  Settings,
  Plus,
  Trash2,
  Pencil,
  StopCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatSetting {
  id: number;
  name: string;
  provider: string;
  api_key: string;
  base_url: string;
  model: string;
  enabled: number;
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [settings, setSettings] = useState<ChatSetting[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingId, setActiveSettingId] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/chat-settings");
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        const enabled = data.find((s: ChatSetting) => s.enabled === 1);
        if (enabled) setActiveSettingId(enabled.id);
      }
    } catch {
      /* ignore */
    }
  }

  const transport = new DefaultChatTransport({
    api: "/api/chat",
    body: { chatSettingId: activeSettingId },
  });

  const chat = useChat({ transport });

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || chat.status === "submitted" || chat.status === "streaming") return;
    setInputValue("");
    chat.sendMessage({ text });
  }

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  if (!isOpen) return null;

  const enabledSetting = settings.find((s) => s.enabled === 1);
  const isStreaming = chat.status === "submitted" || chat.status === "streaming";

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/40 bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">AI 监控助手</h2>
          {enabledSetting && (
            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400">
              {enabledSetting.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="配置"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          activeId={activeSettingId}
          onActiveChange={setActiveSettingId}
          onRefresh={fetchSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {chat.messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">AI 监控助手</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              我可以帮你管理监控配置，例如查看列表、启停、查看统计数据等。
            </p>
            {!enabledSetting && (
              <p className="mt-3 rounded-lg bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                请先在右上角配置一个聊天 LLM
              </p>
            )}
          </div>
        )}

        <div className="space-y-4">
          {chat.messages.map((message: UIMessage) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {isStreaming && chat.messages.length > 0 && chat.messages[chat.messages.length - 1]?.role === "user" && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="rounded-2xl bg-muted px-4 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {chat.error && (
            <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {chat.error.message || "发生错误，请重试"}
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-border/40 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={enabledSetting ? "输入消息..." : "请先配置 LLM"}
            disabled={!enabledSetting || isStreaming}
            className="flex-1 rounded-xl border border-border/60 bg-background/50 px-4 py-2.5 text-sm focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => chat.stop()}
              className="flex items-center justify-center rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80"
              title="停止"
            >
              <StopCircle className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputValue.trim() || !enabledSetting}
              className={cn(
                "flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ========== 消息气泡 ==========

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  const textParts = message.parts.filter((p) => p.type === "text");
  const textContent = textParts.map((p) => (p.type === "text" ? p.text : "")).join("");

  // v7: tool parts have type `tool-{toolName}`, properties directly on the part
  const toolParts = message.parts.filter(
    (p) => p.type.startsWith("tool-") && p.type !== "tool-invocation"
  );

  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {!isUser && textContent && (
          <div className="prose prose-sm max-w-none dark:prose-invert [&_table]:text-xs">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
          </div>
        )}
        {isUser && <p className="whitespace-pre-wrap">{textContent}</p>}
        {toolParts.length > 0 && !isUser && (
          <div className="mt-2 space-y-1">
            {toolParts.map((p) => {
              const toolName = p.type.replace(/^tool-/, "");
              const callId = (p as Record<string, unknown>).toolCallId as string;
              const state = (p as Record<string, unknown>).state as string;
              return (
                <div key={callId} className="rounded-lg bg-foreground/5 px-3 py-1.5 text-xs">
                  <span className="font-mono text-muted-foreground">{toolName}</span>
                  {(state === "output-available" || state === "output-error") && (
                    <span className="ml-2 text-green-600 dark:text-green-400">✓ 完成</span>
                  )}
                  {(state === "input-streaming" || state === "input-available") && (
                    <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                      <Loader2 className="inline h-3 w-3 animate-spin" /> 执行中
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ========== 配置管理面板 ==========

interface SettingsPanelProps {
  settings: ChatSetting[];
  activeId: number | null;
  onActiveChange: (id: number | null) => void;
  onRefresh: () => void;
  onClose: () => void;
}

function SettingsPanel({ settings, activeId, onActiveChange, onRefresh, onClose }: SettingsPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    provider: "openai",
    api_key: "",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  });

  function openCreate() {
    setEditingId(null);
    setForm({ name: "", provider: "openai", api_key: "", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    setShowForm(true);
  }

  function openEdit(s: ChatSetting) {
    setEditingId(s.id);
    setForm({ name: s.name, provider: s.provider, api_key: "", base_url: s.base_url, model: s.model });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editingId) {
        await fetch(`/api/chat-settings/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, api_key: form.api_key || undefined }),
        });
      } else {
        await fetch("/api/chat-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      onRefresh();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("确定要删除这个聊天配置吗？")) return;
    await fetch(`/api/chat-settings/${id}`, { method: "DELETE" });
    if (activeId === id) onActiveChange(null);
    onRefresh();
  }

  async function handleEnable(id: number) {
    for (const s of settings) {
      if (s.id !== id && s.enabled) {
        await fetch(`/api/chat-settings/${s.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        });
      }
    }
    await fetch(`/api/chat-settings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    onActiveChange(id);
    onRefresh();
  }

  if (showForm) {
    return (
      <div className="border-b border-border/40 p-4">
        <h3 className="mb-3 text-sm font-semibold">{editingId ? "编辑 LLM 配置" : "添加 LLM 配置"}</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="名称"
            className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
            required
          />
          <select
            value={form.provider}
            onChange={(e) => {
              const provider = e.target.value;
              let base_url = form.base_url;
              if (provider === "openai") base_url = "https://api.openai.com/v1";
              else if (provider === "anthropic") base_url = "";
              else if (provider === "google") base_url = "";
              setForm((f) => ({ ...f, provider, base_url }));
            }}
            className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google Gemini</option>
          </select>
          <input
            type="url"
            value={form.base_url}
            onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
            placeholder="Base URL"
            className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none"
            required
          />
          <input
            type="text"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="模型名称"
            className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none"
            required
          />
          <input
            type="password"
            value={form.api_key}
            onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
            placeholder={editingId ? "API Key (留空不修改)" : "API Key"}
            className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm font-mono focus:border-primary/50 focus:outline-none"
            required={!editingId}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-border/60 py-2 text-sm">
              取消
            </button>
            <button type="submit" className="flex-1 rounded-lg bg-primary py-2 text-sm text-primary-foreground">
              保存
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="border-b border-border/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">LLM 配置</h3>
        <div className="flex gap-1">
          <button type="button" onClick={openCreate} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="添加">
            <Plus className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {settings.length === 0 && <p className="text-xs text-muted-foreground">暂无配置，点击 + 添加</p>}
      <div className="space-y-2">
        {settings.map((s) => (
          <div key={s.id} className={cn("flex items-center justify-between rounded-lg border p-2 text-xs", s.enabled ? "border-primary/40 bg-primary/5" : "border-border/40")}>
            <button type="button" onClick={() => handleEnable(s.id)} className="flex flex-1 items-center gap-2 text-left">
              <span className={cn("h-2 w-2 rounded-full", s.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">{s.model}</span>
            </button>
            <div className="flex gap-0.5">
              <button type="button" onClick={() => openEdit(s)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => handleDelete(s.id)} className="rounded p-1 text-muted-foreground hover:text-red-500">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
