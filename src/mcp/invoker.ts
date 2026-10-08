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
import { TemplateEnricher } from './enricher.js';
import { idempotencyGuard } from './idempotency.js';
import { SsrfValidator } from '../security/ssrfValidator.js';

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
  proxy: false, // 禁用系统环境变量代理，确保内网及本地调用直连，避免被宿主机代理软件返回 502
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
   * 执行动态工具调用 (集成连接池、LRU缓存、并发防重锁、模板补全、Singleflight、Token压缩、W3C追踪与柔性降级)
   */
  public static async execute(
    meta: ToolMetadata,
    rawArgs: Record<string, any>,
    traceId: string,
    clientName: string = 'AI Agent',
    sessionId: string = 'default-session'
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 0. SSRF 安全校验
    const ssrfCheck = SsrfValidator.validate(meta.invocation.url);
    if (!ssrfCheck.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `[SSRF 拦截] ${ssrfCheck.error || '目标接口 URL 未通过安全审计'}`,
          },
        ],
        isError: true,
      };
    }

    // 1. 大模型入参宽容纠错清洗 (基于 Schema 感知，防止编码单号被误转为数字)
    const cleanedArgs = InputSanitizer.sanitize(rawArgs, meta.inputSchema);

    // 2. 建单模板缺省字段自动补全 (自动注入当前日期、默认币种、税率等系统字段)
    const args = TemplateEnricher.enrich(cleanedArgs, meta.templateDefaults);

    // 3. JSON Schema 参数校验
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

    // 4. Dry-Run 预校验与模拟试算模式处理
    if (args.dryRun === true) {
      console.log(`[Invoker] [${traceId}] 触发 Dry-Run 模拟试算与预校验模式`);
      const previewText = `【单据预校验与试算完成 (Dry-Run 模式)】\n参数校验与模板补全通过，待提交单据明细预览如下：\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\n📌 提示：本次为试运行预检，尚未真正写入 ERP 数据库。请向用户确认明细无误后，再次正式建单。`;
      return {
        content: [{ type: 'text', text: previewText }],
      };
    }

    const isReadOnly = Boolean(meta.readOnly || (meta.invocation.method || 'POST').toUpperCase() === 'GET');

    // 5. 5秒业务幂等防重守卫 (带并发 In-Flight 锁，彻底杜绝毫秒级竞态双花重复建单)
    const enableIdemp = !isReadOnly && meta.enableIdempotency !== false;
    const idempFingerprint = idempotencyGuard.generateFingerprint(sessionId, meta.toolName, args);

    if (enableIdemp) {
      const acq = idempotencyGuard.acquire(idempFingerprint);
      if (!acq.allowed) {
        if (acq.status === 'PENDING') {
          console.warn(`[Invoker] [${traceId}] 拦截到并发处理中的重复单据提交`);
          return {
            content: [
              {
                type: 'text',
                text: `【操作进行中 409】检测到完全相同内容的单据正在向 ERP 提交处理中，请勿并发连点重复触发。`,
              },
            ],
            isError: true,
          };
        }
        if (acq.status === 'COMPLETED' && acq.cachedResult) {
          console.warn(`[Invoker] [${traceId}] 命中 5 秒防重连点锁，直接复用上次已创建结果`);
          return {
            content: [
              {
                type: 'text',
                text: `【5秒业务防重拦截】检测到在 5 秒内重复提交了相同内容的单据，已自动拦截避免重复建单。\n上次已创建的单据结果如下：\n\n${acq.cachedResult}`,
              },
            ],
          };
        }
      }
    }

    // 6. 检查只读工具的本地内存 LRU 二级缓存 (0ms 极速返回)
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

    // 7. 并发请求去重 (Singleflight 机制)：相同只读请求合并执行
    if (isReadOnly) {
      return await singleflight.do(cacheKey, async () => {
        return await this.performHttpRequest(meta, args, traceId, clientName, startTime, cacheKey, idempFingerprint, enableIdemp);
      });
    }

    return await this.performHttpRequest(meta, args, traceId, clientName, startTime, cacheKey, idempFingerprint, enableIdemp);
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
    cacheKey: string,
    idempFingerprint: string,
    enableIdemp: boolean
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
      ...(args.dryRun ? { 'X-Dry-Run': 'true' } : {}),
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

      // 核心检查：下游 ERP 业务状态码识别 (防止 HTTP 200 包裹业务失败被误当成功)
      const businessErr = this.checkBusinessError(response.data, meta.businessStatusRule);
      if (businessErr.isError) {
        console.warn(`[Invoker] [${traceId}] 检测到 ERP 业务层报错: ${businessErr.message}`);

        // 业务失败：立即释放防重锁，允许业务员或大模型修改参数后重新尝试
        if (enableIdemp) {
          idempotencyGuard.release(idempFingerprint);
        }

        auditLogger.log({
          traceId,
          clientName,
          toolName: meta.toolName,
          args,
          costMs,
          success: false,
          errorMsg: businessErr.message,
        });

        return {
          content: [
            {
              type: 'text',
              text: `[ERP 业务处理失败] ${businessErr.message}`,
            },
          ],
          isError: true,
        };
      }

      // 出参过滤与结构化精简
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

      // 写入只读二级缓存 (只有业务成功才写缓存)
      if (meta.cacheTtlMs && meta.cacheTtlMs > 0) {
        toolLruCache.set(cacheKey, formattedOutput, meta.cacheTtlMs);
      }

      // 将并发锁标记为正式完成并记录结果
      if (enableIdemp) {
        idempotencyGuard.resolve(idempFingerprint, formattedOutput);
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

    // 失败时释放幂等锁，允许重试
    if (enableIdemp) {
      idempotencyGuard.release(idempFingerprint);
    }

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

  /**
   * 识别 ERP 统一返回格式中的业务错误 (如 code != 0, success == false)
   */
  private static checkBusinessError(
    data: any,
    rule?: ToolMetadata['businessStatusRule']
  ): { isError: boolean; message?: string } {
    if (!data || typeof data !== 'object') {
      return { isError: false };
    }

    // 1. 若配置了自定义业务规则
    if (rule) {
      if (rule.successField && data[rule.successField] === false) {
        const msg = (rule.messageField && data[rule.messageField]) || data.message || data.msg || '业务接口返回失败';
        return { isError: true, message: String(msg) };
      }
      if (rule.codeField && data[rule.codeField] !== undefined) {
        const expectedCodes = rule.successCodes || [0, 200, '0', '200', 'SUCCESS', 'OK'];
        if (!expectedCodes.includes(data[rule.codeField])) {
          const msg = (rule.messageField && data[rule.messageField]) || data.message || data.msg || `业务状态码不符合预期: ${data[rule.codeField]}`;
          return { isError: true, message: String(msg) };
        }
      }
      return { isError: false };
    }

    // 2. 默认自适应常见 Java Spring Boot 统一响应格式 (Result / R / ApiResponse)
    if (data.success === false) {
      const msg = data.message || data.msg || data.error || '下游 ERP 系统返回业务失败';
      return { isError: true, message: String(msg) };
    }

    if (data.code !== undefined && typeof data.code === 'number') {
      if (data.code !== 0 && data.code !== 200) {
        const msg = data.msg || data.message || data.error || `ERP 业务状态码异常: ${data.code}`;
        return { isError: true, message: String(msg) };
      }
    }

    return { isError: false };
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

  /**
   * 结构化过滤与截断 (保证 JSON 或表格语法完整性，防止破损截断)
   */
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
    if (str.length <= maxChars) {
      return result;
    }

    // 结构化保护截断 (列表型数据截断元素，防止破坏 JSON 语法)
    if (Array.isArray(result)) {
      let keepCount = result.length;
      while (keepCount > 1 && JSON.stringify(result.slice(0, keepCount)).length > maxChars - 200) {
        keepCount = Math.floor(keepCount * 0.7);
      }
      const truncatedList = result.slice(0, Math.max(1, keepCount));
      return {
        _truncated: true,
        totalItems: result.length,
        displayedItems: truncatedList.length,
        hint: `返回列表总数 (${result.length} 条) 超出字符限制，已结构化保留前 ${truncatedList.length} 条。请使用条件缩小查询范围。`,
        data: truncatedList,
      };
    }

    if (typeof result === 'object' && result !== null) {
      const listKey = Object.keys(result).find((k) => Array.isArray(result[k]) && result[k].length > 0);
      if (listKey) {
        const origList = result[listKey];
        let keepCount = origList.length;
        while (keepCount > 1 && JSON.stringify({ ...result, [listKey]: origList.slice(0, keepCount) }).length > maxChars - 200) {
          keepCount = Math.floor(keepCount * 0.7);
        }
        const truncatedList = origList.slice(0, Math.max(1, keepCount));
        return {
          ...result,
          [listKey]: truncatedList,
          _truncated: true,
          totalItems: origList.length,
          displayedItems: truncatedList.length,
          hint: `字段 '${listKey}' 列表总数 (${origList.length} 条) 超出字符限制，已结构化保留前 ${truncatedList.length} 条。`,
        };
      }
    }

    if (typeof result === 'string') {
      return result.substring(0, maxChars) + `... [文本过长已截断前 ${maxChars} 字符]`;
    }

    return {
      _truncated: true,
      hint: `对象结构过大已截断前 ${maxChars} 字符`,
      rawSnippet: str.substring(0, maxChars),
    };
  }
}
