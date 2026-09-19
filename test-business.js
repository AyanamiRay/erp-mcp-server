import { TemplateEnricher } from './dist/mcp/enricher.js';
import { IdempotencyGuard } from './dist/mcp/idempotency.js';

const API_KEY = 'test-secret-key-123456';
const BASE_URL = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
    ...(options.headers || {}),
  };

  const response = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

async function runBusinessTests() {
  console.log('=== [1] 单元测试: 建单模板缺省字段自动补全 (TemplateEnricher) ===');
  const rawOrderArgs = {
    supplierId: 'SUP_8899',
    materialCode: 'M1001',
    quantity: 500,
  };
  const templateConfig = {
    currency: 'CNY',
    taxRate: 0.13,
    status: 'DRAFT',
    docDate: '{{current_date}}',
  };

  const enriched = TemplateEnricher.enrich(rawOrderArgs, templateConfig);
  console.log('大模型原始入参:', rawOrderArgs);
  console.log('补全后入参:', enriched);

  const today = new Date().toISOString().split('T')[0];
  if (
    enriched.supplierId !== 'SUP_8899' ||
    enriched.currency !== 'CNY' ||
    enriched.taxRate !== 0.13 ||
    enriched.docDate !== today
  ) {
    throw new Error('TemplateEnricher 补全逻辑未生效');
  }
  console.log('✅ TemplateEnricher 模板自动补全验证通过！\n');

  console.log('=== [2] 单元测试: 5秒业务幂等防重守卫 (IdempotencyGuard) ===');
  const guard = new IdempotencyGuard();
  const sid = 'session-erp-agent-01';
  const tool = 'create_purchase_order';
  const args = { supplierId: 'SUP_8899', materialCode: 'M1001', quantity: 500 };

  const fp = guard.generateFingerprint(sid, tool, args);
  console.log('首次提交前检查:', guard.check(fp).duplicate); // 应为 false

  // 记录首次创建结果
  guard.record(fp, '订单号: PO20260919001 (创建成功)');

  // 100ms 内再次连点提交完全相同内容的单据
  const duplicateCheck = guard.check(fp);
  console.log('100ms内重复提交检查: duplicate =', duplicateCheck.duplicate, '复用结果 =', duplicateCheck.cachedResult);

  if (!duplicateCheck.duplicate || !duplicateCheck.cachedResult?.includes('PO20260919001')) {
    throw new Error('5秒内防重连点锁未生效！');
  }
  console.log('✅ 5秒内业务幂等防重连点拦截验证通过！\n');

  console.log('=== [3] 集成测试: 注册建单工具并验证 Dry-Run 预校验模式 ===');
  // 注册一个建单工具
  await request('/admin/tools/register', {
    method: 'POST',
    body: {
      toolName: 'create_test_order',
      description: '创建采购申请单',
      category: 'purchase',
      readOnly: false,
      templateDefaults: { currency: 'CNY', docDate: '{{current_date}}' },
      inputSchema: {
        type: 'object',
        properties: {
          supplierId: { type: 'string' },
          quantity: { type: 'number' },
          dryRun: { type: 'boolean' },
        },
        required: ['supplierId', 'quantity'],
      },
      invocation: { url: 'https://httpbin.org/post', method: 'POST' },
    },
  });

  // 以 dryRun: true 方式发起调用
  const dryRunRes = await request('/admin/tools/create_test_order/test', {
    method: 'POST',
    body: { supplierId: 'SUP_TEST', quantity: 100, dryRun: true },
  });

  console.log('Dry-Run 返回结果:');
  const resultText = dryRunRes.data.result.content[0].text;
  console.log(resultText);

  if (!resultText.includes('Dry-Run 模式') || !resultText.includes('尚未真正写入 ERP 数据库')) {
    throw new Error('Dry-Run 预检模式未生效');
  }
  console.log('✅ Dry-Run 预校验与模拟试算模式验证通过！\n');

  console.log('🎉 5秒业务防重锁、模板缺省值补全与 Dry-Run 模式全部验证通过！');
}

runBusinessTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
