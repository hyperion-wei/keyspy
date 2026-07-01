import { describe, it, expect } from 'vitest';

// 从 models.json 提取的实际 apiKey 行
const MODELS_JSON_SAMPLE = `{
  
  
}`;

// enhanced-rules.toml 中的 3 条新规则 (用 RegExp 构造以支持 (?i))
const REGEX_SK_PREFIX = new RegExp('(?:"(?:apiKey|api_key|api-key)"\\s*:\\s*")((?:sk-)[a-zA-Z0-9_\\-]{20,})"', 'gi');
const REGEX_UUID = new RegExp('(?:"(?:apiKey|api_key|api-key)"\\s*:\\s*")((?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))"', 'gi');
const REGEX_GENERIC = new RegExp('(?:"(?:apiKey|api_key|api-key)"\\s*:\\s*")([a-zA-Z0-9_\\-]{30,})"', 'gi');

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
    expect(matches.some(m => m.startsWith('sk-97a409'))).toBe(true);
    // 不应匹配 "minimax-oauth"（不含 sk- 前缀）
    expect(matches.some(m => m === 'minimax-oauth')).toBe(false);
  });

  it('json-api-key-uuid: 匹配 UUID key (volcengine)', () => {
    const matches = extractAllMatches(REGEX_UUID, MODELS_JSON_SAMPLE);
    console.log('uuid matches:', matches);
    expect(matches).toContain('4f16d1b5-d473-44b6-9ca3-175f2e8300f5');
  });

  it('json-api-key-generic: 匹配 30+ 字符的 key', () => {
    const matches = extractAllMatches(REGEX_GENERIC, MODELS_JSON_SAMPLE);
    console.log('generic matches:', matches);
    // sk-cp- key (117 chars) 应匹配
    expect(matches.some(m => m.startsWith('sk-cp-'))).toBe(true);
    // sk-97a409... (32 chars) 应匹配
    expect(matches.some(m => m.startsWith('sk-97a409'))).toBe(true);
    // UUID (36 chars with hyphens) 也应匹配
    expect(matches.some(m => m.startsWith('4f16d1b5'))).toBe(true);
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
    expect([...allMatches].some(m => m.startsWith('sk-cp-9aRHj'))).toBe(true);
    expect([...allMatches].some(m => m === 'sk-97a409d2b9944237b4367e54f45ee257')).toBe(true);
    expect([...allMatches].some(m => m === '4f16d1b5-d473-44b6-9ca3-175f2e8300f5')).toBe(true);

    // 假 key "minimax-oauth" 不应被匹配
    expect([...allMatches].some(m => m === 'minimax-oauth')).toBe(false);
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
    const minimaxKey = 'sk-cp-9aRHj5VkZwFT_3abZjyekBLxL6Efh4lCLLCnyHYBvf2k7G0HZOHKR2QJaAKIrD0jNmT7LFrFoommVm0yEwO1CaLb2b0aoq3-Kx-eky9NCaZ-L1ppr3Xw-2s';
    expect(inferProvider('json-api-key-sk-prefix', minimaxKey, MODELS_JSON_SAMPLE)).toBe('minimax');

    // Key 2: bailian sk-97a409... → sk- 前缀 → openai-compatible，然后上下文推断 → dashscope
    const bailianKey = 'sk-97a409d2b9944237b4367e54f45ee257';
    const provider2 = inferProvider('json-api-key-sk-prefix', bailianKey, MODELS_JSON_SAMPLE);
    // sk- 前缀 → openai-compatible (not exact)
    expect(provider2).toBe('openai-compatible');
    // 上下文推断可修正
    const bailianCtx = MODELS_JSON_SAMPLE.slice(
      MODELS_JSON_SAMPLE.indexOf('"bailian"'),
      MODELS_JSON_SAMPLE.indexOf('"bailian"') + 500
    );
    expect(inferFromContext(bailianKey, bailianCtx)).toBe('dashscope');

    // Key 3: volcengine UUID → unknown，上下文推断 → volcengine
    const volcKey = '4f16d1b5-d473-44b6-9ca3-175f2e8300f5';
    const provider3 = inferProvider('json-api-key-uuid', volcKey, MODELS_JSON_SAMPLE);
    expect(provider3).toBe('unknown');
    // 上下文推断修正
    const volcCtx = MODELS_JSON_SAMPLE.slice(
      MODELS_JSON_SAMPLE.indexOf('"volcengine"'),
      MODELS_JSON_SAMPLE.indexOf('"volcengine"') + 500
    );
    expect(inferFromContext(volcKey, volcCtx)).toBe('volcengine');
  });
});
