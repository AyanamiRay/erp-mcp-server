import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { ToolChangeEvent } from '../types/tool.js';

export class ToolEventBus extends EventEmitter {
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
                  const event: ToolChangeEvent = JSON.parse(message);
                  // 触发本地 EventEmitter 事件
                  super.emit('tool_change', event);
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
   * 广播工具变更事件
   */
  public emitToolChange(event: ToolChangeEvent) {
    if (this.isRedisEnabled && this.pubClient) {
      this.pubClient.publish(config.redisChannel, JSON.stringify(event)).catch((err) => {
        console.error('[EventBus] 发布 Redis 变更消息失败:', err);
      });
    }
    // 本地触发
    super.emit('tool_change', event);
  }

  public async close() {
    if (this.pubClient) await this.pubClient.quit();
    if (this.subClient) await this.subClient.quit();
  }
}

export const eventBus = new ToolEventBus();
