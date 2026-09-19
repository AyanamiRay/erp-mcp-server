import crypto from 'crypto';

interface IdempotentEntry {
  createdAt: number;
  result: string;
}

export class IdempotencyGuard {
  private cache = new Map<string, IdempotentEntry>();
  // 5 秒内防重连点窗口 (毫秒)
  private readonly windowMs = 5000;

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
   * 检查是否在 5 秒内重复提交
   */
  public check(fingerprint: string): { duplicate: boolean; cachedResult?: string } {
    const entry = this.cache.get(fingerprint);
    if (!entry) {
      return { duplicate: false };
    }

    const now = Date.now();
    if (now - entry.createdAt < this.windowMs) {
      const remainingSec = ((this.windowMs - (now - entry.createdAt)) / 1000).toFixed(1);
      console.warn(`[IdempotencyGuard] 拦截到 5 秒内重复提交的单据 (指纹: ${fingerprint})，剩余保护时间: ${remainingSec}s`);
      return {
        duplicate: true,
        cachedResult: entry.result,
      };
    }

    // 超过 5 秒已失效
    this.cache.delete(fingerprint);
    return { duplicate: false };
  }

  /**
   * 记录创建成功的单据结果
   */
  public record(fingerprint: string, result: string): void {
    this.cache.set(fingerprint, {
      createdAt: Date.now(),
      result,
    });
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now - v.createdAt > this.windowMs) {
        this.cache.delete(k);
      }
    }
  }
}

export const idempotencyGuard = new IdempotencyGuard();
