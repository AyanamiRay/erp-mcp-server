import axios, { AxiosRequestConfig } from 'axios';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ToolMetadata } from '../types/tool.js';
import { config } from '../config.js';
import { DataMasker } from './masker.js';

// 初始化 Ajv 校验器
const ajv = new (Ajv as any)({ allErrors: true, coerceTypes: true });
(addFormats as any)(ajv);

export interface ExecutionResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

export class GenericInvoker {
  /**
   * 执行动态工具调用
   */
  public static async execute(
    meta: ToolMetadata,
    args: Record<string, any>,
    traceId: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. JSON Schema 参数校验
    const validate = ajv.compile(meta.inputSchema);
    const valid = validate(args);
    if (!valid) {
      const errorMsg = validate.errors
        ?.map((err: any) => `字段 '${err.instancePath.replace('/', '')}' ${err.message}`)
        .join('; ');
      return {
        content: [
          {
            type: 'text',
            text: `[参数校验不通过] 模型调用参数不合法: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }

    // 2. 准备请求配置
    const invocation = meta.invocation;
    const method = (invocation.method || 'POST').toUpperCase();
    const timeout = invocation.timeoutMs || config.defaultTimeoutMs;

    // 组装 URL 与 Query Params
    let targetUrl = invocation.url;
    const queryParams: Record<string, any> = {};
    if (invocation.queryParams) {
      for (const [k, v] of Object.entries(invocation.queryParams)) {
        queryParams[k] = this.renderTemplateValue(v, args);
      }
    }

    // 组装 Body 数据
    let requestBody: any = null;
    if (method !== 'GET') {
      if (invocation.bodyTemplate) {
        requestBody = this.renderObjectTemplate(invocation.bodyTemplate, args);
      } else {
        // 默认将模型传入的所有参数作为请求体
        requestBody = args;
      }
    }

    // 组装 Headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Trace-Id': traceId,
      'X-Caller-Source': 'MCP-Server',
      ...(invocation.headers || {}),
    };

    const requestConfig: AxiosRequestConfig = {
      url: targetUrl,
      method,
      headers,
      params: queryParams,
      data: requestBody,
      timeout,
    };

    try {
      console.log(`[Invoker] [${traceId}] 正在调用 ERP 接口: ${method} ${targetUrl}`);
      const response = await axios(requestConfig);
      const costMs = Date.now() - startTime;
      console.log(`[Invoker] [${traceId}] ERP 接口响应成功，耗时 ${costMs}ms，状态码: ${response.status}`);

      // 3. 出参过滤与精简
      const filteredResult = this.filterResponse(response.data, meta.responseFilter);

      // 4. 敏感信息自动脱敏处理 (手机号/身份证/银行卡)
      const maskedResult = DataMasker.maskData(filteredResult);

      return {
        content: [
          {
            type: 'text',
            text: typeof maskedResult === 'string' ? maskedResult : JSON.stringify(maskedResult, null, 2),
          },
        ],
      };
    } catch (err: any) {
      const costMs = Date.now() - startTime;
      console.error(`[Invoker] [${traceId}] 调用 ERP 接口失败，耗时 ${costMs}ms:`, err.message);

      let detail = err.message;
      if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        detail = `ERP 接口调用超时 (超过限制 ${timeout}ms)，请稍后重试或检查接口服务健康度。`;
      } else if (err.response) {
        const status = err.response.status;
        const resData = JSON.stringify(err.response.data || '');
        detail = `ERP 接口返回 HTTP ${status}: ${resData.substring(0, 500)}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: `[ERP 接口执行异常] ${detail}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * 递归替换对象中的 {{varName}} 模板占位符
   */
  private static renderObjectTemplate(template: any, data: Record<string, any>): any {
    if (typeof template === 'string') {
      return this.renderTemplateValue(template, data);
    }
    if (Array.isArray(template)) {
      return template.map((item) => this.renderObjectTemplate(item, data));
    }
    if (template !== null && typeof template === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.renderObjectTemplate(value, data);
      }
      return result;
    }
    return template;
  }

  /**
   * 字符串模板替换，支持 {{key}}
   */
  private static renderTemplateValue(templateStr: string, data: Record<string, any>): any {
    // 如果完全匹配 "{{key}}"，直接返回对应类型的原生值（如数字/布尔/对象），保持类型不被强制转为字符串
    const exactMatch = templateStr.match(/^\{\{([a-zA-Z0-9_.-]+)\}\}$/);
    if (exactMatch) {
      const key = exactMatch[1];
      return this.getDeepValue(data, key) ?? templateStr;
    }

    // 复合字符串替换，例如 "order-{{orderNo}}-v1"
    return templateStr.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, key) => {
      const val = this.getDeepValue(data, key);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  private static getDeepValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  /**
   * 出参字段裁剪与长度限制
   */
  private static filterResponse(data: any, filterConfig?: ToolMetadata['responseFilter']): any {
    if (!data) return data;

    let result = data;

    // 如果配置了提取特定字段
    if (filterConfig?.pickFields && filterConfig.pickFields.length > 0) {
      if (typeof data === 'object' && !Array.isArray(data)) {
        const picked: Record<string, any> = {};
        for (const field of filterConfig.pickFields) {
          if (field in data) {
            picked[field] = data[field];
          }
        }
        result = Object.keys(picked).length > 0 ? picked : data;
      }
    }

    // 最大字符截断，防止 Token 爆炸
    const maxChars = filterConfig?.maxChars || 10000;
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (str.length > maxChars) {
      return str.substring(0, maxChars) + `... [返回结果过长，已截断前 ${maxChars} 字符]`;
    }

    return result;
  }
}
