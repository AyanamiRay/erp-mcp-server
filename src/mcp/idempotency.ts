import crypto from 'crypto';

export type IdempotentStatus = 'PENDING' | 'COMPLETED';

interface IdempotentEntry {
  createdAt: number;
  status: IdempotentStatus;
  result?: string;
}

export class IdempotencyGuard {
  private cache = new Map<string, IdempotentEntry>();
  // 5 秒内防重连点窗口 (毫秒)
  private readonly windowMs = 5000;
  // 处理中并发锁最大超时时间 (毫秒)，防止下游无响应死锁
  private readonly inFlightTimeoutMs = 15000;

  constructor() {
    // 每隔 10 秒清理过期记录
    setInterval(() => this.cleanupExpired(), 10000).unref();
  }

  /**
   * 生成单据业务防重唯一指纹
   */
  public generateFingerprint(sessionId: string, toolName: string, args: Record<string, any>): string {
    // 排除与业务数据无关的追踪或非关键字段（如 dryRun 等）
    const cleanArgs = { ...args };
    delete cleanArgs.dryRun;

    const sortedKeys = Object.keys(cleanArgs).sort();
    const sortedObj: Record<string, any> = {};
    for (const k of sortedKeys) {
      sortedObj[k] = cleanArgs[k];
    }
    const hash = crypto.createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex').substring(0, 16);
    return `${sessionId}:${toolName}:${hash}`;
  }

  /**
   * 尝试获取幂等执行锁 (原子操作，防毫秒级并发竞争击穿)
   */
  public acquire(fingerprint: string): { allowed: boolean; status?: IdempotentStatus; cachedResult?: string } {
    const entry = this.cache.get(fingerprint);
    const now = Date.now();

    if (entry) {
      if (entry.status === 'PENDING') {
        if (now - entry.createdAt < this.inFlightTimeoutMs) {
          console.warn(`[IdempotencyGuard] 拦截到并发正在提交的重复请求 (指纹: ${fingerprint})`);
          return {
            allowed: false,
            status: 'PENDING',
          };
        }
      } else if (entry.status === 'COMPLETED') {
        if (now - entry.createdAt < this.windowMs) {
          const remainingSec = ((this.windowMs - (now - entry.createdAt)) / 1000).toFixed(1);
          console.warn(`[IdempotencyGuard] 拦截到 5 秒内重复提交的单据 (指纹: ${fingerprint})，剩余保护时间: ${remainingSec}s`);
          return {
            allowed: false,
            status: 'COMPLETED',
            cachedResult: entry.result,
          };
        }
      }
    }

    // 成功获取锁，标记为执行中
    this.cache.set(fingerprint, {
      createdAt: now,
      status: 'PENDING',
    });

    return { allowed: true };
  }

  /**
   * 记录创建成功的单据结果，由 PENDING 转为 COMPLETED
   */
  public resolve(fingerprint: string, result: string): void {
    this.cache.set(fingerprint, {
      createdAt: Date.now(),
      status: 'COMPLETED',
      result,
    });
  }

  /**
   * 释放锁（调用失败或异常时主动释放，允许客户端重试）
   */
  public release(fingerprint: string): void {
    this.cache.delete(fingerprint);
  }

  /**
   * 兼容原有 check 方法
   */
  public check(fingerprint: string): { duplicate: boolean; cachedResult?: string } {
    const entry = this.cache.get(fingerprint);
    if (!entry) {
      return { duplicate: false };
    }

    const now = Date.now();
    if (entry.status === 'COMPLETED' && now - entry.createdAt < this.windowMs) {
      return {
        duplicate: true,
        cachedResult: entry.result,
      };
    }

    if (entry.status === 'PENDING' && now - entry.createdAt < this.inFlightTimeoutMs) {
      return {
        duplicate: true,
        cachedResult: undefined,
      };
    }

    this.cache.delete(fingerprint);
    return { duplicate: false };
  }

  /**
   * 兼容原有 record 方法
   */
  public record(fingerprint: string, result: string): void {
    this.resolve(fingerprint, result);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (v.status === 'COMPLETED' && now - v.createdAt > this.windowMs) {
        this.cache.delete(k);
      } else if (v.status === 'PENDING' && now - v.createdAt > this.inFlightTimeoutMs) {
        this.cache.delete(k);
      }
    }
  }
}

export const idempotencyGuard = new IdempotencyGuard();
