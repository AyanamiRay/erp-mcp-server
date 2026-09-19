import { Router, Request, Response } from 'express';

export const dashboardRouter = Router();

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enterprise MCP Gateway 企业级控制台</title>
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
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .stat-title { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .stat-val { font-size: 24px; font-weight: 700; color: #fff; }

    .tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
    .tab-btn {
      padding: 10px 18px; background: none; border: none;
      color: var(--text-muted); font-size: 14px; font-weight: 500;
      cursor: pointer; border-bottom: 2px solid transparent;
      display: flex; align-items: center; gap: 6px;
    }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: var(--primary); }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .card-title { font-size: 16px; font-weight: 600; color: #60a5fa; font-family: monospace; }
    .card-desc { color: var(--text-muted); font-size: 14px; margin-bottom: 12px; }
    .card-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--text-muted); font-family: monospace; }
    
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

    /* 审计表格样式 */
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { padding: 12px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid var(--border); }
    tr:hover { background: rgba(255, 255, 255, 0.02); }

    /* 弹窗模态框 */
    .modal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
      align-items: center; justify-content: center; z-index: 100;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: var(--card-bg); border: 1px solid var(--border);
      border-radius: 12px; width: 700px; max-width: 90vw; padding: 24px;
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
      font-size: 13px; max-height: 250px; overflow: auto;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo-area">
      <h2>🚀 Enterprise MCP Gateway 企业控制台</h2>
      <div class="status-badge"><div class="pulse"></div> 运行中 (带心跳保活)</div>
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
      <div class="stat-title">业务专家 SOP (Prompts)</div>
      <div class="stat-val" id="statPrompts">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">活跃 AI 会话 (SSE)</div>
      <div class="stat-val" id="statSessions">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">累计审计流水数</div>
      <div class="stat-val" id="statAudits">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-title">服务运行时间</div>
      <div class="stat-val" id="statUptime">0s</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('tools')">🛠️ 动态工具列表 (Tools)</button>
    <button class="tab-btn" onclick="switchTab('resources')">📚 业务字典上下文 (Resources)</button>
    <button class="tab-btn" onclick="switchTab('audits')">📋 调用历史与审计溯源 (Audit Logs)</button>
    <button class="tab-btn" onclick="switchTab('prompts')">📝 业务 SOP 模板 (Prompts)</button>
  </div>

  <!-- Tab 1: 工具列表 -->
  <div id="toolsTab">
    <div id="toolsList">正在加载工具列表...</div>
  </div>

  <!-- Tab 2: 业务字典 -->
  <div id="resourcesTab" style="display: none;">
    <div id="resourcesList">正在加载字典资源...</div>
  </div>

  <!-- Tab 3: 调用历史与审计溯源 -->
  <div id="auditsTab" style="display: none;">
    <div class="card" style="padding: 10px;">
      <table id="auditTable">
        <thead>
          <tr>
            <th>时间</th>
            <th>Trace ID</th>
            <th>调用方身份</th>
            <th>工具名称</th>
            <th>耗时</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="auditListBody">
          <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">暂无调用流水</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Tab 4: Prompts 模板 -->
  <div id="promptsTab" style="display: none;">
    <div id="promptsList">正在加载 SOP 模板...</div>
  </div>

  <!-- 在线接口测试模态框 -->
  <div class="modal" id="testModal">
    <div class="modal-content">
      <h3 style="margin-bottom: 10px;" id="modalToolName">接口测试</h3>
      <p style="font-size: 13px; color: var(--text-muted);">直接向 Java ERP 发起调用自测（自动执行入参校验、只读重试与出参敏感数据脱敏）：</p>
      
      <div style="margin-top: 10px; font-size: 12px; color: #94a3b8;">请求入参 (JSON 格式):</div>
      <textarea id="testParams">{}</textarea>
      
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px;">
        <button class="btn btn-outline" onclick="closeModal()">关闭</button>
        <button class="btn btn-primary" id="btnExecuteTest" onclick="executeTest()">立即发起测试</button>
      </div>

      <div style="font-size: 12px; color: #94a3b8;">执行响应 (脱敏后):</div>
      <pre id="testResult">// 等待执行...</pre>
    </div>
  </div>

  <!-- 审计详情模态框 -->
  <div class="modal" id="auditDetailModal">
    <div class="modal-content">
      <h3 style="margin-bottom: 10px;">📋 调用审计详情快照</h3>
      <div style="margin-top: 10px; font-size: 12px; color: #94a3b8;">大模型调用入参:</div>
      <pre id="auditArgs">// ...</pre>
      
      <div style="margin-top: 10px; font-size: 12px; color: #94a3b8;">ERP 接口返回摘要 (脱敏后):</div>
      <pre id="auditResp">// ...</pre>

      <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
        <button class="btn btn-outline" onclick="closeAuditModal()">关闭</button>
      </div>
    </div>
  </div>

  <script>
    let currentKey = localStorage.getItem('mcp_api_key') || 'default-mcp-secret-key-change-in-production';
    document.getElementById('apiKeyInput').value = currentKey;

    let currentTestingTool = '';
    let auditRecordsCache = [];

    function saveKey() {
      currentKey = document.getElementById('apiKeyInput').value.trim();
      localStorage.setItem('mcp_api_key', currentKey);
      loadAll();
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.currentTarget.classList.add('active');
      ['tools', 'resources', 'audits', 'prompts'].forEach(t => {
        document.getElementById(t + 'Tab').style.display = t === tab ? 'block' : 'none';
      });
      if (tab === 'audits') loadAudits();
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
        // 健康探针
        const hRes = await fetch('/healthz');
        if (hRes.ok) {
          const hData = await hRes.json();
          document.getElementById('statSessions').innerText = hData.activeSessions || 0;
          document.getElementById('statTools').innerText = hData.registeredTools || 0;
          const mins = Math.floor(hData.uptimeSeconds / 60);
          document.getElementById('statUptime').innerText = mins > 0 ? mins + ' min' : hData.uptimeSeconds + ' s';
        }

        // 工具列表
        const tRes = await fetchApi('/admin/tools');
        if (tRes.ok) {
          const tData = await tRes.json();
          renderTools(tData.data || []);
        }

        // 字典列表
        const rRes = await fetchApi('/admin/resources');
        if (rRes.ok) {
          const rData = await rRes.json();
          document.getElementById('statResources').innerText = (rData.data || []).length;
          renderResources(rData.data || []);
        }

        // SOP 列表
        const pRes = await fetchApi('/admin/prompts');
        if (pRes.ok) {
          const pData = await pRes.json();
          document.getElementById('statPrompts').innerText = (pData.data || []).length;
          renderPrompts(pData.data || []);
        }

        // 审计数统计
        loadAudits();
      } catch (err) {
        console.error(err);
      }
    }

    async function loadAudits() {
      try {
        const aRes = await fetchApi('/admin/audits?limit=50');
        if (aRes.ok) {
          const aData = await aRes.json();
          auditRecordsCache = aData.data || [];
          document.getElementById('statAudits').innerText = auditRecordsCache.length;
          renderAudits(auditRecordsCache);
        }
      } catch (e) {
        console.error(e);
      }
    }

    function renderTools(tools) {
      if (tools.length === 0) {
        document.getElementById('toolsList').innerHTML = '<p style="color: var(--text-muted); padding: 20px;">暂未挂载任何工具，等待 Spring Boot 启动自动上报...</p>';
        return;
      }
      let html = '';
      tools.forEach(t => {
        html += \`
          <div class="card">
            <div class="card-header">
              <div>
                <span class="card-title">\${t.toolName}</span>
                \${t.category ? \`<span style="margin-left: 8px; font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #334155;">\${t.category}</span>\` : ''}
                \${t.readOnly ? \`<span style="margin-left: 6px; font-size: 11px; padding: 2px 8px; border-radius: 4px; background: rgba(16,185,129,0.2); color: #10b981;">只读 (支持重试)</span>\` : ''}
              </div>
              <div>
                <button class="btn btn-outline" onclick="openTest('\${t.toolName}')">🧪 在线调试</button>
                <button class="btn \${t.enabled ? 'btn-danger' : 'btn-primary'}" onclick="toggleTool('\${t.toolName}')" style="margin-left: 6px;">
                  \${t.enabled ? '禁用' : '启用'}
                </button>
              </div>
            </div>
            <div class="card-desc">\${t.description}</div>
            <div class="card-meta">
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
          <div class="card">
            <div class="card-header">
              <span class="card-title" style="color: #34d399;">\${r.name}</span>
              <span style="font-size: 12px; color: var(--text-muted); font-family: monospace;">\${r.uri}</span>
            </div>
            <div class="card-desc">\${r.description}</div>
          </div>
        \`;
      });
      document.getElementById('resourcesList').innerHTML = html;
    }

    function renderPrompts(prompts) {
      if (prompts.length === 0) {
        document.getElementById('promptsList').innerHTML = '<p style="color: var(--text-muted); padding: 20px;">暂无 SOP 模板</p>';
        return;
      }
      let html = '';
      prompts.forEach(p => {
        html += \`
          <div class="card">
            <div class="card-header">
              <span class="card-title" style="color: #f59e0b;">\${p.name}</span>
            </div>
            <div class="card-desc">\${p.description}</div>
            <div style="font-size: 12px; color: var(--text-muted);">
              参数: \${(p.arguments || []).map(a => a.name + (a.required ? ' (必填)' : '')).join(', ') || '无'}
            </div>
          </div>
        \`;
      });
      document.getElementById('promptsList').innerHTML = html;
    }

    function renderAudits(records) {
      if (records.length === 0) {
        document.getElementById('auditListBody').innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">暂无调用流水</td></tr>';
        return;
      }
      let html = '';
      records.forEach((r, idx) => {
        const timeStr = r.timestamp ? r.timestamp.replace('T', ' ').substring(0, 19) : '';
        html += \`
          <tr>
            <td style="color: var(--text-muted); font-family: monospace;">\${timeStr}</td>
            <td style="font-family: monospace; color: #38bdf8;">\${r.traceId}</td>
            <td>\${r.clientName || 'AI Agent'}</td>
            <td style="font-weight: 600; color: #a5b4fc;">\${r.toolName}</td>
            <td>\${r.costMs}ms</td>
            <td>
              <span style="color: \${r.success ? '#10b981' : '#ef4444'}; font-weight: 600;">
                \${r.success ? '成功' : '失败'}
              </span>
            </td>
            <td>
              <button class="btn btn-outline" style="padding: 2px 8px; font-size: 11px;" onclick="openAuditDetail(\${idx})">
                查看快照
              </button>
            </td>
          </tr>
        \`;
      });
      document.getElementById('auditListBody').innerHTML = html;
    }

    function openAuditDetail(index) {
      const record = auditRecordsCache[index];
      if (!record) return;
      document.getElementById('auditArgs').innerText = JSON.stringify(record.args, null, 2);
      document.getElementById('auditResp').innerText = record.responseSnippet || record.errorMsg || '无返回内容';
      document.getElementById('auditDetailModal').classList.add('active');
    }

    function closeAuditModal() {
      document.getElementById('auditDetailModal').classList.remove('active');
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
        btn.innerText = '立即发起测试';
        btn.disabled = false;
        loadAudits();
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
