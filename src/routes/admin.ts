import { Router, Request, Response } from 'express';
import { dynamicToolRegistry } from '../mcp/registry.js';
import { resourceRegistry, ResourceMetadata } from '../mcp/resources.js';
import { ToolMetadata } from '../types/tool.js';
import { config } from '../config.js';
import crypto from 'crypto';

export const adminRouter = Router();

// 鉴权中间件（放行 query token 便于前端控制台通过 URL 参数鉴权）
function adminAuth(req: Request, res: Response, next: () => void) {
  if (!config.apiKey) return next();

  const apiKeyHeader = req.headers['x-api-key'] || req.headers.authorization;
  const queryToken = req.query.token as string | undefined;

  const token = typeof apiKeyHeader === 'string' && apiKeyHeader.startsWith('Bearer ')
    ? apiKeyHeader.substring(7)
    : (apiKeyHeader as string) || queryToken;

  if (token !== config.apiKey) {
    res.status(401).json({ success: false, message: 'Unauthorized: Invalid Admin API Key' });
    return;
  }
  next();
}

adminRouter.use(adminAuth);

// ==========================================
// Tools 工具管理
// ==========================================

/**
 * GET /admin/tools
 * 获取当前所有注册的工具元数据列表
 */
adminRouter.get('/tools', (req: Request, res: Response) => {
  const list = dynamicToolRegistry.getAllToolMetadata();
  res.json({ success: true, count: list.length, data: list });
});

/**
 * GET /admin/tools/:toolName
 * 获取单个工具的详情
 */
adminRouter.get('/tools/:toolName', (req: Request, res: Response) => {
  const tool = dynamicToolRegistry.getToolMetadata(req.params.toolName);
  if (!tool) {
    res.status(404).json({ success: false, message: `Tool '${req.params.toolName}' not found` });
    return;
  }
  res.json({ success: true, data: tool });
});

/**
 * POST /admin/tools/register
 * 注册或更新单个工具元数据（热插拔核心端点）
 */
adminRouter.post('/tools/register', (req: Request, res: Response) => {
  const meta = req.body as ToolMetadata;

  if (!meta || !meta.toolName || !meta.description || !meta.invocation || !meta.invocation.url) {
    res.status(400).json({
      success: false,
      message: '缺少必填字段: toolName, description, invocation.url 均为必填项',
    });
    return;
  }

  if (meta.enabled === undefined) meta.enabled = true;
  if (!meta.inputSchema) meta.inputSchema = { type: 'object', properties: {} };

  dynamicToolRegistry.registerTool(meta);
  console.log(`[Admin] 动态注册/更新工具成功: ${meta.toolName} (URL: ${meta.invocation.url})`);

  res.json({
    success: true,
    message: `工具 '${meta.toolName}' 注册成功，已向所有活跃 AI 客户端广播更新`,
    data: meta,
  });
});

/**
 * POST /admin/tools/batch
 * 批量注册工具（专供 Spring Boot 启动就绪时全量同步）
 */
adminRouter.post('/tools/batch', (req: Request, res: Response) => {
  const tools = req.body.tools as ToolMetadata[];

  if (!Array.isArray(tools) || tools.length === 0) {
    res.status(400).json({ success: false, message: '请求体必须包含非空的 tools 数组' });
    return;
  }

  let count = 0;
  for (const meta of tools) {
    if (meta.toolName && meta.invocation?.url) {
      if (meta.enabled === undefined) meta.enabled = true;
      dynamicToolRegistry.registerTool(meta);
      count++;
    }
  }

  res.json({
    success: true,
    message: `成功批量注册 ${count} 个工具，已触发广播`,
  });
});

/**
 * DELETE /admin/tools/:toolName
 * 下线注销工具
 */
adminRouter.delete('/tools/:toolName', (req: Request, res: Response) => {
  const { toolName } = req.params;
  const existed = dynamicToolRegistry.unregisterTool(toolName);

  if (!existed) {
    res.status(404).json({ success: false, message: `工具 '${toolName}' 不存在` });
    return;
  }

  console.log(`[Admin] 工具下线成功: ${toolName}`);
  res.json({
    success: true,
    message: `工具 '${toolName}' 已下线，已通知所有客户端移除该能力`,
  });
});

/**
 * PATCH /admin/tools/:toolName/toggle
 * 快速启用/禁用工具
 */
adminRouter.patch('/tools/:toolName/toggle', (req: Request, res: Response) => {
  const { toolName } = req.params;
  const tool = dynamicToolRegistry.getToolMetadata(toolName);

  if (!tool) {
    res.status(404).json({ success: false, message: `工具 '${toolName}' 不存在` });
    return;
  }

  tool.enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : !tool.enabled;
  dynamicToolRegistry.registerTool(tool);

  res.json({
    success: true,
    message: `工具 '${toolName}' 状态已变更为: ${tool.enabled ? '启用' : '禁用'}`,
    data: tool,
  });
});

/**
 * POST /admin/tools/:toolName/test
 * 在线自测接口（供 Web 控制台或开发者无需通过大模型直接调试后端 ERP 接口）
 */
adminRouter.post('/tools/:toolName/test', async (req: Request, res: Response) => {
  const { toolName } = req.params;
  const args = req.body || {};
  const traceId = `test-${crypto.randomUUID().substring(0, 8)}`;

  const startTime = Date.now();
  const result = await dynamicToolRegistry.executeTool(toolName, args, traceId);
  const costMs = Date.now() - startTime;

  res.json({
    success: !result.isError,
    traceId,
    costMs,
    result,
  });
});

// ==========================================
// Resources 业务字典管理
// ==========================================

/**
 * GET /admin/resources
 * 获取当前所有注册的业务字典资源
 */
adminRouter.get('/resources', (_req: Request, res: Response) => {
  const list = resourceRegistry.listResources();
  res.json({ success: true, count: list.length, data: list });
});

/**
 * POST /admin/resources
 * 注册业务字典元数据
 */
adminRouter.post('/resources', (req: Request, res: Response) => {
  const meta = req.body as ResourceMetadata;
  if (!meta.uri || !meta.name || !meta.description) {
    res.status(400).json({ success: false, message: 'uri, name, description 为必填项' });
    return;
  }

  resourceRegistry.registerResource(meta);
  res.json({ success: true, message: `字典资源 '${meta.name}' 注册成功`, data: meta });
});

/**
 * DELETE /admin/resources
 * 删除业务字典
 */
adminRouter.delete('/resources', (req: Request, res: Response) => {
  const uri = req.query.uri as string;
  if (!uri) {
    res.status(400).json({ success: false, message: '缺少 query 参数: uri' });
    return;
  }

  const deleted = resourceRegistry.unregisterResource(uri);
  res.json({ success: deleted, message: deleted ? `资源 '${uri}' 已移除` : '资源不存在' });
});
