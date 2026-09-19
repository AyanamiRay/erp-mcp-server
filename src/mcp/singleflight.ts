/**
 * 并发请求合并去重器 (Singleflight)
 * 当多个并发请求同时调用同一个慢接口时，仅向底层下游发起 1 次调用，并共享返回结果
 */

export class Singleflight {
  private inFlight = new Map<string, Promise<any>>();

  /**
   * 执行或合并并发任务
   * @param key 任务唯一标识 (如 toolName + argsHash)
   * @param fn 实际执行的异步任务函数
   */
  public async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      console.log(`[Singleflight] 命中正在执行中的并发任务: ${key}，直接共享执行结果`);
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const singleflight = new Singleflight();
