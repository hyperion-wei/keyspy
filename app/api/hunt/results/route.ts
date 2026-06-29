import {
  initDb,
  getAllHuntFindings,
  getHuntFindingsCount,
  updateHuntFindingMonitorStatus,
  updateHuntFinding,
  deleteHuntFinding,
  createMonitorConfig,
  findMonitorConfigsByKey,
  getAllTemplates,
  type MonitorTemplateParsed,
  HuntFinding,
} from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

initDb();

export const dynamic = "force-dynamic";

/**
 * 已知 LLM 提供商的域名 → 正确的 chat completions 路径映射
 */
const KNOWN_DOMAINS: Record<string, string> = {
  "api.openai.com": "/v1/chat/completions",
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
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/chat/completions') || 
      trimmed.endsWith('/chat/completions') ||
      trimmed.endsWith('/messages')) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    const knownPath = KNOWN_DOMAINS[u.hostname];
    if (knownPath) return u.origin + knownPath;
  } catch { /* ignore */ }
  if (trimmed.endsWith('/v1')) return trimmed + '/chat/completions';
  return trimmed + '/v1/chat/completions';
}

/**
 * 后端去重：相同 key_value 的 api_key finding 合并
 * 保留信息最完整的一条，合并 source_urls
 * 同时处理旧数据中 key 尾部包含垃圾的情况（用前缀匹配）
 */
function deduplicateFindings(findings: HuntFinding[]): HuntFinding[] {
  const result: HuntFinding[] = [];

  // 清理 key：截断到第一个空白或引号
  function cleanKey(kv: string | null | undefined): string {
    if (!kv) return '';
    let k = kv.replace(/[\u201C\u201D\u201E\u2018\u2019\u201A\uFF02\uFF07]/g, '').trim();
    const wsIdx = k.search(/[\s\n\r\t'"]/);
    if (wsIdx > 0) k = k.slice(0, wsIdx);
    return k;
  }

  // 构建 key 到 finding 的映射
  const keyMap = new Map<string, { finding: HuntFinding; idx: number }>();

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const isApiKey = f.finding_type === 'api_key' || f.finding_type === 'bearer_token' || f.finding_type === 'auth_header';
    const rawKey = cleanKey(f.key_value);

    if (!isApiKey || !rawKey || rawKey.length < 10) {
      result.push(f);
      continue;
    }

    // 检查是否有已存在的 key（完全匹配或前缀匹配）
    let matched = false;
    for (const [existingKey, existing] of keyMap) {
      // 完全匹配或其中一个包含另一个
      if (existingKey === rawKey || existingKey.startsWith(rawKey) || rawKey.startsWith(existingKey)) {
        const ef = existing.finding;
        // 合并 source_urls
        try {
          const existingUrls = JSON.parse(ef.source_urls || '[]');
          const newUrls = JSON.parse(f.source_urls || '[]');
          if (f.target_url && !existingUrls.includes(f.target_url)) existingUrls.push(f.target_url);
          for (const u of newUrls) {
            if (!existingUrls.includes(u)) existingUrls.push(u);
          }
          ef.source_urls = JSON.stringify(existingUrls);
        } catch { /* ignore */ }

        // 合并 added_to_monitor
        if (f.added_to_monitor) ef.added_to_monitor = 1;

        // 用信息更完整的覆盖
        if ((f.analysis?.length || 0) > (ef.analysis?.length || 0)) ef.analysis = f.analysis;
        if (f.base_url && !ef.base_url) ef.base_url = f.base_url;
        if (f.model && !ef.model) ef.model = f.model;
        if (f.provider !== 'unknown' && ef.provider === 'unknown') ef.provider = f.provider;
        // 用更干净的 key
        if (rawKey.length < (existingKey?.length || 0) && rawKey.length > 10) {
          ef.key_value = rawKey;
          keyMap.delete(existingKey);
          keyMap.set(rawKey, existing);
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      const idx = result.push(f) - 1;
      keyMap.set(rawKey, { finding: f, idx });
    }
  }

  return result;
}

/**
 * GET /api/hunt/results
 * 获取扫描结果列表
 */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 100);
  const offset = Number(searchParams.get("offset") || 0);
  const taskId = searchParams.get("taskId");

  if (taskId) {
    const { getHuntFindingsByTaskId } = await import("@/lib/db");
    const findings = getHuntFindingsByTaskId(Number(taskId));
    const deduped = deduplicateFindings(findings);
    return Response.json({ findings: deduped, total: deduped.length });
  }

  const findings = getAllHuntFindings(limit, offset);
  const deduped = deduplicateFindings(findings);
  const total = deduped.length;

  return Response.json({ findings: deduped, total });
}

/**
 * provider 关键词 → 模板名称的映射（用于自动匹配模板）
 */
const PROVIDER_TO_TEMPLATE: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  claude: "Anthropic",
  google: "Gemini",
  gemini: "Gemini",
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  moonshot: "Kimi",
  zhipu: "智谱",
  glm: "智谱",
  dashscope: "阿里百炼",
  qwen: "阿里百炼",
  alibaba: "阿里百炼",
  hunyuan: "腾讯混元",
  tencent: "腾讯混元",
  doubao: "豆包",
  bytedance: "豆包",
  volcengine: "豆包",
  siliconflow: "硅基流动",
};

/**
 * 按 provider 查找匹配的内置模板
 */
function matchTemplate(provider: string | null): MonitorTemplateParsed | null {
  if (!provider || provider === "unknown") return null;
  const templates = getAllTemplates();
  const tplName = PROVIDER_TO_TEMPLATE[provider.toLowerCase()];
  if (tplName) {
    return templates.find((t) => t.name === tplName && t.built_in) || null;
  }
  // 模糊匹配：模板名包含 provider 或 provider 包含模板名
  return templates.find((t) => {
    const n = t.name.toLowerCase();
    const p = provider.toLowerCase();
    return t.built_in && (n.includes(p) || p.includes(n));
  }) || null;
}

/**
 * POST /api/hunt/results
 * 将发现添加到监控配置
 * - 检查 key 是否已存在于监控中（去重）
 * - 按 provider 匹配内置模板，优先使用模板设置
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { findingId, name, type, base_url, api_key, model, group_name, force } = body;

  if (!findingId || !name || !api_key || !model) {
    return Response.json({ error: "缺少必要参数" }, { status: 400 });
  }

  // 1. 去重检查：该 key 是否已在监控配置中
  const existing = findMonitorConfigsByKey(api_key);
  if (existing.length > 0 && !force) {
    return Response.json({
      success: false,
      duplicate: true,
      existingConfigs: existing.map((c) => ({ id: c.id, name: c.name, model: c.model, group_name: c.group_name })),
      message: `该 Key 已存在于监控配置「${existing.map((c) => c.name).join("、")}」中`,
    });
  }

  // 2. 匹配内置模板
  const tpl = matchTemplate(body.provider);

  // 3. 优先使用模板设置
  const finalType = tpl?.type || type || "openai";
  const finalBaseUrl = tpl ? tpl.base_url : normalizeBaseUrl(base_url || "");
  const finalModel = tpl ? tpl.default_model : model;
  const fallbackModels = tpl ? JSON.stringify(tpl.models.filter((m) => m !== tpl.default_model)) : "[]";

  try {
    createMonitorConfig({
      name,
      type: finalType,
      base_url: finalBaseUrl,
      api_key,
      model: finalModel,
      group_name: group_name || "Hunt 发现",
      enabled: 1,
      template_id: tpl?.id ?? null,
      fallback_models: fallbackModels,
    });

    updateHuntFindingMonitorStatus(findingId, true);

    return Response.json({
      success: true,
      message: tpl
        ? `已添加到监控配置（使用 ${tpl.name} 模板）`
        : "已添加到监控配置",
      templateUsed: tpl ? { name: tpl.name, base_url: tpl.base_url, model: tpl.default_model } : null,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "添加失败" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/hunt/results
 * 编辑 finding 字段（provider, model, base_url, key_value, finding_type）
 */
export async function PUT(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }

  try {
    updateHuntFinding(Number(id), updates);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "更新失败" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/hunt/results
 * 删除 finding 或从监控中移除
 */
export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const findingId = searchParams.get("id");
  const action = searchParams.get("action"); // "remove_monitor" 或 "delete"

  if (!findingId) {
    return Response.json({ error: "缺少 id" }, { status: 400 });
  }

  if (action === "delete") {
    const ok = deleteHuntFinding(Number(findingId));
    return Response.json({ success: ok });
  }

  // 默认：从监控中移除
  updateHuntFindingMonitorStatus(Number(findingId), false);
  return Response.json({ success: true });
}
