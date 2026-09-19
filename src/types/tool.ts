/**
 * MCP 动态工具元数据类型定义
 */

export interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[] | number[];
  default?: any;
  items?: any;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface InvocationConfig {
  /** 目标调用接口 URL (如 http://erp-internal:8080/api/mcp/stock/query) */
  url: string;
  /** HTTP 请求方法，默认为 POST */
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** 超时毫秒数，默认 5000ms */
  timeoutMs?: number;
  /** 请求头配置 */
  headers?: Record<string, string>;
  /**
   * 请求体模板，支持通过 {{fieldName}} 注入大模型传入的参数
   * 如果不设置，默认将大模型传入的所有 arguments 直接作为 JSON 请求体发送
   */
  bodyTemplate?: Record<string, any> | string;
  /**
   * URL Query 参数模板，支持 {{fieldName}}
   */
  queryParams?: Record<string, string>;
}

export interface ResponseFilterConfig {
  /**
   * 仅从返回结果中挑选指定的字段（支持根字段或简易路径如 data.list）
   * 如果未配置，则原样返回
   */
  pickFields?: string[];
  /**
   * 最大响应字符长度，避免大模型由于庞大返回爆 Token（默认 10000 字符）
   */
  maxChars?: number;
}

export interface ToolMetadata {
  /** 工具唯一英文标识（大模型函数名，符合 [a-zA-Z0-9_-]{1,64}） */
  toolName: string;
  /** 工具的人类与模型可读描述，告诉 LLM 什么时候调用此工具 */
  description: string;
  /** 是否启用，禁用后对大模型不可见 */
  enabled: boolean;
  /** 工具所属分类，便于分组管理 */
  category?: string;
  /** 大模型入参 JSON Schema */
  inputSchema: ToolInputSchema;
  /** 目标 ERP 系统接口调用配置 */
  invocation: InvocationConfig;
  /** 出参裁剪与格式化配置 */
  responseFilter?: ResponseFilterConfig;
  /** 元数据更新时间戳 */
  updatedAt?: string;
  /** 注册来源（例如: "spring-boot-erp", "admin-console"） */
  source?: string;
}

export interface ToolChangeEvent {
  type: "REGISTER" | "UNREGISTER" | "REFRESH";
  toolName?: string;
  timestamp: number;
}
