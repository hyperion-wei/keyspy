import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchModelList, isNoiseModel } from './model-list';

// 构造一个最小可用的 fetch Response mock
function mockFetchOk(body: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

function mockFetchError(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNoiseModel', () => {
  it('应过滤 embedding/音频/图像类模型', () => {
    expect(isNoiseModel('text-embedding-3-small')).toBe(true);
    expect(isNoiseModel('whisper-1')).toBe(true);
    expect(isNoiseModel('tts-1-hd')).toBe(true);
    expect(isNoiseModel('dall-e-3')).toBe(true);
    expect(isNoiseModel('bge-reranker-v2-m3')).toBe(true);
    expect(isNoiseModel('omni-moderation-latest')).toBe(true);
  });

  it('不应误杀对话模型', () => {
    expect(isNoiseModel('gpt-5.5')).toBe(false);
    expect(isNoiseModel('deepseek-chat')).toBe(false);
    expect(isNoiseModel('gemini-2.5-flash')).toBe(false);
    expect(isNoiseModel('claude-sonnet-4-6-20260414')).toBe(false);
    expect(isNoiseModel('Qwen/Qwen3-32B')).toBe(false);
  });
});

describe('fetchModelList', () => {
  describe('OpenAI 兼容', () => {
    it('应从 chat/completions 形态的 base_url 构造 /v1/models 并解析 data[].id', async () => {
      mockFetchOk({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-5.4-mini' }, { id: 'text-embedding-3-small' }] });

      const result = await fetchModelList('openai', 'https://api.openai.com/v1/chat/completions', 'sk-test');

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/models');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');

      expect(result.ok).toBe(true);
      // embedding 噪声模型被过滤
      expect(result.models).toEqual(['gpt-5.5', 'gpt-5.4-mini']);
    });

    it('应以 /v1 结尾的 base_url 直接追加 /models', async () => {
      mockFetchOk({ data: [{ id: 'deepseek-chat' }] });

      await fetchModelList('openai', 'https://api.deepseek.com/v1', 'sk-test');

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/models');
    });

    it('应兼容自定义网关无 /v1 前缀的情况', async () => {
      mockFetchOk({ data: [{ id: 'model-a' }] });

      await fetchModelList('openai', 'https://gateway.example.com/api', 'sk-test');

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock.mock.calls[0][0]).toBe('https://gateway.example.com/api/v1/models');
    });
  });

  describe('Anthropic', () => {
    it('应剥掉 /v1/messages 后拼 /v1/models 并使用 x-api-key 鉴权', async () => {
      mockFetchOk({ data: [{ id: 'claude-sonnet-4-6-20260414' }] });

      const result = await fetchModelList('anthropic', 'https://api.anthropic.com/v1/messages', 'sk-ant-test');

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/models');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
      expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
      expect(result.models).toEqual(['claude-sonnet-4-6-20260414']);
    });
  });

  describe('Gemini', () => {
    it('应使用 /v1beta/models?key= 并去掉 models/ 前缀', async () => {
      mockFetchOk({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-embedding-001' }] });

      const result = await fetchModelList('gemini', 'https://generativelanguage.googleapis.com', 'AIza-test');

      const fetchMock = vi.mocked(fetch);
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.pathname).toBe('/v1beta/models');
      expect(url.searchParams.get('key')).toBe('AIza-test');
      // embedding 被过滤，前缀被剥离
      expect(result.models).toEqual(['gemini-2.5-flash']);
    });
  });

  describe('错误处理', () => {
    it('HTTP 错误时应返回 ok=false 与错误信息', async () => {
      mockFetchError(401, { error: { message: 'Invalid API key' } });

      const result = await fetchModelList('openai', 'https://api.openai.com/v1', 'sk-bad');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('过滤后为空时应返回 ok=false', async () => {
      mockFetchOk({ data: [{ id: 'text-embedding-3-small' }, { id: 'whisper-1' }] });

      const result = await fetchModelList('openai', 'https://api.openai.com/v1', 'sk-test');

      expect(result.ok).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('应对返回的模型去重', async () => {
      mockFetchOk({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-5.5' }, { id: 'gpt-5.4-mini' }] });

      const result = await fetchModelList('openai', 'https://api.openai.com/v1', 'sk-test');

      expect(result.models).toEqual(['gpt-5.5', 'gpt-5.4-mini']);
    });
  });
});
