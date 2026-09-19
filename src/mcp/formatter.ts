/**
 * 出参紧凑格式化器 (Compact Formatter)
 * 将对象列表自动转为紧凑的 Markdown 表格，大幅节约大模型 Token
 */

export class CompactFormatter {
  /**
   * 将数据智能格式化为高信息密度的文本格式
   */
  public static format(data: any): string {
    if (data === null || data === undefined) return '';
    if (typeof data !== 'object') return String(data);

    // 1. 如果本身是一个对象数组，且元素字段相对扁平
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      return this.renderMarkdownTable(data);
    }

    // 2. 如果包含标准的分页包装对象，如 { list: [...], total: ... } 或 { records: [...] }
    if (!Array.isArray(data)) {
      const arrayKey = Object.keys(data).find((k) => Array.isArray(data[k]) && data[k].length > 0);
      if (arrayKey && typeof data[arrayKey][0] === 'object') {
        const table = this.renderMarkdownTable(data[arrayKey]);
        const otherFields: Record<string, any> = {};
        for (const [k, v] of Object.entries(data)) {
          if (k !== arrayKey) otherFields[k] = v;
        }
        return `### 汇总信息\n\`\`\`json\n${JSON.stringify(otherFields, null, 2)}\n\`\`\`\n\n### 明细列表\n${table}`;
      }
    }

    return JSON.stringify(data, null, 2);
  }

  /**
   * 将对象数组渲染为标准 Markdown 表格
   */
  private static renderMarkdownTable(list: Array<Record<string, any>>): string {
    // 提取所有出现过的列头 (最多提取前 10 列以防过宽)
    const headerSet = new Set<string>();
    for (const item of list) {
      if (typeof item === 'object' && item !== null) {
        Object.keys(item).forEach((k) => headerSet.add(k));
      }
    }
    const headers = Array.from(headerSet).slice(0, 10);

    if (headers.length === 0) {
      return JSON.stringify(list, null, 2);
    }

    // 拼接表头与分隔符
    const headerLine = '| ' + headers.join(' | ') + ' |';
    const separatorLine = '| ' + headers.map(() => '---').join(' | ') + ' |';

    // 拼接数据行
    const rows = list.map((item) => {
      const cells = headers.map((h) => {
        const val = item[h];
        if (val === null || val === undefined) return '-';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).replace(/\|/g, '\\|'); // 转义表格竖线
      });
      return '| ' + cells.join(' | ') + ' |';
    });

    return [headerLine, separatorLine, ...rows].join('\n');
  }
}
