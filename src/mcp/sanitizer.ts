/**
 * 大模型入参宽容纠错与清洗引擎 (Input Sanitizer)
 * 自动容错纠偏大模型在格式上的常见微小瑕疵，提升首次调用成功率
 */

export class InputSanitizer {
  // 斜杠或点号分隔的日期正则: 2026/09/19 或 2026.09.19 -> 2026-09-19
  private static readonly SLASH_DATE_REGEX = /^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/;

  /**
   * 递归清洗与纠偏输入参数
   */
  public static sanitize(input: any): any {
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

      // 2. 纯数字字符串自动判断（如果完全是合法的整型数字，且不是以 0 开头的电话号码或单号）
      if (/^-?\d+$/.test(trimmed) && trimmed.length <= 9 && !trimmed.startsWith('0')) {
        const num = Number(trimmed);
        if (!isNaN(num) && Number.isSafeInteger(num)) {
          return num;
        }
      }

      // 3. 布尔字符串纠偏
      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;

      return trimmed;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.sanitize(item));
    }

    if (typeof input === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitize(value);
      }
      return sanitized;
    }

    return input;
  }
}
