// 测试 hunt 扫描结果
const http = require('http');
const SESSION = 'session=2b9490b87ab981451b1c24a98231c5d0df52bac17a518ee228fdb30a17c81a95';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': SESSION,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(d); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 1. 发起扫描
  console.log('=== 发起扫描 ===');
  const startRes = await request('POST', '/api/hunt/scan', {
    targets: [{ id: 't1', host: '42.192.42.57', port: '8090', protocol: 'http', url: 'http://42.192.42.57:8090' }]
  });
  console.log('启动结果:', JSON.stringify(startRes));

  if (!startRes.taskId) {
    console.log('启动失败');
    return;
  }

  const taskId = startRes.taskId;

  // 2. 等待完成
  console.log('\n=== 等待完成 ===');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const tasks = await request('GET', '/api/hunt/tasks');
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const progress = JSON.parse(task.progress || '{}');
      const p = progress['http://42.192.42.57:8090'] || {};
      console.log(`[${i*3}s] status=${task.status}, phase=${p.phase}, raw=${p.rawFindings}, llm=${p.llmFindings}`);
      if (task.status === 'completed' || task.status === 'failed') {
        console.log('最终状态:', JSON.stringify(task, null, 2));
        break;
      }
    }
  }

  // 3. 获取结果
  console.log('\n=== 扫描结果 ===');
  const results = await request('GET', `/api/hunt/results?taskId=${taskId}`);
  const findings = results.findings || [];
  console.log(`共 ${findings.length} 个发现 (task ${taskId}):\n`);

  for (const f of findings.filter(f => f.task_id === taskId)) {
    console.log(`--- Finding #${f.id} ---`);
    console.log(`  key_value: ${f.key_value}`);
    console.log(`  provider: ${f.provider}`);
    console.log(`  model: ${f.model}`);
    console.log(`  base_url: ${f.base_url}`);
    console.log(`  confidence: ${f.confidence}`);
    console.log(`  source: ${f.source_urls}`);
    console.log('');
  }

  // 4. 验证
  console.log('=== 验证 ===');
  const taskFindings = findings.filter(f => f.task_id === taskId);
  const keyValues = taskFindings.map(f => f.key_value);

  // 期望的 3 个 key
  const expectedKeys = [
    { pattern: 'sk-cp-', desc: 'minimax (sk-cp- prefix)' },
    { pattern: 'sk-97a409', desc: 'bailian (sk- prefix)' },
    { pattern: '4f16d1b5', desc: 'volcengine (UUID)' },
  ];

  for (const expected of expectedKeys) {
    const found = keyValues.some(k => k.startsWith(expected.pattern));
    console.log(`${found ? '✅' : '❌'} ${expected.desc}: ${found ? '找到' : '未找到'}`);
  }

  // 检查误报
  const falsePositives = keyValues.filter(k =>
    k === 'minimax-oauth' || k.includes('placeholder') || k.includes('example')
  );
  if (falsePositives.length > 0) {
    console.log(`\n⚠️  误报 (${falsePositives.length}): ${falsePositives.join(', ')}`);
  } else {
    console.log('\n✅ 无误报');
  }
}

main().catch(console.error);
