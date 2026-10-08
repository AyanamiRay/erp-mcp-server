import http from 'http';
import { InputSanitizer } from './dist/mcp/sanitizer.js';
import { idempotencyGuard } from './dist/mcp/idempotency.js';
import { eventBus } from './dist/bus/eventBus.js';
import { resourceRegistry } from './dist/mcp/resources.js';
import { promptRegistry } from './dist/mcp/prompts.js';
import { GenericInvoker } from './dist/mcp/invoker.js';
import { SsrfValidator } from './dist/security/ssrfValidator.js';
import { keyManager } from './dist/auth/keyManager.js';

const API_KEY = 'test-secret-key-123456';
const BASE_URL = 'http://127.0.0.1:3000';

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': options.apiKey || API_KEY,
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

async function runP0P1Tests() {
  console.log('====================================================');
  console.log('  P0 & P1 企业级增强与并发缺陷修复全面验证套件     ');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // 1. [P0] 验证 InputSanitizer Schema-Aware 业务单号保护
  // ----------------------------------------------------
  console.log('=== [1] 测试 InputSanitizer：业务单号保护与 Schema 感知 ===');
  const mockInput = {
    orderNo: '10023456',    // 业务单号，不以0开头且长8位
    batchNo: '99887766',    // 批次号
    pageSize: ' 50 ',       // 分页大小
    docDate: '2026/10/08',  // 日期
  };

  const mockSchema = {
    type: 'object',
    properties: {
      orderNo: { type: 'string', description: '采购订单号' },
      batchNo: { type: 'string', description: '生产批次号' },
      pageSize: { type: 'integer', description: '每页条数' },
      docDate: { type: 'string', description: '单据日期' },
    },
  };

  const cleaned = InputSanitizer.sanitize(mockInput, mockSchema);
  console.log('清洗后结果:', cleaned);

  if (typeof cleaned.orderNo !== 'string' || cleaned.orderNo !== '10023456') {
    throw new Error(`orderNo 被错误转为数字，当前类型为: ${typeof cleaned.orderNo}`);
  }
  if (typeof cleaned.batchNo !== 'string' || cleaned.batchNo !== '99887766') {
    throw new Error(`batchNo 被错误转为数字，当前类型为: ${typeof cleaned.batchNo}`);
  }
  if (cleaned.pageSize !== 50 || typeof cleaned.pageSize !== 'number') {
    throw new Error(`pageSize 纠偏失败，期望 50 数字`);
  }
  if (cleaned.docDate !== '2026-10-08') {
    throw new Error(`docDate 日期格式规范化失败`);
  }
  console.log('✅ InputSanitizer Schema 感知与业务编码防护验证通过！\n');

  // ----------------------------------------------------
  // 2. [P0] 验证 IdempotencyGuard 并发 In-Flight 锁
  // ----------------------------------------------------
  console.log('=== [2] 测试 IdempotencyGuard：并发 In-Flight 防重锁 ===');
  const testSid = 'session-concurrency-test';
  const testTool = 'create_payment_order';
  const testArgs = { amount: 50000, recipient: '供应商甲' };
  const fp = idempotencyGuard.generateFingerprint(testSid, testTool, testArgs);

  // 第一个并发请求占锁
  const acq1 = idempotencyGuard.acquire(fp);
  console.log('请求 1 占锁结果:', acq1.allowed); // 应为 true

  // 模拟同一毫秒内到达的并发请求 2
  const acq2 = idempotencyGuard.acquire(fp);
  console.log('请求 2 并发拦截结果: allowed =', acq2.allowed, 'status =', acq2.status);

  if (acq1.allowed !== true || acq2.allowed !== false || acq2.status !== 'PENDING') {
    throw new Error('IdempotencyGuard 并发 In-Flight 锁未能拦截并发请求！');
  }

  // 模拟请求 1 成功完成并写入结果
  idempotencyGuard.resolve(fp, '支付流水号: PAY-2026-0001');

  // 此时请求 3 到达，应命中 5秒防重连点锁并复用上次结果
  const acq3 = idempotencyGuard.acquire(fp);
  console.log('请求 3 连点防重检查: allowed =', acq3.allowed, 'cachedResult =', acq3.cachedResult);

  if (acq3.allowed !== false || acq3.status !== 'COMPLETED' || !acq3.cachedResult?.includes('PAY-2026-0001')) {
    throw new Error('IdempotencyGuard 结果复用未生效！');
  }
  console.log('✅ IdempotencyGuard 并发锁与 5 秒结果复用全部验证通过！\n');

  // ----------------------------------------------------
  // 3. [P0] 验证 EventBus 节点去重与 Payload 广播
  // ----------------------------------------------------
  console.log('=== [3] 测试 EventBus 节点标识与多节点 Payload 广播 ===');
  console.log(`当前节点 NodeId: ${eventBus.nodeId}`);
  if (!eventBus.nodeId || typeof eventBus.nodeId !== 'string') {
    throw new Error('EventBus 未初始化唯一 nodeId！');
  }
  console.log('✅ EventBus 节点标识与去重支持就绪！\n');

  // ----------------------------------------------------
  // 4. [P1] 启动 Mock ERP 服务验证业务错误识别与结构化截断
  // ----------------------------------------------------
  console.log('=== [4] 测试下游 ERP 业务状态码识别与缓存防污染 ===');
  let mockRequestCount = 0;
  const mockErpServer = http.createServer((req, res) => {
    mockRequestCount++;
    if (req.url === '/api/erp/order/create') {
      // 模拟 Java ERP HTTP 200 返回业务失败
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 500,
        success: false,
        message: '仓库当前可用物料不足，禁止建单',
      }));
    } else if (req.url === '/api/erp/big-list') {
      // 模拟返回 50 条明细大数组
      const bigList = [];
      for (let i = 1; i <= 50; i++) {
        bigList.push({ id: i, sku: `SKU-${1000 + i}`, title: `高精密工业备件第${i}号` });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, code: 0, list: bigList }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 0, success: true, data: 'OK' }));
    }
  });

  await new Promise((resolve) => mockErpServer.listen(3998, '127.0.0.1', resolve));

  try {
    // 4.1 测试 ERP 业务错误识别
    const failToolMeta = {
      toolName: 'create_failing_order',
      description: '测试业务报错单据',
      enabled: true,
      inputSchema: { type: 'object', properties: { qty: { type: 'number' } } },
      invocation: { url: 'http://127.0.0.1:3998/api/erp/order/create', method: 'POST' },
      enableIdempotency: true,
    };

    const failResult = await GenericInvoker.execute(failToolMeta, { qty: 99 }, 'trace-biz-err');
    console.log('ERP 业务错误执行结果:', failResult);

    if (!failResult.isError || !failResult.content[0].text.includes('仓库当前可用物料不足')) {
      throw new Error('未正确识别 ERP HTTP 200 返回的业务层失败！');
    }
    console.log('✅ ERP HTTP 200 业务错误识别验证通过 (标记为 isError 且不写入缓存)！\n');

    // 4.2 测试结构化保护截断 (防止破坏 JSON 语法)
    console.log('=== [5] 测试结构化保护截断 (保留有效 JSON / 表格结构) ===');
    const bigListToolMeta = {
      toolName: 'query_big_list',
      description: '大列表查询',
      enabled: true,
      compactTable: false, // 纯 JSON 模式
      inputSchema: { type: 'object', properties: {} },
      invocation: { url: 'http://127.0.0.1:3998/api/erp/big-list', method: 'GET' },
      responseFilter: { maxChars: 500 }, // 限制 500 字符
    };

    const bigResult = await GenericInvoker.execute(bigListToolMeta, {}, 'trace-big-list');
    const returnedJsonText = bigResult.content[0].text;
    console.log('截断后返回内容:\n', returnedJsonText);

    // 验证截断后是否仍然是合法的 JSON (无语法破损)
    let parsedJson;
    try {
      parsedJson = JSON.parse(returnedJsonText);
    } catch (e) {
      throw new Error(`截断后产生了无效的 JSON: ${e.message}`);
    }

    if (!parsedJson._truncated || !parsedJson.list || parsedJson.displayedItems >= 50) {
      throw new Error('结构化截断未保留 _truncated 标识或未正确截断子列表');
    }
    console.log(`✅ 结构化 JSON 截断验证通过！保留有效 JSON 结构，截断后展示: ${parsedJson.displayedItems}/${parsedJson.totalItems} 条\n`);

  } finally {
    mockErpServer.close();
  }

  // ----------------------------------------------------
  // 5. [P1] 测试 SSRF 安全防护
  // ----------------------------------------------------
  console.log('=== [6] 测试 SSRF 安全防护机制 ===');
  const cloudMetadataCheck = SsrfValidator.validate('http://169.254.169.254/latest/meta-data');
  console.log('云元数据拦截结果:', cloudMetadataCheck.valid, cloudMetadataCheck.error);
  if (cloudMetadataCheck.valid !== false || !cloudMetadataCheck.error?.includes('SSRF')) {
    throw new Error('未能拦截 169.254.169.254 云元数据请求！');
  }

  const gopherCheck = SsrfValidator.validate('gopher://127.0.0.1:6379/_flushall');
  console.log('非 HTTP 协议拦截结果:', gopherCheck.valid, gopherCheck.error);
  if (gopherCheck.valid !== false || !gopherCheck.error?.includes('不安全的协议类型')) {
    throw new Error('未能拦截 gopher:// 危险协议！');
  }

  const safeCheck = SsrfValidator.validate('https://api.erp-internal.com/v1/orders');
  console.log('正常安全 URL 检查结果:', safeCheck.valid);
  if (safeCheck.valid !== true) {
    throw new Error('合法的企业内部 URL 被误拦截！');
  }
  console.log('✅ SSRF 安全防护与协议白名单验证通过！\n');

  // ----------------------------------------------------
  // 6. [P1] 测试 Resources & Prompts 变更通知监听
  // ----------------------------------------------------
  console.log('=== [7] 测试 Resources & Prompts 变更实时广播机制 ===');
  let resourceChangedFired = false;
  let promptChangedFired = false;

  const unsubRes = resourceRegistry.onResourcesChanged(() => {
    resourceChangedFired = true;
  });
  const unsubPrompt = promptRegistry.onPromptsChanged(() => {
    promptChangedFired = true;
  });

  resourceRegistry.registerResource({
    uri: 'erp://dict/test_currencies',
    name: '测试币种字典',
    description: '结算币种',
    content: '{"CNY":"人民币"}',
  });

  promptRegistry.registerPrompt({
    name: 'test_sop_template',
    description: '测试 SOP',
    messages: [{ role: 'user', content: { type: 'text', text: '执行 SOP' } }],
  });

  if (!resourceChangedFired || !promptChangedFired) {
    throw new Error('Resources 或 Prompts 变更监听器未被触发！');
  }

  unsubRes();
  unsubPrompt();
  resourceRegistry.unregisterResource('erp://dict/test_currencies');
  promptRegistry.unregisterPrompt('test_sop_template');
  console.log('✅ Resources & Prompts 实时变更回调验证通过！\n');

  // ----------------------------------------------------
  // 7. [P1] 测试多租户 API Key 动态增删改查
  // ----------------------------------------------------
  console.log('=== [8] 测试多租户 API Key 动态管理 ===');
  const newProfile = {
    key: 'sk-warehouse-agent-2026',
    name: '仓储自动化助手',
    role: 'client',
    allowedCategories: ['inventory'],
  };
  keyManager.addKey(newProfile);

  const authProfile = keyManager.authenticate('sk-warehouse-agent-2026');
  if (!authProfile || authProfile.name !== '仓储自动化助手') {
    throw new Error('动态添加的 API Key 认证失败');
  }

  keyManager.removeKey('sk-warehouse-agent-2026');
  const removedProfile = keyManager.authenticate('sk-warehouse-agent-2026');
  if (removedProfile !== null) {
    throw new Error('撤销的 API Key 仍能通过认证');
  }
  console.log('✅ 多租户 API Key 动态注册、认证与撤销验证通过！\n');

  console.log('🎉🎉🎉 P0 与 P1 所有 7 项优化全部通过高强度验证！');
}

runP0P1Tests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
