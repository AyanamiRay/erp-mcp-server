import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Response } from 'express';
import { config } from '../config.js';
import { dynamicToolRegistry } from './registry.js';
import { circuitBreaker } from './breaker.js';
import { resourceRegistry } from './resources.js';
import { promptRegistry } from './prompts.js';
import { keyManager, ApiKeyProfile } from '../auth/keyManager.js';
import crypto from 'crypto';

export interface ActiveSession {
  sessionId: string;
  server: Server;
  transport: SSEServerTransport;
  connectedAt: Date;
  profile: ApiKeyProfile;
  cleanupListener: () => void;
}

export class McpSessionManager {
  private sessions = new Map<string, ActiveSession>();

  /**
   * 为新进来的 SSE 连接创建多租户会话 (集成 25s 心跳保活与 RBAC 隔离)
   */
  public async createSession(
    transport: SSEServerTransport,
    rawRes: Response,
    profile: ApiKeyProfile
  ): Promise<ActiveSession> {
    const sessionId = transport.sessionId;

    // 创建专属此连接的 MCP Server 实例
    const server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion,
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
      }
    );

    // 1. 处理 tools/list 请求 (依据客户端 profile 进行多租户权限过滤)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = dynamicToolRegistry.getAllToolMetadata();
      const clientTools = keyManager.filterToolsForClient(profile, allTools);
      return { tools: clientTools };
    });

    // 2. 处理 tools/call 请求 (权限校验 + 熔断防护 + 智能重试与审计)
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const traceId = crypto.randomUUID();

      console.log(`[Session:${sessionId}] [${profile.name}] [${traceId}] 发起工具调用: ${name}`);

      // 2.1 租户权限校验
      const meta = dynamicToolRegistry.getToolMetadata(name);
      if (meta && !keyManager.isToolAllowed(profile, meta)) {
        return {
          content: [
            {
              type: 'text',
              text: `[权限拒绝 403] 租户身份 '${profile.name}' 无权调用工具 '${name}'，请联系管理员分配权限。`,
            },
          ],
          isError: true,
        } as CallToolResult;
      }

      // 2.2 防死循环熔断防护检查
      const breakerCheck = circuitBreaker.checkAndRecord(sessionId, name);
      if (!breakerCheck.allowed) {
        return {
          content: [
            {
              type: 'text',
              text: breakerCheck.reason || '[系统熔断] 调用频次超限，已触发临时保护',
            },
          ],
          isError: true,
        } as CallToolResult;
      }

      // 2.3 执行工具调用 (带 clientName 审计)
      const result = await dynamicToolRegistry.executeTool(name, args || {}, traceId);
      return result as CallToolResult;
    });

    // 3. 处理 resources/list 请求 (业务字典)
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = resourceRegistry.listResources();
      return { resources };
    });

    // 4. 处理 resources/read 请求
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        const item = await resourceRegistry.readResource(uri);
        return {
          contents: [
            {
              uri: item.uri,
              mimeType: item.mimeType,
              text: item.text,
            },
          ],
        };
      } catch (err: any) {
        throw new McpError(ErrorCode.InvalidRequest, `读取资源失败: ${err.message}`);
      }
    });

    // 5. 处理 prompts/list 请求 (业务 SOP 模板)
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return { prompts: promptRegistry.listPrompts() };
    });

    // 6. 处理 prompts/get 请求
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: promptArgs } = request.params;
      const prompt = promptRegistry.getPrompt(name, promptArgs);
      if (!prompt) {
        throw new McpError(ErrorCode.InvalidRequest, `Prompt 模板 '${name}' 不存在`);
      }
      return {
        description: prompt.description,
        messages: prompt.messages,
      };
    });

    // 7. 启动 SSE 25s 自动心跳保活机制 (彻底杜绝云厂商网关 60s 掐断长连接)
    const heartbeatTimer = setInterval(() => {
      try {
        rawRes.write(': keepalive\n\n');
      } catch (e) {
        clearInterval(heartbeatTimer);
      }
    }, 25000);

    // 8. 监听全局工具热更新事件，向当前客户端推送通知
    const cleanupListener = dynamicToolRegistry.onToolsChanged(async () => {
      try {
        console.log(`[Session:${sessionId}] 向客户端推送 tools/list_changed 通知`);
        await server.sendToolListChanged();
      } catch (err: any) {
        console.warn(`[Session:${sessionId}] 推送 tools/list_changed 失败: ${err.message}`);
      }
    });

    const session: ActiveSession = {
      sessionId,
      server,
      transport,
      connectedAt: new Date(),
      profile,
      cleanupListener,
    };

    this.sessions.set(sessionId, session);

    // 连接断开时释放资源
    transport.onclose = () => {
      console.log(`[Session:${sessionId}] [${profile.name}] SSE 客户端已断开连接`);
      clearInterval(heartbeatTimer);
      cleanupListener();
      circuitBreaker.reset(sessionId);
      this.sessions.delete(sessionId);
    };

    // 关联连接并启动
    await server.connect(transport);

    console.log(`[Session:${sessionId}] 租户 '${profile.name}' 建立 MCP 会话，当前在线连接数: ${this.sessions.size}`);
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
