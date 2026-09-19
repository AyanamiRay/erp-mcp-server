import axios, { AxiosRequestConfig } from 'axios';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ToolMetadata } from '../types/tool.js';
import { config } from '../config.js';
import { DataMasker } from './masker.js';
import { auditLogger } from '../storage/auditLogger.js';

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
   * 执行动态工具调用 (带智能重试与全链路审计)
   */
  public static async execute(
    meta: ToolMetadata,
    args: Record<string, any>,
    traceId: string,
    clientName: string = 'AI Agent'
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

    const isReadOnly = Boolean(meta.readOnly || method === 'GET');
    let response: any = null;
    let lastError: any = null;

    // 尝试执行调用（只读接口最多尝试 2 次，支持指数退避重试）
    const maxAttempts = isReadOnly ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[Invoker] [${traceId}] 正在对只读接口进行第 ${attempt} 次智能重试...`);
          await new Promise((resolve) => setTimeout(resolve, 500)); // 退避等待 500ms
        } else {
          console.log(`[Invoker] [${traceId}] 正在调用 ERP 接口: ${method} ${targetUrl}`);
        }

        response = await axios(requestConfig);
        break; // 请求成功，跳出循环
      } catch (err: any) {
        lastError = err;
        // 如果是只读请求且还有重试机会，且属于网络类错误（超时、连接重置、502/503/504）
        const isNetworkOr5xx = err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' ||
          (err.response && [502, 503, 504].includes(err.response.status));

        if (attempt < maxAttempts && isNetworkOr5xx) {
          console.warn(`[Invoker] [${traceId}] 第 ${attempt} 次调用遭遇偶发错误 (${err.message})，准备智能重试`);
          continue;
        }
        break;
      }
    }

    const costMs = Date.now() - startTime;

    // 如果最终调用成功
    if (response) {
      console.log(`[Invoker] [${traceId}] ERP 接口响应成功，耗时 ${costMs}ms，状态码: ${response.status}`);

      // 出参过滤与精简
      const filteredResult = this.filterResponse(response.data, meta.responseFilter);
      // 敏感信息自动脱敏
      const maskedResult = DataMasker.maskData(filteredResult);
      const textOutput = typeof maskedResult === 'string' ? maskedResult : JSON.stringify(maskedResult, null, 2);

      // 记录调用审计日志
      auditLogger.log({
        traceId,
        clientName,
        toolName: meta.toolName,
        args,
        costMs,
        success: true,
        responseSnippet: textOutput.substring(0, 300),
      });

      return {
        content: [{ type: 'text', text: textOutput }],
      };
    }

    // 调用失败处理
    console.error(`[Invoker] [${traceId}] 调用 ERP 接口失败，耗时 ${costMs}ms:`, lastError?.message);

    let detail = lastError?.message || '未知网络错误';
    if (lastError?.code === 'ECONNABORTED' || lastError?.message.includes('timeout')) {
      detail = `ERP 接口调用超时 (超过限制 ${timeout}ms)，请稍后重试或检查接口服务健康度。`;
    } else if (lastError?.response) {
      const status = lastError.response.status;
      const resData = JSON.stringify(lastError.response.data || '');
      detail = `ERP 接口返回 HTTP ${status}: ${resData.substring(0, 500)}`;
    }

    // 记录失败审计日志
    auditLogger.log({
      traceId,
      clientName,
      toolName: meta.toolName,
      args,
      costMs,
      success: false,
      errorMsg: detail,
    });

    return {
      content: [{ type: 'text', text: `[ERP 接口执行异常] ${detail}` }],
      isError: true,
    };
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
