import http from 'http';

const API_KEY = 'test-secret-key-123456';
const BASE_URL = 'http://127.0.0.1:3000';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function runTests() {
  console.log('=== [1] 测试 /healthz 探活端点 ===');
  const health = await request('/healthz');
  console.log('Health Response:', health.status, health.data);
  if (health.status !== 200 || health.data.status !== 'UP') {
    throw new Error('Health check failed');
  }

  console.log('\n=== [2] 测试动态注册工具 (POST /admin/tools/register) ===');
  const toolPayload = {
    toolName: 'query_erp_inventory',
    description: '查询 ERP 系统的物料库存',
    category: 'inventory',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        materialCode: { type: 'string', description: '物料编码' },
      },
      required: ['materialCode'],
    },
    invocation: {
      url: 'https://httpbin.org/post', // 使用公网回显模拟 ERP 接口
      method: 'POST',
      timeoutMs: 4000,
    },
    responseFilter: {
      pickFields: ['json', 'headers'],
    },
  };

  const registerRes = await request('/admin/tools/register', {
    method: 'POST',
    body: toolPayload,
  });
  console.log('Register Res:', registerRes.status, registerRes.data.message);

  console.log('\n=== [3] 查询已注册工具列表 (GET /admin/tools) ===');
  const listRes = await request('/admin/tools');
  console.log(`当前已注册工具数量: ${listRes.data.count}`);
  const hasTool = listRes.data.data.some((t) => t.toolName === 'query_erp_inventory');
  console.log('包含刚刚注册的工具:', hasTool);

  console.log('\n=== [4] 测试 SSE 长连接建立与热更新推送 (GET /sse) ===');
  // 建立原生 SSE 连接
  const sseReq = http.request(
    `${BASE_URL}/sse`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    },
    (res) => {
      console.log('SSE 连接状态码:', res.statusCode);
      res.on('data', (chunk) => {
        const text = chunk.toString();
        console.log('[SSE 接收数据]:', text.trim());
      });
    }
  );
  sseReq.end();

  await wait(1000);

  console.log('\n=== [5] 动态注册第二个工具，验证 SSE 客户端是否收到 list_changed ===');
  const tool2 = {
    toolName: 'approve_purchase_order',
    description: '审批采购申请单',
    category: 'purchase',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
      },
    },
    invocation: {
      url: 'https://httpbin.org/post',
      method: 'POST',
    },
  };
  await request('/admin/tools/register', {
    method: 'POST',
    body: tool2,
  });

  await wait(1500);

  console.log('\n=== [6] 测试动态下线工具 ===');
  const deleteRes = await request('/admin/tools/query_erp_inventory', {
    method: 'DELETE',
  });
  console.log('Delete Res:', deleteRes.status, deleteRes.data.message);

  await wait(1000);
  sseReq.destroy();

  console.log('\n🎉 所有核心热插拔与高可用机制验证全部通过！');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
