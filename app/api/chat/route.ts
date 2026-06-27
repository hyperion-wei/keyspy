import { initDb, getEnabledChatSetting } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { streamText, isStepCount, toUIMessageStream, createUIMessageStreamResponse, convertToModelMessages } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { agentTools } from "@/lib/agent/tools";

initDb();

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 最长执行时间

const SYSTEM_PROMPT = `你是一个专业的监控管理助手，负责帮助用户管理 API 监控配置。

你可以执行以下操作：
- 列出所有监控配置
- 查看单个监控配置的详细信息
- 启用或停用监控配置
- 删除监控配置（请谨慎使用，删除前务必确认）
- 查看监控配置的可用性统计数据
- 查看所有监控的概览统计

回复要求：
- 使用中文回复
- 执行操作前先告知用户你将要做什么
- 执行操作后清晰展示结果
- 对于删除操作，先列出要删除的配置名称，等用户确认后再执行
- 数据以表格或列表形式清晰展示`;

/**
 * POST /api/chat - AI Agent 对话接口
 *
 * 请求体：
 * {
 *   messages: [{ role: "user" | "assistant", content: string }],
 *   chatSettingId?: number  // 可选，指定使用哪个聊天配置
 * }
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "未授权" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { messages, chatSettingId } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "消息不能为空" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 获取聊天配置
  let chatSetting;
  if (chatSettingId) {
    const { getChatSettingById } = await import("@/lib/db");
    chatSetting = getChatSettingById(chatSettingId);
  } else {
    chatSetting = getEnabledChatSetting();
  }

  if (!chatSetting) {
    return new Response(
      JSON.stringify({
        error: "未配置聊天 LLM",
        hint: "请先在管理页面添加一个聊天 LLM 配置",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 修正 base_url：用户可能填入完整的 /chat/completions URL，需去掉后缀
  let baseUrl = chatSetting.base_url?.trim() || undefined;
  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/\/$/, "");
  }

  // 创建对应的 AI provider
  let model;
  try {
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
        // 使用 .chat() 强制使用 Chat Completions API，兼容 OpenAI 兼容的第三方 API
        model = openai.chat(chatSetting.model);
        break;
      }
    }
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: `创建 AI 模型失败: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 转换 UIMessage (前端 useChat 发送) -> ModelMessage (streamText 所需)
  const modelMessages = await convertToModelMessages(messages, { tools: agentTools });

  // 使用 streamText + tools 实现 agent 循环
  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    tools: agentTools,
    stopWhen: [isStepCount(10)], // agent 自动循环最多 10 步
  });

  // v7 API: streamText -> toUIMessageStream -> createUIMessageStreamResponse
  const uiStream = toUIMessageStream({
    stream: result.stream,
    tools: agentTools,
  });

  return createUIMessageStreamResponse({
    stream: uiStream,
  });
}
