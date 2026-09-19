/**
 * 敏感数据脱敏引擎 (Data Masker)
 * 用于在 ERP 数据返回给大模型前，自动掩码个人隐私及敏感财务信息
 */

export class DataMasker {
  // 中国大陆手机号正则 (13x-19x 11位数字)
  private static readonly PHONE_REGEX = /(?<!\d)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g;

  // 18位中国大陆身份证号正则
  private static readonly ID_CARD_REGEX = /(?<!\d)([1-9]\d{5})\d{8}(\d{3}[\dXx])(?!\d)/g;

  // 16~19位银行卡号正则
  private static readonly BANK_CARD_REGEX = /(?<!\d)([1-9]\d{3})\d{8,11}(\d{4})(?!\d)/g;

  // 电子邮箱正则
  private static readonly EMAIL_REGEX = /([a-zA-Z0-9_\.-]{1})([a-zA-Z0-9_\.-]+)([a-zA-Z0-9_\.-]{1})@([a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+)/g;

  /**
   * 对字符串文本进行全局脱敏
   */
  public static maskString(input: string): string {
    if (!input || typeof input !== 'string') return input;

    return input
      // 手机号: 13812345678 -> 138****5678
      .replace(this.PHONE_REGEX, '$1****$3')
      // 身份证: 110101199003072345 -> 110101********2345
      .replace(this.ID_CARD_REGEX, '$1********$2')
      // 银行卡: 6222021234567890123 -> 6222***********0123
      .replace(this.BANK_CARD_REGEX, (match, p1, p2) => {
        const maskLen = match.length - p1.length - p2.length;
        return p1 + '*'.repeat(maskLen) + p2;
      })
      // 邮箱: test.user@corp.com -> t***r@corp.com
      .replace(this.EMAIL_REGEX, '$1***$3@$4');
  }

  /**
   * 递归遍历对象或数组进行深度脱敏
   */
  public static maskData<T = any>(data: T): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.maskString(data) as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.maskData(item)) as unknown as T;
    }

    if (typeof data === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        // 如果字段名本身提示密码或密钥，直接全部遮盖
        if (/password|secret|token|credential|private_key/i.test(key)) {
          result[key] = '******';
        } else {
          result[key] = this.maskData(value);
        }
      }
      return result as T;
    }

    return data;
  }
}
