import { generateText } from "ai";
import { initDb, getAllChatSettings, getChatSettingById, type ChatSetting } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM_PROMPT = `你是一个专业的文本解析助手。你的任务是从用户提供的混乱文本中提取有效的 HTTP/HTTPS URL 目标。

规则：
1. 从文本中识别所有可能的 HTTP/HTTPS 服务端点
2. 每个目标需要提取：host（IP或域名）、port（端口号）、protocol（http或https）
3. 如果无法确定协议，默认使用 http
4. 如果无法确定端口，http 默认 80，https 默认 443
5. 忽略明显不是 URL/目标的数据（如纯文字描述、注释等）
6. 去重：相同的目标只保留一个

你必须只输出纯 JSON，格式如下，不要包含任何其他文字：
{"targets":[{"host":"1.2.3.4","port":8080,"protocol":"http"}]}`;

/**
 * POST /api/hunt/parse
 * 使用 AI 从混乱文本中智能提取 URL 目标
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { text, chatSettingId } = body;

  if (!text || typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "请提供要解析的文本" }, { status: 400 });
  }

  // 获取要尝试的聊天配置列表
  let settingsToTry: ChatSetting[] = [];
  if (chatSettingId) {
    const specific = getChatSettingById(chatSettingId);
    if (specific) settingsToTry = [specific];
  } else {
    // 获取所有启用的配置，按 ID 排序逐个尝试
    settingsToTry = getAllChatSettings().filter((s) => s.enabled === 1);
  }

  if (settingsToTry.length === 0) {
    return Response.json(
      {
        error: "未配置聊天 LLM",
        hint: "请先在管理页面添加一个聊天 LLM 配置",
      },
      { status: 400 }
    );
  }

  // 逐个尝试，自动 fallback
  const errors: string[] = [];
  for (const chatSetting of settingsToTry) {
    try {
      const result = await tryParse(text, chatSetting);
      return Response.json({
        success: true,
        usedModel: `${chatSetting.name} (${chatSetting.model})`,
        targets: result,
        total: result.length,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${chatSetting.name}: ${errMsg}`);
      console.warn(`[hunt/parse] ${chatSetting.name} 失败，尝试下一个: ${errMsg}`);
    }
  }

  // 全部失败
  return Response.json(
    {
      error: `所有 LLM 配置均不可用`,
      details: errors,
      hint: "请检查聊天 LLM 配置的 API Key 和余额",
    },
    { status: 500 }
  );
}

/**
 * 使用指定 chatSetting 尝试解析文本
 */
async function tryParse(text: string, chatSetting: ChatSetting) {
  // 修正 base_url
  let baseUrl = chatSetting.base_url?.trim() || undefined;
  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/\/$/, "");
  }

  // 创建 AI model
  let model;
  switch (chatSetting.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: chatSetting.api_key,
        baseURL: baseUrl,
      });
      model = anthropic(chatSetting.model);
      break;
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: chatSetting.api_key,
        baseURL: baseUrl,
      });
      model = google(chatSetting.model);
      break;
    }
    case "openai":
    default: {
      const openai = createOpenAI({
        apiKey: chatSetting.api_key,
        baseURL: baseUrl,
      });
      model = openai.chat(chatSetting.model);
      break;
    }
  }

  // 调用 AI 解析（使用 generateText 兼容所有模型）
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: `请从以下文本中提取所有有效的 HTTP/HTTPS 目标，只输出纯 JSON：\n\n${text}`,
    temperature: 0.1,
  });

  // 从响应中提取 JSON
  const raw = result.text.trim();
  let parsed: { targets?: Array<{ host: string; port: number | string; protocol: string }> };

  // 尝试直接解析
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 尝试提取 JSON 块（模型可能输出了 markdown 代码块）
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/\{[\s\S]*"targets"[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("无法从 AI 响应中解析 JSON");
    }
    const jsonStr = jsonMatch[1]?.trim() || jsonMatch[0];
    parsed = JSON.parse(jsonStr);
  }

  if (!parsed.targets || !Array.isArray(parsed.targets)) {
    throw new Error("AI 响应格式不正确，缺少 targets 数组");
  }

  // 去重 + 标准化
  const seen = new Set<string>();
  return parsed.targets
    .filter((t) => t.host && t.port)
    .map((t) => ({
      host: t.host,
      port: Number(t.port),
      protocol: t.protocol === "https" ? "https" : "http",
    }))
    .filter((t) => {
      const key = `${t.protocol}://${t.host}:${t.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t, i) => ({
      id: `ai-${i}-${Date.now()}`,
      host: t.host,
      port: String(t.port),
      protocol: t.protocol,
      url: `${t.protocol}://${t.host}:${t.port}`,
      scanned: false,
    }));
}
