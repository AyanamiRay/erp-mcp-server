import { ToolInputSchema } from '../types/tool.js';

/**
 * 大模型入参宽容纠错与清洗引擎 (Input Sanitizer)
 * 自动容错纠偏大模型在格式上的常见微小瑕疵，提升首次调用成功率
 * 支持 Schema-Aware 感知：若字段声明为 string 或属于单号/编码，坚决不盲目转为数字
 */
export class InputSanitizer {
  // 斜杠或点号分隔的日期正则: 2026/09/19 或 2026.09.19 -> 2026-09-19
  private static readonly SLASH_DATE_REGEX = /^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/;

  // 常见具有业务编码、单号语义的字段后缀（无 Schema 时默认不强转数字，防止截断或类型失真）
  private static readonly CODE_FIELD_REGEX = /(code|id|no|sn|sku|batch|tax|card|mobile|phone)$/i;

  /**
   * 递归清洗与纠偏输入参数
   * @param input 待清洗的原始参数
   * @param schema 可选的入参 JSON Schema 定义
   * @param currentKey 当前正在处理的字段属性名
   */
  public static sanitize(input: any, schema?: ToolInputSchema, currentKey?: string): any {
    if (input === null || input === undefined) {
      return input;
    }

    if (typeof input === 'string') {
      let trimmed = input.trim();

      // 1. 自动纠偏斜杠/点号日期格式为标准 ISO 日期格式 (YYYY-MM-DD)
      const dateMatch = trimmed.match(this.SLASH_DATE_REGEX);
      if (dateMatch) {
        const year = dateMatch[1];
        const month = dateMatch[2].padStart(2, '0');
        const day = dateMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      // 获取 Schema 中的期望字段类型
      const propDef = currentKey ? schema?.properties?.[currentKey] : undefined;
      const expectedType = propDef?.type;

      // 2. 如果 Schema 明确声明了类型为 string，坚决不转数字
      if (expectedType === 'string') {
        // 如果是布尔字符串，也不强转
        return trimmed;
      }

      // 3. 布尔字符串纠偏
      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;

      // 4. 数字类型处理
      const isDigits = /^-?\d+$/.test(trimmed) && trimmed.length <= 9 && !trimmed.startsWith('0');
      if (isDigits) {
        // 如果 Schema 声明为 number / integer，或者未声明但不是编码单号字段，则转数字
        const isCodeField = currentKey && this.CODE_FIELD_REGEX.test(currentKey);
        if (expectedType === 'number' || expectedType === 'integer' || (!expectedType && !isCodeField)) {
          const num = Number(trimmed);
          if (!isNaN(num) && Number.isSafeInteger(num)) {
            return num;
          }
        }
      }

      return trimmed;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.sanitize(item, schema, currentKey));
    }

    if (typeof input === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitize(value, schema, key);
      }
      return sanitized;
    }

    return input;
  }
}
