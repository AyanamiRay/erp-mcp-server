import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolMetadata } from '../types/tool.js';

export interface ApiKeyProfile {
  /** 访问秘钥 */
  key: string;
  /** 租户或客户端名称，如 "销售助手Agent" */
  name: string;
  /** 角色标识 */
  role: 'admin' | 'client';
  /** 允许调用的工具类别 (如果为空则允许所有类别) */
  allowedCategories?: string[];
  /** 允许调用的具体工具名称白名单 (如果为空则允许所有) */
  allowedTools?: string[];
  /** 备注说明 */
  description?: string;
  /** 创建时间 */
  createdAt?: string;
}

export class KeyManager {
  private filePath: string;
  private keysMap = new Map<string, ApiKeyProfile>();

  constructor() {
    this.filePath = path.join(config.dataDir, 'keys.json');
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: ApiKeyProfile[] = JSON.parse(raw);
        for (const item of list) {
          this.keysMap.set(item.key, item);
        }
      } else {
        // 创建初始预制多租户 Key 示例
        const defaultProfiles: ApiKeyProfile[] = [
          {
            key: config.apiKey,
            name: '超级管理员 (System Admin)',
            role: 'admin',
            description: '拥有对所有工具、字典及管理端点的全量最高权限',
            createdAt: new Date().toISOString(),
          },
          {
            key: 'sk-sales-agent-2026',
            name: '销售智能助手 (Sales Agent)',
            role: 'client',
            allowedCategories: ['sales', 'inventory', 'common'],
            description: '仅开放销售与库存查询类工具权限',
            createdAt: new Date().toISOString(),
          },
          {
            key: 'sk-finance-agent-2026',
            name: '财务智能助手 (Finance Agent)',
            role: 'client',
            allowedCategories: ['finance', 'orders', 'common'],
            description: '仅开放财务与单据核算类工具权限',
            createdAt: new Date().toISOString(),
          },
        ];
        for (const p of defaultProfiles) {
          this.keysMap.set(p.key, p);
        }
        this.persist();
      }
    } catch (e: any) {
      console.error(`[KeyManager] 加载 keys.json 失败: ${e.message}`);
    }
  }

  private persist() {
    try {
      const list = Array.from(this.keysMap.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`[KeyManager] 持久化 keys.json 失败: ${e.message}`);
    }
  }

  /**
   * 校验传入的 Token 并返回租户档案
   */
  public authenticate(token?: string): ApiKeyProfile | null {
    if (!token) {
      // 若未开启 apiKey 配置，默认使用内置超级管理员身份
      return !config.apiKey ? { key: 'anonymous', name: '匿名客户端', role: 'admin' } : null;
    }

    const profile = this.keysMap.get(token);
    if (profile) return profile;

    // 兼容如果 token 完全匹配全局 config.apiKey
    if (token === config.apiKey) {
      return {
        key: token,
        name: '环境变量超级管理员',
        role: 'admin',
      };
    }

    return null;
  }

  /**
   * 检查该客户端身份是否有权调用指定的工具
   */
  public isToolAllowed(profile: ApiKeyProfile, tool: ToolMetadata): boolean {
    if (profile.role === 'admin') return true;

    // 1. 检查白名单工具名
    if (profile.allowedTools && profile.allowedTools.length > 0) {
      if (!profile.allowedTools.includes(tool.toolName)) {
        return false;
      }
    }

    // 2. 检查分类白名单
    if (profile.allowedCategories && profile.allowedCategories.length > 0) {
      const category = tool.category || 'common';
      if (!profile.allowedCategories.includes(category)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 依据租户权限过滤大模型在 tools/list 中可见的工具列表
   */
  public filterToolsForClient(profile: ApiKeyProfile, tools: ToolMetadata[]): Tool[] {
    return tools
      .filter((t) => t.enabled && this.isToolAllowed(profile, t))
      .map((t) => ({
        name: t.toolName,
        description: t.description,
        inputSchema: t.inputSchema as any,
      }));
  }

  public listKeys(): ApiKeyProfile[] {
    return Array.from(this.keysMap.values()).map((k) => ({
      ...k,
      key: k.key.substring(0, 4) + '****' + k.key.substring(k.key.length - 4), // 列表脱敏显示
    }));
  }

  public addKey(profile: ApiKeyProfile) {
    profile.createdAt = new Date().toISOString();
    this.keysMap.set(profile.key, profile);
    this.persist();
  }

  public removeKey(key: string): boolean {
    const res = this.keysMap.delete(key);
    if (res) this.persist();
    return res;
  }
}

export const keyManager = new KeyManager();
