import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolMetadata, ToolChangeEvent } from '../types/tool.js';
import { toolStorage } from '../storage/toolStorage.js';
import { eventBus } from '../bus/eventBus.js';
import { GenericInvoker, ExecutionResult } from './invoker.js';

type ChangeListener = () => void;

export class DynamicToolRegistry {
  private listeners: Set<ChangeListener> = new Set();

  constructor() {
    // 监听事件总线（不管是本节点还是 Redis 接收到的其它节点事件）
    eventBus.on('tool_change', (event: ToolChangeEvent) => {
      console.log(`[Registry] 收到工具变更通知: 类型=${event.type}, 工具=${event.toolName || 'ALL'}`);
      // 重新从存储或缓存刷新
      toolStorage.reloadFromDisk();
      // 通知所有已连接的 MCP 会话广播 list_changed
      this.notifyListeners();
    });
  }

  /**
   * 注册监听器（当工具变化时回调）
   */
  public onToolsChanged(listener: ChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[Registry] 执行变更监听回调失败:', err);
      }
    }
  }

  /**
   * 注册或更新一个工具
   */
  public registerTool(meta: ToolMetadata): void {
    toolStorage.saveTool(meta);
    eventBus.emitToolChange({
      type: 'REGISTER',
      toolName: meta.toolName,
      timestamp: Date.now(),
    });
  }

  /**
   * 下线注销一个工具
   */
  public unregisterTool(toolName: string): boolean {
    const success = toolStorage.deleteTool(toolName);
    if (success) {
      eventBus.emitToolChange({
        type: 'UNREGISTER',
        toolName,
        timestamp: Date.now(),
      });
    }
    return success;
  }

  /**
   * 获取所有启用的工具，转换为 MCP 协议规范的标准 Tool 结构
   */
  public getMcpTools(): Tool[] {
    return toolStorage
      .listTools()
      .filter((t) => t.enabled)
      .map((t) => ({
        name: t.toolName,
        description: t.description,
        inputSchema: t.inputSchema as any,
      }));
  }

  /**
   * 获取工具详细元数据
   */
  public getToolMetadata(toolName: string): ToolMetadata | undefined {
    return toolStorage.getTool(toolName);
  }

  /**
   * 获取所有注册的工具元数据列表（供管理后台查询）
   */
  public getAllToolMetadata(): ToolMetadata[] {
    return toolStorage.listTools();
  }

  /**
   * 执行工具调用
   */
  public async executeTool(
    toolName: string,
    args: Record<string, any>,
    traceId: string,
    clientName: string = 'AI Agent',
    sessionId: string = 'default-session'
  ): Promise<ExecutionResult> {
    const meta = toolStorage.getTool(toolName);
    if (!meta) {
      return {
        content: [
          {
            type: 'text',
            text: `[未知工具] 工具 '${toolName}' 不存在或已被下线`,
          },
        ],
        isError: true,
      };
    }

    if (!meta.enabled) {
      return {
        content: [
          {
            type: 'text',
            text: `[工具已停用] 工具 '${toolName}' 当前已被管理员或系统禁用`,
          },
        ],
        isError: true,
      };
    }

    return await GenericInvoker.execute(meta, args, traceId, clientName, sessionId);
  }
}

export const dynamicToolRegistry = new DynamicToolRegistry();
