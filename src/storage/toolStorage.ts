import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { ToolMetadata } from '../types/tool.js';

export class ToolStorage {
  private filePath: string;
  private cache: Map<string, ToolMetadata> = new Map();

  constructor() {
    // 确保数据目录存在
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    this.filePath = path.join(config.dataDir, 'tools.json');
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: ToolMetadata[] = JSON.parse(raw);
        for (const item of list) {
          this.cache.set(item.toolName, item);
        }
        console.log(`[ToolStorage] 成功从磁盘加载 ${this.cache.size} 个工具元数据`);
      } else {
        // 创建初始空文件
        this.persist();
      }
    } catch (e: any) {
      console.error(`[ToolStorage] 读取持久化工具文件失败: ${e.message}`);
    }
  }

  private persist() {
    try {
      const list = Array.from(this.cache.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`[ToolStorage] 保存持久化工具文件失败: ${e.message}`);
    }
  }

  public reloadFromDisk(): Map<string, ToolMetadata> {
    this.cache.clear();
    this.init();
    return this.cache;
  }

  public saveTool(meta: ToolMetadata): void {
    meta.updatedAt = new Date().toISOString();
    this.cache.set(meta.toolName, meta);
    this.persist();
  }

  public deleteTool(toolName: string): boolean {
    const existed = this.cache.delete(toolName);
    if (existed) {
      this.persist();
    }
    return existed;
  }

  public getTool(toolName: string): ToolMetadata | undefined {
    return this.cache.get(toolName);
  }

  public listTools(): ToolMetadata[] {
    return Array.from(this.cache.values());
  }
}

export const toolStorage = new ToolStorage();
