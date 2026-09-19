import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

export interface PromptMetadata {
  name: string;
  description: string;
  arguments?: PromptArgument[];
  messages: PromptMessage[];
  updatedAt?: string;
}

export class PromptRegistry {
  private filePath: string;
  private cache = new Map<string, PromptMetadata>();

  constructor() {
    this.filePath = path.join(config.dataDir, 'prompts.json');
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: PromptMetadata[] = JSON.parse(raw);
        for (const item of list) {
          this.cache.set(item.name, item);
        }
      } else {
        // 内置预设企业级 ERP 业务专家 SOP 模板
        const defaultPrompts: PromptMetadata[] = [
          {
            name: 'erp_inventory_reconciliation',
            description: '月末仓库物料盘点与账实核对专家级标准作业程序 (SOP)',
            arguments: [
              { name: 'warehouseId', description: '待盘点的仓库编码', required: true },
              { name: 'category', description: '物料分类 (可选)' },
            ],
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `你现在是资深 ERP 供应链审计专家。请按照以下步骤协助用户对仓库进行月末盘点核对：
1. 首先调用 'query_erp_inventory' 工具，获取目标仓库中所有指定类别的账面库存数据；
2. 检查是否有处于 '锁定' 或 '在途发货' 状态的差异数量，并列出清单；
3. 输出结构化的《月末账实核对与盈亏分析报告》，包含：物料名称、账面数量、实盘数量、差异原因推断及后续调账建议。`,
                },
              },
            ],
            updatedAt: new Date().toISOString(),
          },
          {
            name: 'erp_order_anomaly_investigation',
            description: '异常卡单与逾期未履约销售订单的深度排查追踪 SOP',
            arguments: [
              { name: 'orderNo', description: '待排查的异常订单编号', required: true },
            ],
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `请作为 ERP 订单履约排查专家，按顺序排查订单执行受阻的原因：
1. 调用相关订单工具查询该订单的当前状态、支付时间与承诺交期；
2. 读取 'erp://dict/order_status' 业务字典，核对该状态的流转前置条件；
3. 分析导致订单停滞在当前状态的根本原因（如：缺料、财务未审、物流未揽收）；
4. 为业务员生成一份行动建议清单（催办哪个部门、预计处理工时）。`,
                },
              },
            ],
            updatedAt: new Date().toISOString(),
          },
        ];
        for (const p of defaultPrompts) {
          this.cache.set(p.name, p);
        }
        this.persist();
      }
    } catch (e: any) {
      console.error(`[PromptRegistry] 加载 prompts.json 失败: ${e.message}`);
    }
  }

  private persist() {
    try {
      const list = Array.from(this.cache.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`[PromptRegistry] 持久化 prompts.json 失败: ${e.message}`);
    }
  }

  public listPrompts() {
    return Array.from(this.cache.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
  }

  public getPrompt(name: string, args?: Record<string, any>): PromptMetadata | undefined {
    const template = this.cache.get(name);
    if (!template) return undefined;

    // 如果传入了参数，渲染模板中的变量
    if (args && Object.keys(args).length > 0) {
      const renderedMessages: PromptMessage[] = template.messages.map((m) => {
        let text = m.content.text;
        for (const [k, v] of Object.entries(args)) {
          text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
        return {
          role: m.role,
          content: { type: 'text', text },
        };
      });
      return { ...template, messages: renderedMessages };
    }

    return template;
  }
}

export const promptRegistry = new PromptRegistry();
