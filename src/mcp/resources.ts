import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from '../config.js';

export interface ResourceMetadata {
  /** 资源唯一 URI，必须符合 URI 格式，如 erp://dict/warehouses */
  uri: string;
  /** 资源可读名称 */
  name: string;
  /** 资源说明，模型可通过说明判断是否需要读取 */
  description: string;
  /** 内容类型，通常为 application/json 或 text/plain */
  mimeType?: string;
  /** 静态内容 (如果配置了直接返回) */
  content?: string;
  /** 动态 ERP 获取地址 (如果配置，读取时动态向 ERP 获取最新字典) */
  fetchUrl?: string;
  /** 最后更新时间 */
  updatedAt?: string;
}

export class ResourceRegistry {
  private filePath: string;
  private cache = new Map<string, ResourceMetadata>();

  constructor() {
    this.filePath = path.join(config.dataDir, 'resources.json');
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: ResourceMetadata[] = JSON.parse(raw);
        for (const item of list) {
          this.cache.set(item.uri, item);
        }
        console.log(`[ResourceRegistry] 成功加载 ${this.cache.size} 个业务字典资源`);
      } else {
        // 创建初始内置基础字典示例
        const defaultResources: ResourceMetadata[] = [
          {
            uri: 'erp://dict/order_status',
            name: 'ERP 订单状态枚举字典',
            description: '定义 ERP 系统中销售订单和采购单的标准状态码与中文业务含义对照表',
            mimeType: 'application/json',
            content: JSON.stringify(
              {
                DRAFT: { code: '10', desc: '草稿未提交', editable: true },
                PENDING_APPROVAL: { code: '20', desc: '待财务审批', editable: false },
                APPROVED: { code: '30', desc: '审批通过，待出库', editable: false },
                SHIPPED: { code: '40', desc: '已全部发货', editable: false },
                FINISHED: { code: '50', desc: '已完成对账核销', editable: false },
                CANCELLED: { code: '99', desc: '已作废', editable: false },
              },
              null,
              2
            ),
            updatedAt: new Date().toISOString(),
          },
        ];
        for (const r of defaultResources) {
          this.cache.set(r.uri, r);
        }
        this.persist();
      }
    } catch (e: any) {
      console.error(`[ResourceRegistry] 读取持久化资源文件失败: ${e.message}`);
    }
  }

  private persist() {
    try {
      const list = Array.from(this.cache.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`[ResourceRegistry] 保存持久化资源文件失败: ${e.message}`);
    }
  }

  public registerResource(res: ResourceMetadata) {
    res.updatedAt = new Date().toISOString();
    this.cache.set(res.uri, res);
    this.persist();
  }

  public unregisterResource(uri: string): boolean {
    const existed = this.cache.delete(uri);
    if (existed) this.persist();
    return existed;
  }

  public listResources() {
    return Array.from(this.cache.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType || 'application/json',
    }));
  }

  public async readResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
    const res = this.cache.get(uri);
    if (!res) {
      throw new Error(`Resource '${uri}' not found`);
    }

    let textContent = res.content || '';

    // 如果配置了动态获取 URL
    if (res.fetchUrl) {
      try {
        const resp = await axios.get(res.fetchUrl, { timeout: 4000 });
        textContent = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2);
      } catch (err: any) {
        textContent = JSON.stringify({ error: `动态获取 ERP 字典失败: ${err.message}` });
      }
    }

    return {
      uri: res.uri,
      mimeType: res.mimeType || 'application/json',
      text: textContent,
    };
  }
}

export const resourceRegistry = new ResourceRegistry();
