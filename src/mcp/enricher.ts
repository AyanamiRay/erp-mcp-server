/**
 * 建单模板缺省字段自动补全器 (Template Defaults Enricher)
 * 自动填充 ERP 系统所依赖的日期、币种、默认税率等系统字段，减轻大模型负担
 */

export class TemplateEnricher {
  /**
   * 将模板默认值与大模型传入的参数智能合并
   * @param rawArgs 大模型实际传入的业务入参
   * @param defaults 工具元数据中配置的模板默认值
   */
  public static enrich(
    rawArgs: Record<string, any>,
    defaults?: Record<string, any>
  ): Record<string, any> {
    if (!defaults || Object.keys(defaults).length === 0) {
      return rawArgs;
    }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentDateTime = now.toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:mm:ss
    const timestamp = Date.now();

    // 先计算渲染 defaults 中的动态占位符
    const evaluatedDefaults: Record<string, any> = {};
    for (const [k, v] of Object.entries(defaults)) {
      if (typeof v === 'string') {
        let val = v
          .replace(/\{\{current_date\}\}/g, currentDate)
          .replace(/\{\{current_datetime\}\}/g, currentDateTime)
          .replace(/\{\{timestamp\}\}/g, String(timestamp));
        evaluatedDefaults[k] = val;
      } else {
        evaluatedDefaults[k] = v;
      }
    }

    // 合并：大模型传了则以大模型为准，大模型没传则用默认值补齐
    return {
      ...evaluatedDefaults,
      ...rawArgs,
    };
  }
}
