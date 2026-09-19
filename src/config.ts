import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // 服务端口
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  // 安全 API 密钥（客户端鉴权与 Admin 管理端鉴权）
  apiKey: process.env.MCP_API_KEY || 'default-mcp-secret-key-change-in-production',

  // 数据持久化目录（存储动态工具元数据 json）
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),

  // Redis 配置（可选。如果配置了，用于多副本节点间的事件广播与状态共享）
  redisUrl: process.env.REDIS_URL || '',
  redisChannel: process.env.REDIS_CHANNEL || 'mcp:tool_events',

  // 默认调用 ERP 接口的超时时间 (ms)
  defaultTimeoutMs: parseInt(process.env.DEFAULT_TIMEOUT_MS || '5000', 10),

  // 服务名称与版本
  serverName: process.env.MCP_SERVER_NAME || 'enterprise-erp-mcp',
  serverVersion: process.env.MCP_SERVER_VERSION || '1.0.0',
};
