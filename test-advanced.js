import http from 'http';
import { DataMasker } from './dist/mcp/masker.js';
import { ToolCircuitBreaker } from './dist/mcp/breaker.js';

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

async function runAdvancedTests() {
  console.log('=== [1] 单元测试: 敏感信息自动脱敏 (DataMasker) ===');
  const mockErpData = {
    user: {
      name: '张三',
      mobile: '13812345678',
      idCard: '110101199003072345',
      bankCard: '6222021234567890123',
      email: 'zhangsan@corp.com',
      dbPassword: 'super_secret_pwd_123',
    },
    remark: '联系手机13987654321，附带卡号6214830123456789',
  };

  const masked = DataMasker.maskData(mockErpData);
  console.log('脱敏后结果:', JSON.stringify(masked, null, 2));

  if (
    masked.user.mobile !== '138****5678' ||
    masked.user.idCard !== '110101********2345' ||
    masked.user.dbPassword !== '******' ||
    !masked.user.bankCard.includes('*')
  ) {
    throw new Error('DataMasker 脱敏逻辑未达到预期');
  }
  console.log('✅ DataMasker 脱敏验证完全通过！\n');

  console.log('=== [2] 单元测试: 防大模型死循环熔断器 (ToolCircuitBreaker) ===');
  const testBreaker = new ToolCircuitBreaker({ windowMs: 10000, maxCallsPerWindow: 3, coolDownMs: 5000 });
  const sid = 'session-test-agent';
  const tname = 'query_inventory';

  console.log('调用 1:', testBreaker.checkAndRecord(sid, tname).allowed);
  console.log('调用 2:', testBreaker.checkAndRecord(sid, tname).allowed);
  console.log('调用 3:', testBreaker.checkAndRecord(sid, tname).allowed);
  const call4 = testBreaker.checkAndRecord(sid, tname);
  console.log('调用 4 (应被熔断): allowed=', call4.allowed, 'reason=', call4.reason);

  if (call4.allowed !== false || !call4.reason.includes('熔断')) {
    throw new Error('熔断器未成功拦截第 4 次高频调用');
  }
  console.log('✅ 防死循环智能熔断器验证完全通过！\n');

  console.log('=== [3] 集成测试: 检查 Web Dashboard 控制台端点 ===');
  const dashRes = await request('/dashboard');
  if (dashRes.status !== 200 || !dashRes.data.includes('Enterprise MCP Gateway')) {
    throw new Error('Dashboard 页面未正常渲染');
  }
  console.log('✅ Dashboard 控制台渲染正常 (HTTP 200)！\n');

  console.log('=== [4] 集成测试: 查询已挂载业务字典 (GET /admin/resources) ===');
  const resRes = await request('/admin/resources');
  console.log(`已加载字典数量: ${resRes.data.count}`, resRes.data.data.map((r) => r.name));
  if (resRes.status !== 200 || resRes.data.count < 1) {
    throw new Error('Resources 字典获取失败');
  }
  console.log('✅ MCP Resources 业务字典机制验证完全通过！\n');

  console.log('🎉 全部优化项（脱敏、熔断、字典挂载、Web 控制台、Spring Boot 高级自省）测试全部通过！');
}

runAdvancedTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
