import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface AuditRecord {
  traceId: string;
  timestamp: string;
  clientName: string;
  toolName: string;
  args: Record<string, any>;
  costMs: number;
  success: boolean;
  responseSnippet?: string;
  errorMsg?: string;
}

export class AuditLogger {
  private filePath: string;
  private logs: AuditRecord[] = [];
  private readonly maxRecords = 1000;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = path.join(config.dataDir, 'audits.json');
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.logs = JSON.parse(raw);
        if (this.logs.length > this.maxRecords) {
          this.logs = this.logs.slice(-this.maxRecords);
        }
      }
    } catch (e: any) {
      console.warn(`[AuditLogger] 初始化审计日志失败: ${e.message}`);
    }
  }

  /**
   * 记录单次工具调用流水
   */
  public log(entry: Omit<AuditRecord, 'timestamp'>) {
    const record: AuditRecord = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    // 压入环形缓冲区头部
    this.logs.unshift(record);
    if (this.logs.length > this.maxRecords) {
      this.logs.pop();
    }

    // 防抖异步落盘（避免高频刷盘占用 I/O）
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.persist();
      }, 2000);
    }
  }

  private persist() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`[AuditLogger] 异步落盘审计流水失败: ${e.message}`);
    }
  }

  /**
   * 查询审计历史
   */
  public query(options?: { toolName?: string; success?: boolean; limit?: number }) {
    let result = this.logs;
    if (options?.toolName) {
      result = result.filter((r) => r.toolName.toLowerCase().includes(options.toolName!.toLowerCase()));
    }
    if (options?.success !== undefined) {
      result = result.filter((r) => r.success === options.success);
    }
    const limit = options?.limit || 100;
    return result.slice(0, limit);
  }
}

export const auditLogger = new AuditLogger();
