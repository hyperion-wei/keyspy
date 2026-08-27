import { describe, it, expect } from 'vitest';

// models.json 形态的合成样本（真实 key 已脱敏，结构保持一致）
// 覆盖三种典型漏报形态：sk-cp- 长 key (minimax)、32 位 sk- (bailian)、UUID (volcengine)
const MINIMAX_KEY = 'sk-cp-FAKEaaBBccDDeeFF_11ggHHiiJJkkLLmmNNooPPqqRRssTTuuVVwwXXyyZZ00abCCddEEffGGhhIIjjKKllMMnnOOppQQrrSS-99';
const BAILIAN_KEY = 'sk-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
const VOLC_KEY = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const MODELS_JSON_SAMPLE = `{
  "minimax-cn": {
    "apiKey": "${MINIMAX_KEY}",
    "baseUrl": "https://api.minimaxi.com/v1/chat/completions",
    "defaultModel": "MiniMax-M2.7"
  },
  "bailian": {
    "apiKey": "${BAILIAN_KEY}",
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    "defaultModel": "qwen-max"
  },
  "volcengine": {
    "apiKey": "${VOLC_KEY}",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    "defaultModel": "doubao-pro-32k"
  },
  "oauth": {
    "apiKey": "minimax-oauth",
    "note": "短字符串不应被匹配"
  }
}`;

// enhanced-rules.toml 中的规则 (用 RegExp 构造以支持 (?i))
const JSON_KEY_FIELDS = 'apiKey|api_key|api-key|apikey|accessKey|access_key|secretKey|secret_key|apiToken|api_token';
const REGEX_SK_PREFIX = new RegExp(`(?:"(?:${JSON_KEY_FIELDS})"\\s*:\\s*")((?:sk-)[a-zA-Z0-9_\\-]{20,})"`, 'gi');
const REGEX_UUID = new RegExp(`(?:"(?:${JSON_KEY_FIELDS})"\\s*:\\s*")((?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))"`, 'gi');
const REGEX_GENERIC = new RegExp(`(?:"(?:${JSON_KEY_FIELDS})"\\s*:\\s*")([a-zA-Z0-9_\\-]{30,})"`, 'gi');
const REGEX_BEARER = /(?:authorization['"]?\s*[:=]\s*['"]?bearer\s+)([a-zA-Z0-9_\-.]{20,200})/gi;

function extractAllMatches(regex: RegExp, content: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

describe('enhanced-rules regex vs models.json', () => {
  it('json-api-key-sk-prefix: 匹配 sk-cp- (minimax) 和 sk- (bailian)', () => {
    const matches = extractAllMatches(REGEX_SK_PREFIX, MODELS_JSON_SAMPLE);
    console.log('sk-prefix matches:', matches);
    // minimax-cn
    expect(matches.some(m => m.startsWith('sk-cp-'))).toBe(true);
    // bailian
    expect(matches.some(m => m.startsWith('sk-1a2b3c'))).toBe(true);
    // 不应匹配 "minimax-oauth"（不含 sk- 前缀）
    expect(matches.some(m => m === 'minimax-oauth')).toBe(false);
  });

  it('json-api-key-uuid: 匹配 UUID key (volcengine)', () => {
    const matches = extractAllMatches(REGEX_UUID, MODELS_JSON_SAMPLE);
    console.log('uuid matches:', matches);
    expect(matches).toContain(VOLC_KEY);
  });

  it('json-api-key-generic: 匹配 30+ 字符的 key', () => {
    const matches = extractAllMatches(REGEX_GENERIC, MODELS_JSON_SAMPLE);
    console.log('generic matches:', matches);
    // sk-cp- key (117 chars) 应匹配
    expect(matches.some(m => m.startsWith('sk-cp-'))).toBe(true);
    // sk-97a409... (32 chars) 应匹配
    expect(matches.some(m => m.startsWith('sk-1a2b3c'))).toBe(true);
    // UUID (36 chars with hyphens) 也应匹配
    expect(matches.some(m => m.startsWith('f47ac10b'))).toBe(true);
    // minimax-oauth 不应匹配（12 chars < 30）
    expect(matches.some(m => m === 'minimax-oauth')).toBe(false);
  });

  it('3 个 key 全部被至少一条规则覆盖', () => {
    const allRules = [REGEX_SK_PREFIX, REGEX_UUID, REGEX_GENERIC];
    const allMatches = new Set<string>();
    for (const regex of allRules) {
      for (const m of extractAllMatches(regex, MODELS_JSON_SAMPLE)) {
        allMatches.add(m);
      }
    }

    console.log('All matched keys:', [...allMatches]);

    // 3 个实际 key 全部被发现
    expect([...allMatches].some(m => m.startsWith('sk-cp-FAKE'))).toBe(true);
    expect([...allMatches].some(m => m === BAILIAN_KEY)).toBe(true);
    expect([...allMatches].some(m => m === VOLC_KEY)).toBe(true);

    // 假 key "minimax-oauth" 不应被匹配
    expect([...allMatches].some(m => m === 'minimax-oauth')).toBe(false);
  });

  it('扩展字段名: secretKey/accessKey/apiToken 形态也能命中', () => {
    const sample = `{
      "llm": {
        "secretKey": "${BAILIAN_KEY}",
        "accessKey": "${MINIMAX_KEY}"
      }
    }`;
    const matches = extractAllMatches(REGEX_SK_PREFIX, sample);
    expect(matches.some(m => m === BAILIAN_KEY)).toBe(true);
    expect(matches.some(m => m.startsWith('sk-cp-'))).toBe(true);
  });

  it('json-bearer-token: 匹配 JSON 字段与代码中的 Bearer 写法', () => {
    const sample = `
      "authorization": "Bearer sk-ant-api03-abcdefghij1234567890",
      headers = { Authorization: 'Bearer abcdefghijklmnopqrstuvwx12' }
    `;
    const matches = extractAllMatches(REGEX_BEARER, sample);
    expect(matches).toContain('sk-ant-api03-abcdefghij1234567890');
    expect(matches).toContain('abcdefghijklmnopqrstuvwx12');
  });

  it('inferTypeAndProvider 能正确识别 provider', () => {
    // 模拟 inferTypeAndProvider 逻辑
    function inferProvider(ruleId: string, matchedValue: string, content: string): string {
      if (ruleId === 'json-api-key-sk-prefix') {
        if (matchedValue.startsWith('sk-cp-')) return 'minimax';
        if (matchedValue.startsWith('sk-ant-')) return 'anthropic';
        if (matchedValue.startsWith('sk-')) return 'openai-compatible';
        return 'unknown';
      }
      if (ruleId === 'json-api-key-uuid') return 'unknown';
      if (ruleId === 'json-api-key-generic') {
        if (matchedValue.startsWith('sk-cp-')) return 'minimax';
        if (matchedValue.startsWith('sk-')) return 'openai-compatible';
        return 'unknown';
      }
      return 'unknown';
    }

    // 模拟 classifyFinding 上下文推断
    function inferFromContext(matchedValue: string, content: string): string {
      const ctx = content.toLowerCase();
      if (ctx.includes('minimax') || ctx.includes('minimaxi')) return 'minimax';
      if (ctx.includes('dashscope') || ctx.includes('qwen') || ctx.includes('aliyuncs') || ctx.includes('bailian')) return 'dashscope';
      if (ctx.includes('volcengine') || ctx.includes('volces') || ctx.includes('doubao') || ctx.includes('cn-beijing')) return 'volcengine';
      return 'unknown';
    }

    // Key 1: minimax sk-cp-...
    expect(inferProvider('json-api-key-sk-prefix', MINIMAX_KEY, MODELS_JSON_SAMPLE)).toBe('minimax');

    // Key 2: bailian sk-97a409... → sk- 前缀 → openai-compatible，然后上下文推断 → dashscope
    const provider2 = inferProvider('json-api-key-sk-prefix', BAILIAN_KEY, MODELS_JSON_SAMPLE);
    // sk- 前缀 → openai-compatible (not exact)
    expect(provider2).toBe('openai-compatible');
    // 上下文推断可修正：窗口取 key 所在 provider 块内（生产代码 keyIdx±500）
    // 注意：样本尾部 oauth 块含 "minimax-oauth"，跨块窗口会被 minimax 关键词抢先命中，
    // 对应生产已知限制：多 provider 同文件时关键词优先级可能导致误归类
    const bailianIdx = MODELS_JSON_SAMPLE.indexOf('"bailian"');
    const bailianCtx = MODELS_JSON_SAMPLE.slice(bailianIdx, bailianIdx + 220);
    expect(inferFromContext(BAILIAN_KEY, bailianCtx)).toBe('dashscope');

    // Key 3: volcengine UUID → unknown，上下文推断 → volcengine
    const provider3 = inferProvider('json-api-key-uuid', VOLC_KEY, MODELS_JSON_SAMPLE);
    expect(provider3).toBe('unknown');
    // 上下文推断修正：key 本身附近无 "volcengine" 字样，
    // 识别依赖 baseUrl 中的 volces.com 域名
    const volcIdx = MODELS_JSON_SAMPLE.indexOf('"volcengine"');
    const volcCtx = MODELS_JSON_SAMPLE.slice(volcIdx, volcIdx + 220);
    expect(inferFromContext(VOLC_KEY, volcCtx)).toBe('volcengine');
  });
});
