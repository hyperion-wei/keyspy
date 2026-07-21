/**
 * 测试误报过滤逻辑
 * 模拟 http://124.221.115.166:8890/config.json 中的各种 key 类型
 */

// 模拟 classifyFinding 中的过滤逻辑
const PLACEHOLDER_PATTERNS = [
  /^(?:sk-|pk-|api-|key-|token-)?test/i,
  /^(?:sk-|pk-|api-|key-|token-)?demo/i,
  /^(?:sk-|pk-|api-|key-|token-)?example/i,
  /^(?:sk-|pk-|api-|key-|token-)?sample/i,
  /^(?:sk-|pk-|api-|key-|token-)?placeholder/i,
  /^(?:sk-|pk-|api-|key-|token-)?dummy/i,
  /^(?:sk-|pk-|api-|key-|token-)?mock/i,
  /^(?:sk-|pk-|api-|key-|token-)?fake/i,
  /your[_-]?(?:api[_-]?)?key/i,
  /your[_-]?token/i,
  /insert[_-]?key/i,
  /replace[_-]?me/i,
  /change[_-]?me/i,
  /xxx{3,}/i,
  /\*{3,}/,
  /^0{10,}$/,
  /^1{10,}$/,
  /^a{10,}$/i,
  /^abc/i,
  /^123/,
];

const NON_LLM_KEY_PATTERNS = [
  // JWT Token
  /^eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/,
  // 企业微信 Webhook
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // Cookie 值（包含 = 和 ; 的键值对格式）
  /^[A-Za-z0-9_]+=[^;]+;\s*[A-Za-z0-9_]+=/,
  // 纯 base64 长字符串（可能是 cookie 或加密数据）
  /^[A-Za-z0-9+/=]{100,}$/,
  // 空值或纯空白
  /^\s*$/,
  // 仅包含常见字符的短字符串
  /^[a-zA-Z0-9]{1,15}$/,
];

const NON_LLM_CONTEXT_KEYWORDS = [
  'webhook', 'cookie', 'session', 'csrf', 'xsrf',
  'ctrip', '携程', 'crm', 'erp', 'oa系统',
  'qyapi.weixin.qq.com', '企业微信',
  'dingtalk', '钉钉', 'feishu', '飞书',
  'password', 'passwd', 'pwd', '密码',
  'username', 'user', '用户名', '账号',
];

function isPlaceholderKey(key) {
  const normalized = key.toLowerCase().trim();
  if (!normalized || normalized.length === 0) return true;
  if (normalized.length < 16) return true;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  if (/^(.)\1{9,}$/.test(normalized)) return true;
  if (/^(?:0123456789|1234567890|9876543210)/.test(normalized)) return true;
  return false;
}

function isNonLLMKey(key) {
  const normalized = key.trim();
  for (const pattern of NON_LLM_KEY_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  return false;
}

function hasNonLLMContext(content, key) {
  const keyIdx = content.indexOf(key);
  if (keyIdx < 0) return false;
  
  const ctxStart = Math.max(0, keyIdx - 200);
  const ctxEnd = Math.min(content.length, keyIdx + key.length + 200);
  const ctx = content.slice(ctxStart, ctxEnd).toLowerCase();
  
  for (const keyword of NON_LLM_CONTEXT_KEYWORDS) {
    if (ctx.includes(keyword.toLowerCase())) return true;
  }
  
  const varNameMatch = ctx.match(/([a-z_]*(?:cookie|session|token|auth)[a-z_]*)\s*[=:]/i);
  if (varNameMatch) {
    const varName = varNameMatch[1].toLowerCase();
    if (!varName.includes('api') && !varName.includes('key') && !varName.includes('llm')) {
      return true;
    }
  }
  
  return false;
}

// 测试用例 - 来自 http://124.221.115.166:8890/config.json
const testCases = [
  // 应该被过滤的误报
  { name: '空 DEEPSEEK_API_KEY', key: '', content: '"DEEPSEEK_API_KEY": ""', expected: false, reason: '空值' },
  { name: 'JWT Token (CRM_TOKEN)', key: 'eyJhbGciOiJIUzUxMiJ9.eyJsb2dpbl91c2VyX2tleSI6ImE1NTM4MjlkLTBlMDctNDk0My05N2U2LWI0NDE3OWNlNDcyYyJ9.Ui_wc4ofP6jDaBxAFUycWtUsyWaneNZ5P5WRB65z4tybTNRemjKSpFZV6Pk1GnWAN_q4OavThya-zASp5fLQ0A', content: '"CRM_TOKEN": "eyJhbGciOiJIUzUxMiJ9..."', expected: false, reason: 'JWT Token' },
  { name: '企业微信 Webhook Key', key: '02dd1897-da89-43d7-b619-c8c006e98038', content: '"WECOM_WEBHOOK_URL": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=02dd1897-da89-43d7-b619-c8c006e98038"', expected: false, reason: '企业微信 Webhook' },
  { name: 'CTRIP_COOKIE (长字符串)', key: 'UBT_VID=1704945943816.f65fBpurv6VP; _RGUID=0790c4f7-3e76-459a-a9b9-2365971bfc04; GUID=09031087218893354063', content: '"CTRIP_COOKIE": "UBT_VID=1704945943816..."', expected: false, reason: 'Cookie' },
  { name: 'CTRIP_TOKEN (UUID)', key: 'c4f56b2d89ae1e3cc50b6c7db5d7ac64-554d93be-b6e6-489c-9bbe-68c9fe4d088d', content: '"CTRIP_TOKEN": "c4f56b2d89ae1e3cc50b6c7db5d7ac64-554d93be-b6e6-489c-9bbe-68c9fe4d088d"', expected: false, reason: 'UUID + CRM 上下文' },
  
  // 应该保留的真实 LLM Key
  { name: 'OpenAI Key', key: 'sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz', content: '"OPENAI_API_KEY": "sk-proj-abc123..."', expected: true, reason: '真实 OpenAI Key' },
  { name: 'DeepSeek Key', key: 'sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567890', content: '"DEEPSEEK_API_KEY": "sk-abc123..."', expected: true, reason: '真实 DeepSeek Key' },
  { name: 'Minimax Key', key: 'sk-cp-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz', content: '"MINIMAX_API_KEY": "sk-cp-abc123..."', expected: true, reason: '真实 Minimax Key' },
  { name: 'Anthropic Key', key: 'sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz', content: '"ANTHROPIC_API_KEY": "sk-ant-api03-abc123..."', expected: true, reason: '真实 Anthropic Key' },
];

console.log('=== 误报过滤测试 ===\n');

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const isPlaceholder = isPlaceholderKey(tc.key);
  const isNonLLM = isNonLLMKey(tc.key);
  const hasNonLLMCtx = hasNonLLMContext(tc.content, tc.key);
  
  const willBeFiltered = isPlaceholder || isNonLLM || hasNonLLMCtx;
  const result = willBeFiltered === !tc.expected ? '✓ PASS' : '✗ FAIL';
  
  if (willBeFiltered === !tc.expected) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`${result} | ${tc.name}`);
  console.log(`       Key: ${tc.key.slice(0, 50)}${tc.key.length > 50 ? '...' : ''}`);
  console.log(`       预期: ${tc.expected ? '保留' : '过滤'} (${tc.reason})`);
  console.log(`       实际: ${willBeFiltered ? '过滤' : '保留'} (placeholder=${isPlaceholder}, nonLLM=${isNonLLM}, context=${hasNonLLMCtx})`);
  console.log('');
}

console.log(`=== 结果: ${passed} 通过, ${failed} 失败 ===`);
