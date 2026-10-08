import { EventEmitter } from 'events';
import crypto from 'crypto';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { ToolChangeEvent, ToolMetadata } from '../types/tool.js';

export interface ResourceChangeEvent {
  type: 'REGISTER' | 'UNREGISTER';
  uri: string;
  nodeId?: string;
  timestamp: number;
}

export interface PromptChangeEvent {
  type: 'REGISTER' | 'UNREGISTER';
  name: string;
  nodeId?: string;
  timestamp: number;
}

export class ToolEventBus extends EventEmitter {
  public readonly nodeId: string = crypto.randomUUID();
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private isRedisEnabled = false;

  constructor() {
    super();
    this.initRedis();
  }

  private initRedis() {
    if (config.redisUrl) {
      try {
        this.pubClient = new Redis(config.redisUrl, { lazyConnect: true });
        this.subClient = new Redis(config.redisUrl, { lazyConnect: true });

        Promise.all([this.pubClient.connect(), this.subClient.connect()])
          .then(() => {
            this.isRedisEnabled = true;
            console.log(`[EventBus] Redis Pub/Sub 已连接，启用集群广播模式，频道: ${config.redisChannel}`);

            this.subClient?.subscribe(config.redisChannel, (err) => {
              if (err) {
                console.error('[EventBus] Redis subscribe error:', err);
              }
            });

            this.subClient?.on('message', (channel, message) => {
              if (channel === config.redisChannel) {
                try {
                  const data = JSON.parse(message);

                  // 关键：忽略本节点自己发布的事件，杜绝重复触发
                  if (data.nodeId && data.nodeId === this.nodeId) {
                    return;
                  }

                  if (data.channelType === 'resource') {
                    super.emit('resource_change', data);
                  } else if (data.channelType === 'prompt') {
                    super.emit('prompt_change', data);
                  } else {
                    // 默认当作工具变更事件
                    super.emit('tool_change', data as ToolChangeEvent);
                  }
                } catch (e) {
                  console.error('[EventBus] Failed to parse Redis message:', e);
                }
              }
            });
          })
          .catch((err) => {
            console.warn('[EventBus] Redis 连接失败，降级为单机内存 EventEmitter 模式:', err.message);
            this.isRedisEnabled = false;
          });
      } catch (err: any) {
        console.warn('[EventBus] 初始化 Redis 失败，降级为单机模式:', err.message);
        this.isRedisEnabled = false;
      }
    } else {
      console.log('[EventBus] 未配置 REDIS_URL，运行在单机内存 EventEmitter 模式');
    }
  }

  /**
   * 广播工具变更事件 (携带当前节点 ID 与元数据 Payload)
   */
  public emitToolChange(event: ToolChangeEvent) {
    event.nodeId = this.nodeId;
    if (this.isRedisEnabled && this.pubClient) {
      this.pubClient.publish(config.redisChannel, JSON.stringify(event)).catch((err) => {
        console.error('[EventBus] 发布 Redis 变更消息失败:', err);
      });
    }
    // 本地立即触发一次
    super.emit('tool_change', event);
  }

  /**
   * 广播资源变更事件
   */
  public emitResourceChange(event: ResourceChangeEvent) {
    event.nodeId = this.nodeId;
    const payload = { ...event, channelType: 'resource' };
    if (this.isRedisEnabled && this.pubClient) {
      this.pubClient.publish(config.redisChannel, JSON.stringify(payload)).catch((err) => {
        console.error('[EventBus] 发布 Redis 资源变更消息失败:', err);
      });
    }
    super.emit('resource_change', event);
  }

  /**
   * 广播 Prompt SOP 变更事件
   */
  public emitPromptChange(event: PromptChangeEvent) {
    event.nodeId = this.nodeId;
    const payload = { ...event, channelType: 'prompt' };
    if (this.isRedisEnabled && this.pubClient) {
      this.pubClient.publish(config.redisChannel, JSON.stringify(payload)).catch((err) => {
        console.error('[EventBus] 发布 Redis Prompt 变更消息失败:', err);
      });
    }
    super.emit('prompt_change', event);
  }

  public async close() {
    if (this.pubClient) await this.pubClient.quit();
    if (this.subClient) await this.subClient.quit();
  }
}

export const eventBus = new ToolEventBus();
