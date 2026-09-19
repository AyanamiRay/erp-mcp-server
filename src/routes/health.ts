import { Router, Request, Response } from 'express';
import { sessionManager } from '../mcp/server.js';
import { dynamicToolRegistry } from '../mcp/registry.js';
import { config } from '../config.js';

export const healthRouter = Router();

/**
 * GET /healthz
 * 轻量探活端点（适用于 Kubernetes Liveness/Readiness 探针与 Nginx 负载均衡健康检查）
 */
healthRouter.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    activeSessions: sessionManager.getActiveCount(),
    registeredTools: dynamicToolRegistry.getMcpTools().length,
  });
});

/**
 * GET /status
 * 详细服务信息
 */
healthRouter.get('/status', (_req: Request, res: Response) => {
  const memory = process.memoryUsage();
  res.json({
    serverName: config.serverName,
    serverVersion: config.serverVersion,
    nodeVersion: process.version,
    activeSessions: sessionManager.getActiveCount(),
    registeredToolsCount: dynamicToolRegistry.getMcpTools().length,
    tools: dynamicToolRegistry.getMcpTools().map((t) => t.name),
    memory: {
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    },
  });
});
