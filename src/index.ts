import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { sseRouter } from './routes/sse.js';
import { adminRouter } from './routes/admin.js';
import { healthRouter } from './routes/health.js';
import { dashboardRouter } from './routes/dashboard.js';
import { sessionManager } from './mcp/server.js';
import { eventBus } from './bus/eventBus.js';

const app = express();

// 基础中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 请求访问日志中间件（排除健康检查以减少日志刷屏）
app.use((req, res, next) => {
  if (req.path !== '/healthz') {
    console.log(`[HTTP] ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
  }
  next();
});

// 挂载核心路由
app.use('/', sseRouter);              // /sse, /messages
app.use('/admin', adminRouter);       // /admin/tools/*, /admin/resources/*
app.use('/', healthRouter);           // /healthz, /status
app.use('/', dashboardRouter);        // /dashboard (内置 Web 控制台)

// 全局 404
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// 全局错误兜底
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server] Unhandled Error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 启动 HTTP 服务
const server = app.listen(config.port, config.host, () => {
  console.log('====================================================');
  console.log(`🚀 ${config.serverName} (v${config.serverVersion}) 启动成功!`);
  console.log(`📍 监听地址: http://${config.host}:${config.port}`);
  console.log(`🔗 SSE 端点: http://${config.host}:${config.port}/sse`);
  console.log(`🛠️ 管理端点: http://${config.host}:${config.port}/admin/tools`);
  console.log(`📊 可视化控制台: http://${config.host}:${config.port}/dashboard`);
  console.log(`💓 探活端点: http://${config.host}:${config.port}/healthz`);
  console.log('====================================================');
});

// 优雅停机信号处理
async function gracefulShutdown(signal: string) {
  console.log(`\n[Shutdown] 接收到 ${signal} 信号，准备优雅停机...`);

  // 1. 停止接收新的 HTTP 连接
  server.close(async () => {
    console.log('[Shutdown] HTTP 服务已停止接收新请求');

    // 2. 平滑断开所有活跃的 MCP 长连接
    try {
      await sessionManager.closeAll();
      console.log('[Shutdown] 所有活跃 MCP 会话已平滑关闭');
    } catch (e: any) {
      console.error('[Shutdown] 关闭 MCP 会话时出错:', e.message);
    }

    // 3. 关闭 Redis 连接
    try {
      await eventBus.close();
      console.log('[Shutdown] 事件总线已释放');
    } catch (e: any) {
      console.error('[Shutdown] 释放事件总线时出错:', e.message);
    }

    console.log('[Shutdown] 服务已安全退出 👋');
    process.exit(0);
  });

  // 超时强制退出保险（10秒）
  setTimeout(() => {
    console.error('[Shutdown] 停机超时 (10s)，强制退出');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 全局未捕获异常守护
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled Rejection:', reason);
});
