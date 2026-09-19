import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { config } from '../config.js';
import { dynamicToolRegistry } from './registry.js';
import crypto from 'crypto';

export interface ActiveSession {
  sessionId: string;
  server: Server;
  transport: SSEServerTransport;
  connectedAt: Date;
  cleanupListener: () => void;
}

export class McpSessionManager {
  private sessions = new Map<string, ActiveSession>();

  /**
   * 为新进来的 SSE 连接创建会话
   */
  public async createSession(transport: SSEServerTransport): Promise<ActiveSession> {
    const sessionId = transport.sessionId;

    // 创建专属此连接的 MCP Server 实例
    const server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion,
      },
      {
        capabilities: {
          tools: {
            listChanged: true, // 声明支持动态工具变更通知
          },
        },
      }
    );

    // 1. 处理 tools/list 请求
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = dynamicToolRegistry.getMcpTools();
      return { tools };
    });

    // 2. 处理 tools/call 请求
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const traceId = crypto.randomUUID();

      console.log(`[Session:${sessionId}] [${traceId}] 收到工具调用请求: ${name}`);

      const result = await dynamicToolRegistry.executeTool(name, args || {}, traceId);
      return result as CallToolResult;
    });

    // 3. 监听全局工具热更新事件，向当前客户端推送通知
    const cleanupListener = dynamicToolRegistry.onToolsChanged(async () => {
      try {
        console.log(`[Session:${sessionId}] 向客户端推送 tools/list_changed 通知`);
        await server.sendToolListChanged();
      } catch (err: any) {
        console.warn(`[Session:${sessionId}] 推送 tools/list_changed 失败 (可能客户端已断开): ${err.message}`);
      }
    });

    const session: ActiveSession = {
      sessionId,
      server,
      transport,
      connectedAt: new Date(),
      cleanupListener,
    };

    this.sessions.set(sessionId, session);

    // 连接断开时释放资源
    transport.onclose = () => {
      console.log(`[Session:${sessionId}] SSE 客户端已断开连接`);
      cleanupListener();
      this.sessions.delete(sessionId);
    };

    // 关联连接并启动
    await server.connect(transport);

    console.log(`[Session:${sessionId}] 客户端已成功建立 MCP 会话，当前在线连接数: ${this.sessions.size}`);
    return session;
  }

  public getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getActiveCount(): number {
    return this.sessions.size;
  }

  public async closeAll(): Promise<void> {
    for (const [id, session] of this.sessions.entries()) {
      try {
        session.cleanupListener();
        await session.transport.close();
      } catch (e) {
        // ignore
      }
    }
    this.sessions.clear();
  }
}

export const sessionManager = new McpSessionManager();
