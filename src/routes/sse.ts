import { Router, Request, Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { sessionManager } from '../mcp/server.js';
import { config } from '../config.js';

export const sseRouter = Router();

// 鉴权中间件辅助函数
function authenticateRequest(req: Request): boolean {
  if (!config.apiKey) return true; // 未配置密钥则免鉴权

  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;

  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;
  return token === config.apiKey;
}

/**
 * GET /sse
 * 客户端建立 SSE 长连接的端点
 */
sseRouter.get('/sse', async (req: Request, res: Response) => {
  if (!authenticateRequest(req)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }

  try {
    // 创建 SSE 传输通道，指定客户端发送消息的 POST 端点为 /messages
    const transport = new SSEServerTransport('/messages', res);
    await sessionManager.createSession(transport);
  } catch (err: any) {
    console.error('[SSE] 建立长连接失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to establish SSE session' });
    }
  }
});

/**
 * POST /messages
 * 客户端向已建立的会话发送 JSON-RPC 消息或工具调用的端点
 */
sseRouter.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    res.status(400).json({ error: 'Missing required query parameter: sessionId' });
    return;
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: `Session '${sessionId}' not found or already closed` });
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err: any) {
    console.error(`[SSE] 处理 Session '${sessionId}' 消息失败:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal error processing message' });
    }
  }
});
