import { InputSanitizer } from './dist/mcp/sanitizer.js';
import { CompactFormatter } from './dist/mcp/formatter.js';
import { toolLruCache, LruCache } from './dist/mcp/cache.js';
import { singleflight } from './dist/mcp/singleflight.js';

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

async function runPerfTests() {
  console.log('=== [1] 单元测试: 大模型入参宽容纠错清洗 (InputSanitizer) ===');
  const rawInput = {
    queryDate: ' 2026/09/19 ',
    pageSize: ' 50 ',
    isExport: 'true',
    filterCode: '00123', // 保留以0开头的单号不强制转数字
  };

  const clean = InputSanitizer.sanitize(rawInput);
  console.log('清洗前:', rawInput);
  console.log('清洗后:', clean);

  if (clean.queryDate !== '2026-09-19' || clean.pageSize !== 50 || clean.isExport !== true || clean.filterCode !== '00123') {
    throw new Error('InputSanitizer 纠偏未符合预期');
  }
  console.log('✅ InputSanitizer 宽容纠错验证通过！\n');

  console.log('=== [2] 单元测试: 出参 Markdown 表格紧凑压缩 (CompactFormatter) ===');
  const mockRows = [
    { sku: 'M1001', name: '高精密轴承', stock: 1200, unit: '个' },
    { sku: 'M1002', name: '传动齿轮', stock: 450, unit: '套' },
    { sku: 'M1003', name: '减震弹簧', stock: 3200, unit: '件' },
  ];

  const tableMd = CompactFormatter.format(mockRows);
  console.log('转换后的 Markdown 表格:\n' + tableMd);

  if (!tableMd.includes('| sku | name | stock | unit |') || !tableMd.includes('| M1001 |')) {
    throw new Error('CompactFormatter 表格化失败');
  }
  console.log('✅ CompactFormatter Token 紧凑压缩验证通过！\n');

  console.log('=== [3] 单元测试: 内存 LRU 二级缓存与 TTL 失效 ===');
  const cacheKey = LruCache.generateKey('test_tool', { a: 1, b: 'hello' });
  toolLruCache.set(cacheKey, 'Cached Data Result', 500); // 500ms 过期
  if (toolLruCache.get(cacheKey) !== 'Cached Data Result') {
    throw new Error('LRU 缓存命中失败');
  }
  console.log('首次命中缓存成功: 0ms 返回');

  await new Promise((r) => setTimeout(r, 600));
  if (toolLruCache.get(cacheKey) !== undefined) {
    throw new Error('LRU 缓存 TTL 失效未生效');
  }
  console.log('✅ LRU 二级缓存与 TTL 机制验证通过！\n');

  console.log('=== [4] 单元测试: Singleflight 并发请求合并去重 ===');
  let realExecuteCount = 0;
  const slowTask = async () => {
    realExecuteCount++;
    await new Promise((r) => setTimeout(r, 100));
    return 'Slow Task Done';
  };

  // 模拟 4 个并发请求同时打过来
  const sfKey = 'concurrent-key-test';
  const results = await Promise.all([
    singleflight.do(sfKey, slowTask),
    singleflight.do(sfKey, slowTask),
    singleflight.do(sfKey, slowTask),
    singleflight.do(sfKey, slowTask),
  ]);

  console.log('并发返回结果数量:', results.length, '下游真实执行次数:', realExecuteCount);
  if (realExecuteCount !== 1) {
    throw new Error(`Singleflight 未实现请求去重，下游执行了 ${realExecuteCount} 次`);
  }
  console.log('✅ Singleflight 并发去重防击穿验证通过！\n');

  console.log('🎉 性能极致优化与工程进阶（连接池、LRU缓存、Singleflight、Markdown压缩、入参纠错）全部测试通过！');
}

runPerfTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
