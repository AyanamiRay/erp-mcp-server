import crypto from 'crypto';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LruCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;

    // 每 2 分钟清理一次过期项
    setInterval(() => this.cleanupExpired(), 120000).unref();
  }

  /**
   * 生成规范化缓存 Key
   */
  public static generateKey(toolName: string, args: Record<string, any>): string {
    // 对参数属性进行字母排序后序列化，保证相同参数顺序不同时生成相同哈希
    const sortedKeys = Object.keys(args || {}).sort();
    const sortedObj: Record<string, any> = {};
    for (const k of sortedKeys) {
      sortedObj[k] = args[k];
    }
    const hash = crypto.createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex').substring(0, 16);
    return `${toolName}:${hash}`;
  }

  public get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // 刷新 LRU 顺序 (删除后重新插入)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  public set(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;

    // 如果已满，剔除最老的数据 (Map 的第一个元素)
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public delete(key: string): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

export const toolLruCache = new LruCache<any>(500);
