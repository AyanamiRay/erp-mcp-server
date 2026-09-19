import http from 'http';
import https from 'https';
import crypto from 'crypto';
import axios, { AxiosRequestConfig } from 'axios';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { ToolMetadata } from '../types/tool.js';
import { config } from '../config.js';
import { DataMasker } from './masker.js';
import { auditLogger } from '../storage/auditLogger.js';
import { InputSanitizer } from './sanitizer.js';
import { LruCache, toolLruCache } from './cache.js';
import { singleflight } from './singleflight.js';
import { CompactFormatter } from './formatter.js';

// 初始化 Ajv 校验器 (开启自动类型强转 coerceTypes)
const ajv = new (Ajv as any)({ allErrors: true, coerceTypes: true });
(addFormats as any)(ajv);

// ==========================================
// 全局持久化 HTTP Keep-Alive 连接池
// 复用已有 TCP/TLS 链路，往返延迟从 50ms 降至 1~3ms
// ==========================================
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
  timeout: 60000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
  timeout: 60000,
});

const axiosClient = axios.create({
  httpAgent,
  httpsAgent,
});

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
   * 执行动态工具调用 (集成连接池、LRU缓存、Singleflight、Token压缩、W3C追踪与柔性降级)
   */
  public static async execute(
    meta: ToolMetadata,
    rawArgs: Record<string, any>,
    traceId: string,
    clientName: string = 'AI Agent'
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. 大模型入参宽容纠错清洗 (自动规范化斜杠日期、去除首尾空格、数字字符串转换)
    const args = InputSanitizer.sanitize(rawArgs);

    // 2. JSON Schema 参数校验
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

    // 3. 检查只读工具的本地内存 LRU 二级缓存 (0ms 极速返回)
    const cacheKey = LruCache.generateKey(meta.toolName, args);
    if (meta.cacheTtlMs && meta.cacheTtlMs > 0) {
      const cached = toolLruCache.get(cacheKey);
      if (cached) {
        console.log(`[Invoker] [${traceId}] 命中内存 LRU 缓存，0ms 极速返回`);
        auditLogger.log({
          traceId,
          clientName,
          toolName: meta.toolName,
          args,
          costMs: 0,
          success: true,
          responseSnippet: cached.substring(0, 300) + ' [Cached]',
        });
        return {
          content: [{ type: 'text', text: cached }],
        };
      }
    }

    // 4. 并发请求去重 (Singleflight 机制)：相同只读请求合并执行
    const isReadOnly = Boolean(meta.readOnly || (meta.invocation.method || 'POST').toUpperCase() === 'GET');
    if (isReadOnly) {
      return await singleflight.do(cacheKey, async () => {
        return await this.performHttpRequest(meta, args, traceId, clientName, startTime, cacheKey);
      });
    }

    return await this.performHttpRequest(meta, args, traceId, clientName, startTime, cacheKey);
  }

  /**
   * 实际发起 HTTP 网络调用
   */
  private static async performHttpRequest(
    meta: ToolMetadata,
    args: Record<string, any>,
    traceId: string,
    clientName: string,
    startTime: number,
    cacheKey: string
  ): Promise<ExecutionResult> {
    const invocation = meta.invocation;
    const method = (invocation.method || 'POST').toUpperCase();
    const timeout = invocation.timeoutMs || config.defaultTimeoutMs;
    const isReadOnly = Boolean(meta.readOnly || method === 'GET');

    // 组装 URL 与 Query Params
    const targetUrl = invocation.url;
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
        requestBody = args;
      }
    }

    // 生成 W3C 标准 traceparent 头，无缝对接企业级 SkyWalking / Jaeger 链路追踪
    const traceIdHex = crypto.createHash('md5').update(traceId).digest('hex'); // 32 位 hex
    const spanIdHex = crypto.randomBytes(8).toString('hex');                     // 16 位 hex
    const traceparent = `00-${traceIdHex}-${spanIdHex}-01`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Trace-Id': traceId,
      'traceparent': traceparent,
      'X-Caller-Source': 'Enterprise-MCP-Gateway',
      'X-Client-Name': encodeURIComponent(clientName),
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

    let response: any = null;
    let lastError: any = null;

    // 智能指数退避重试 (只读接口最多重试 2 次)
    const maxAttempts = isReadOnly ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[Invoker] [${traceId}] 正在对只读接口进行第 ${attempt} 次重试...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
          console.log(`[Invoker] [${traceId}] 发起 ERP 接口调用 (连接池复用): ${method} ${targetUrl}`);
        }

        response = await axiosClient(requestConfig);
        break;
      } catch (err: any) {
        lastError = err;
        const isNetworkOr5xx =
          err.code === 'ECONNABORTED' ||
          err.code === 'ECONNRESET' ||
          (err.response && [502, 503, 504].includes(err.response.status));

        if (attempt < maxAttempts && isNetworkOr5xx) {
          console.warn(`[Invoker] [${traceId}] 第 ${attempt} 次调用偶发故障 (${err.message})，准备智能重试`);
          continue;
        }
        break;
      }
    }

    const costMs = Date.now() - startTime;

    // 调用成功处理
    if (response) {
      console.log(`[Invoker] [${traceId}] ERP 接口响应成功，耗时 ${costMs}ms，状态: ${response.status}`);

      // 出参过滤与精简
      const filteredResult = this.filterResponse(response.data, meta.responseFilter);
      // 敏感数据脱敏
      const maskedResult = DataMasker.maskData(filteredResult);

      // 出参 Token 极致压缩：自动转化为 Markdown 表格 (减少 50% Token)
      const enableCompact = meta.compactTable !== false;
      const formattedOutput = enableCompact
        ? CompactFormatter.format(maskedResult)
        : typeof maskedResult === 'string'
        ? maskedResult
        : JSON.stringify(maskedResult, null, 2);

      // 写入只读二级缓存
      if (meta.cacheTtlMs && meta.cacheTtlMs > 0) {
        toolLruCache.set(cacheKey, formattedOutput, meta.cacheTtlMs);
      }

      // 记录调用审计
      auditLogger.log({
        traceId,
        clientName,
        toolName: meta.toolName,
        args,
        costMs,
        success: true,
        responseSnippet: formattedOutput.substring(0, 300),
      });

      return {
        content: [{ type: 'text', text: formattedOutput }],
      };
    }

    // 调用失败处理与柔性降级 (Fallback)
    console.error(`[Invoker] [${traceId}] 调用 ERP 接口失败，耗时 ${costMs}ms:`, lastError?.message);

    // 检查是否有配置业务柔性降级内容
    if (meta.fallbackContent) {
      console.log(`[Invoker] [${traceId}] 触发业务柔性降级兜底返回`);
      auditLogger.log({
        traceId,
        clientName,
        toolName: meta.toolName,
        args,
        costMs,
        success: true,
        responseSnippet: `[柔性降级] ${meta.fallbackContent}`,
      });
      return {
        content: [
          {
            type: 'text',
            text: `[系统柔性降级提示] 目标 ERP 服务暂未响应，已采用基准默认数据返回：\n${meta.fallbackContent}`,
          },
        ],
      };
    }

    let detail = lastError?.message || '未知网络错误';
    if (lastError?.code === 'ECONNABORTED' || lastError?.message.includes('timeout')) {
      detail = `ERP 接口调用超时 (超过限制 ${timeout}ms)，请稍后重试或检查接口服务健康度。`;
    } else if (lastError?.response) {
      const status = lastError.response.status;
      const resData = JSON.stringify(lastError.response.data || '');
      detail = `ERP 接口返回 HTTP ${status}: ${resData.substring(0, 500)}`;
    }

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

  private static renderTemplateValue(templateStr: string, data: Record<string, any>): any {
    const exactMatch = templateStr.match(/^\{\{([a-zA-Z0-9_.-]+)\}\}$/);
    if (exactMatch) {
      const key = exactMatch[1];
      return this.getDeepValue(data, key) ?? templateStr;
    }
    return templateStr.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_, key) => {
      const val = this.getDeepValue(data, key);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }

  private static getDeepValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }

  private static filterResponse(data: any, filterConfig?: ToolMetadata['responseFilter']): any {
    if (!data) return data;
    let result = data;

    if (filterConfig?.pickFields && filterConfig.pickFields.length > 0) {
      if (typeof data === 'object' && !Array.isArray(data)) {
        const picked: Record<string, any> = {};
        for (const field of filterConfig.pickFields) {
          if (field in data) picked[field] = data[field];
        }
        result = Object.keys(picked).length > 0 ? picked : data;
      }
    }

    const maxChars = filterConfig?.maxChars || 10000;
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (str.length > maxChars) {
      return str.substring(0, maxChars) + `... [返回结果过长，已截断前 ${maxChars} 字符]`;
    }
    return result;
  }
}
