/**
 * 会话级调用频次熔断器 (Circuit Breaker)
 * 防止大模型在 Agent 推理过程中陷入死循环高频刷爆下游 ERP 接口
 */

interface BreakerState {
  timestamps: number[];
  trippedUntil: number; // 熔断冷静期截至时间戳 (0 代表未熔断)
}

export class ToolCircuitBreaker {
  private states = new Map<string, BreakerState>();

  // 滑动时间窗口大小 (默认 60 秒)
  private readonly windowMs: number;
  // 时间窗口内最大允许调用次数 (默认 8 次)
  private readonly maxCallsPerWindow: number;
  // 触发熔断后的冷静期持续时间 (默认 30 秒)
  private readonly coolDownMs: number;

  constructor(options?: {
    windowMs?: number;
    maxCallsPerWindow?: number;
    coolDownMs?: number;
  }) {
    this.windowMs = options?.windowMs ?? 60000;
    this.maxCallsPerWindow = options?.maxCallsPerWindow ?? 8;
    this.coolDownMs = options?.coolDownMs ?? 30000;

    // 每隔 5 分钟自动清理过期的会话状态，防止内存泄漏
    setInterval(() => this.cleanupExpired(), 300000).unref();
  }

  /**
   * 检查是否允许调用，若触发熔断则抛出异常说明
   * @param sessionId 客户端会话唯一 ID
   * @param toolName 被调用的工具名
   * @returns { allowed: boolean, reason?: string }
   */
  public checkAndRecord(sessionId: string, toolName: string): { allowed: boolean; reason?: string } {
    const key = `${sessionId}:${toolName}`;
    const now = Date.now();

    let state = this.states.get(key);
    if (!state) {
      state = { timestamps: [], trippedUntil: 0 };
      this.states.set(key, state);
    }

    // 1. 检查是否正处于熔断冷静期
    if (state.trippedUntil > now) {
      const remainingSec = Math.ceil((state.trippedUntil - now) / 1000);
      return {
        allowed: false,
        reason: `[系统防护熔断] 工具 '${toolName}' 在短时间内调用过于频繁（可能已陷入死循环）。系统已启用保护机制，剩余冷静期 ${remainingSec} 秒。请暂停重复调用，整理已知信息向用户汇报或尝试其它方案。`,
      };
    }

    // 2. 清理滑动窗口之外的历史时间戳
    state.timestamps = state.timestamps.filter((t) => now - t < this.windowMs);

    // 3. 记录本次调用
    state.timestamps.push(now);

    // 4. 判断是否超过阈值
    if (state.timestamps.length > this.maxCallsPerWindow) {
      state.trippedUntil = now + this.coolDownMs;
      console.warn(`[CircuitBreaker] 会话 ${sessionId} 对工具 ${toolName} 触发熔断保护，进入 ${this.coolDownMs / 1000}s 冷却期`);

      return {
        allowed: false,
        reason: `[系统防护熔断] 检测到你在过去 ${this.windowMs / 1000} 秒内对工具 '${toolName}' 连续调用了 ${state.timestamps.length} 次，超过安全阈值。为了防止业务系统过载，已触发熔断保护，请重新梳理思路或向用户寻求进一步指引。`,
      };
    }

    return { allowed: true };
  }

  /**
   * 手动重置某个会话的熔断状态
   */
  public reset(sessionId: string, toolName?: string) {
    if (toolName) {
      this.states.delete(`${sessionId}:${toolName}`);
    } else {
      for (const key of this.states.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          this.states.delete(key);
        }
      }
    }
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, state] of this.states.entries()) {
      if (state.trippedUntil < now && state.timestamps.every((t) => now - t > this.windowMs)) {
        this.states.delete(key);
      }
    }
  }
}

export const circuitBreaker = new ToolCircuitBreaker();
