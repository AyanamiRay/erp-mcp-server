import { config } from '../config.js';

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

export class SsrfValidator {
  // 云厂商元数据地址黑名单（严格封禁，绝不允许访问）
  private static readonly CLOUD_METADATA_HOSTS = [
    '169.254.169.254',
    'metadata.google.internal',
    'fd00:ec2::254',
  ];

  /**
   * 校验待请求或待注册的 URL 是否安全
   */
  public static validate(urlStr: string): UrlValidationResult {
    if (!urlStr || typeof urlStr !== 'string') {
      return { valid: false, error: 'URL 不能为空' };
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { valid: false, error: `非法的 URL 格式: ${urlStr}` };
    }

    // 1. 协议白名单限制 (仅允许 http: 与 https:)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `不安全的协议类型 '${parsed.protocol}'，仅支持 http: 和 https:`,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. 封禁云厂商实例元数据服务 (AWS/GCP/Azure IMDS 防护)
    if (this.CLOUD_METADATA_HOSTS.includes(hostname) || hostname.startsWith('169.254.')) {
      return {
        valid: false,
        error: `[SSRF 拦截] 禁止访问云平台元数据服务地址: ${hostname}`,
      };
    }

    // 3. 生产环境内网与环回防护
    if (!config.allowInternalUrls) {
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1'
      ) {
        return {
          valid: false,
          error: `[SSRF 拦截] 生产环境禁止直接调用本地环回地址: ${hostname}`,
        };
      }
    }

    return { valid: true };
  }
}
