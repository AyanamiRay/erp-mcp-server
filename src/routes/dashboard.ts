import { Router, Request, Response } from 'express';

export const dashboardRouter = Router();

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enterprise MCP Gateway 控制台</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 24px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15); color: var(--success);
      font-size: 12px; font-weight: 600;
    }
    .pulse {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .stat-title { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .stat-val { font-size: 26px; font-weight: 700; color: #fff; }

    .tabs { display: flex; gap: 12px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
    .tab-btn {
      padding: 8px 16px; background: none; border: none;
      color: var(--text-muted); font-size: 15px; font-weight: 500;
      cursor: pointer; border-bottom: 2px solid transparent;
    }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

    .tool-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .tool-card:hover { border-color: var(--primary); }
    .tool-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .tool-name { font-size: 17px; font-weight: 600; color: #60a5fa; font-family: monospace; }
    .tool-desc { color: var(--text-muted); font-size: 14px; margin-bottom: 12px; }
    .tool-meta { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); font-family: monospace; margin-bottom: 12px; }
    
    .btn {
      padding: 6px 14px; border-radius: 6px; border: none;
      cursor: pointer; font-size: 13px; font-weight: 500;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    
    .auth-input {
      background: #0f172a; border: 1px solid var(--border);
      color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 13px;
    }

    /* 调试模态框 */
    .modal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
      align-items: center; justify-content: center; z-index: 100;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 12px; width: 650px; max-width: 90vw; padding: 24px;
    }
    textarea {
      width: 100%; height: 120px; background: #0f172a;
      border: 1px solid var(--border); border-radius: 8px;
      color: #38bdf8; font-family: monospace; padding: 10px; font-size: 13px;
      margin: 10px 0; resize: vertical;
    }
    pre {
      background: #0f172a; border: 1px solid var(--border);
      border-radius: 8px; padding: 12px; color: #a7f3d0;
      font-size: 13px; max-height: 200px; overflow: auto;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-area">
      <h2>🚀 Enterprise MCP Gateway 控制台</h2>
      <div class="status-badge"><div class="pulse"></div> 运行中</div>
    </div>
    <div style="display: flex; gap: 10px; align-items: center;">
      <span style="font-size: 13px; color: var(--text-muted);">API Key:</span>
      <input type="password" id="apiKeyInput" class="auth-input" placeholder="输入密钥以管理" value="">
      <button class="btn btn-outline" onclick="saveKey()">保存</button>
      <button class="btn btn-primary" onclick="loadAll()">刷新数据</button>
    </div>
  </header>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-title">已挂载 ERP 工具数</div>
      <div class="stat-val" id="statTools">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">业务字典资源数</div>
      <div class="stat-val" id="statResources">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">活跃 AI 会话数 (SSE)</div>
      <div class="stat-val" id="statSessions">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">服务运行时间</div>
      <div class="stat-val" id="statUptime">0s</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('tools')">🛠️ 动态工具列表 (Tools)</button>
    <button class="tab-btn" onclick="switchTab('resources')">📚 业务字典上下文 (Resources)</button>
  </div>

  <div id="toolsTab">
    <div id="toolsList">正在加载工具列表...</div>
  </div>

  <div id="resourcesTab" style="display: none;">
    <div id="resourcesList">正在加载字典资源...</div>
  </div>

  <!-- 在线接口测试模态框 -->
  <div class="modal" id="testModal">
    <div class="modal-content">
      <h3 style="margin-bottom: 10px;" id="modalToolName">接口测试</h3>
      <p style="font-size: 13px; color: var(--text-muted);">直接向 Java ERP 接口发起调试请求（自动执行入参校验与敏感信息脱敏）：</p>
      
      <div style="margin-top: 10px; font-size: 12px; color: #94a3b8;">请求入参 (JSON 格式):</div>
      <textarea id="testParams">{}</textarea>
      
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px;">
        <button class="btn btn-outline" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" id="btnExecuteTest" onclick="executeTest()">立即执行测试</button>
      </div>

      <div style="font-size: 12px; color: #94a3b8;">执行响应 (脱敏后):</div>
      <pre id="testResult">// 等待执行...</pre>
    </div>
  </div>

  <script>
    let currentKey = localStorage.getItem('mcp_api_key') || 'default-mcp-secret-key-change-in-production';
    document.getElementById('apiKeyInput').value = currentKey;

    let currentTestingTool = '';

    function saveKey() {
      currentKey = document.getElementById('apiKeyInput').value.trim();
      localStorage.setItem('mcp_api_key', currentKey);
      loadAll();
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('toolsTab').style.display = tab === 'tools' ? 'block' : 'none';
      document.getElementById('resourcesTab').style.display = tab === 'resources' ? 'block' : 'none';
    }

    async function fetchApi(path, options = {}) {
      options.headers = options.headers || {};
      options.headers['X-API-Key'] = currentKey;
      if (options.body && typeof options.body === 'object') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }
      return fetch(path, options);
    }

    async function loadAll() {
      try {
        // 加载健康指标
        const hRes = await fetch('/healthz');
        if (hRes.ok) {
          const hData = await hRes.json();
          document.getElementById('statSessions').innerText = hData.activeSessions || 0;
          document.getElementById('statTools').innerText = hData.registeredTools || 0;
          const mins = Math.floor(hData.uptimeSeconds / 60);
          document.getElementById('statUptime').innerText = mins > 0 ? mins + ' min' : hData.uptimeSeconds + ' s';
        }

        // 加载工具列表
        const tRes = await fetchApi('/admin/tools');
        if (tRes.ok) {
          const tData = await tRes.json();
          renderTools(tData.data || []);
        } else {
          document.getElementById('toolsList').innerHTML = '<p style="color: var(--danger);">获取失败，请检查 API Key 是否正确</p>';
        }

        // 加载字典列表
        const rRes = await fetchApi('/admin/resources');
        if (rRes.ok) {
          const rData = await rRes.json();
          document.getElementById('statResources').innerText = (rData.data || []).length;
          renderResources(rData.data || []);
        }
      } catch (err) {
        console.error(err);
      }
    }

    function renderTools(tools) {
      if (tools.length === 0) {
        document.getElementById('toolsList').innerHTML = '<p style="color: var(--text-muted); padding: 20px;">暂未挂载任何工具，等待 Spring Boot 启动自动注册...</p>';
        return;
      }
      let html = '';
      tools.forEach(t => {
        html += \`
          <div class="tool-card">
            <div class="tool-header">
              <div>
                <span class="tool-name">\${t.toolName}</span>
                \${t.category ? \`<span style="margin-left: 8px; font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #334155;">\${t.category}</span>\` : ''}
              </div>
              <div>
                <button class="btn btn-outline" onclick="openTest('\${t.toolName}')">🧪 在线调试</button>
                <button class="btn \${t.enabled ? 'btn-danger' : 'btn-primary'}" onclick="toggleTool('\${t.toolName}')" style="margin-left: 6px;">
                  \${t.enabled ? '禁用' : '启用'}
                </button>
              </div>
            </div>
            <div class="tool-desc">\${t.description}</div>
            <div class="tool-meta">
              <span>🎯 目标 URL: \${t.invocation.method || 'POST'} \${t.invocation.url}</span>
              <span>⏱️ 超时: \${t.invocation.timeoutMs || 5000}ms</span>
              <span>🔒 状态: <strong style="color: \${t.enabled ? '#10b981' : '#ef4444'}">\${t.enabled ? '已启用' : '已停用'}</strong></span>
            </div>
          </div>
        \`;
      });
      document.getElementById('toolsList').innerHTML = html;
    }

    function renderResources(resources) {
      if (resources.length === 0) {
        document.getElementById('resourcesList').innerHTML = '<p style="color: var(--text-muted); padding: 20px;">暂无业务字典资源</p>';
        return;
      }
      let html = '';
      resources.forEach(r => {
        html += \`
          <div class="tool-card">
            <div class="tool-header">
              <span class="tool-name" style="color: #34d399;">\${r.name}</span>
              <span style="font-size: 12px; color: var(--text-muted); font-family: monospace;">\${r.uri}</span>
            </div>
            <div class="tool-desc">\${r.description}</div>
          </div>
        \`;
      });
      document.getElementById('resourcesList').innerHTML = html;
    }

    async function toggleTool(toolName) {
      await fetchApi('/admin/tools/' + toolName + '/toggle', { method: 'PATCH' });
      loadAll();
    }

    function openTest(toolName) {
      currentTestingTool = toolName;
      document.getElementById('modalToolName').innerText = '🧪 在线调试工具: ' + toolName;
      document.getElementById('testParams').value = '{\\n  \\n}';
      document.getElementById('testResult').innerText = '// 点击上方按钮发起调用...';
      document.getElementById('testModal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('testModal').classList.remove('active');
    }

    async function executeTest() {
      const btn = document.getElementById('btnExecuteTest');
      btn.innerText = '请求中...';
      btn.disabled = true;

      try {
        const bodyStr = document.getElementById('testParams').value;
        const bodyObj = JSON.parse(bodyStr || '{}');

        const res = await fetchApi('/admin/tools/' + currentTestingTool + '/test', {
          method: 'POST',
          body: bodyObj
        });
        const data = await res.json();
        document.getElementById('testResult').innerText = JSON.stringify(data, null, 2);
      } catch (e) {
        document.getElementById('testResult').innerText = '错误: ' + e.message;
      } finally {
        btn.innerText = '立即执行测试';
        btn.disabled = false;
      }
    }

    loadAll();
  </script>
</body>
</html>
`;

dashboardRouter.get('/dashboard', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(DASHBOARD_HTML);
});
