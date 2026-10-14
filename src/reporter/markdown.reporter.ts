import type { PRSummary, ReviewComment, Severity, Category } from '../agents/types.js';

const SUMMARY_START = '<!-- ai-review-summary -->';
const SUMMARY_END = '<!-- /ai-review-summary -->';

const SEVERITY_EMOJI: Record<Severity, string> = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

const CATEGORY_LABEL: Record<Category, string> = {
  bug: 'BUG',
  security: 'SECURITY',
  performance: 'PERF',
  style: 'STYLE',
  test: 'TEST',
  custom: 'RULE',
};

interface I18nHeadings {
  summaryTitle: string;
  walkthroughTitle: string;
  tableHeader: string;
  diagramTitle: string;
}

const HEADINGS: Record<'zh' | 'en', I18nHeadings> = {
  zh: {
    summaryTitle: '## 🤖 AI Review 摘要',
    walkthroughTitle: '### 📋 变更清单',
    tableHeader: '| 文件 | 变更内容 |\n|:---|:---|',
    diagramTitle: '### 🔄 调用流程',
  },
  en: {
    summaryTitle: '## 🤖 AI Review Summary',
    walkthroughTitle: '### 📋 Walkthrough',
    tableHeader: '| File | Changes |\n|:---|:---|',
    diagramTitle: '### 🔄 Sequence Diagram',
  },
};

export function buildPRBody(
  summary: PRSummary,
  originalBody: string,
  language: 'zh' | 'en' = 'zh'
): string {
  // 移除旧的 summary section（幂等性）
  const cleanBody = (originalBody ?? '')
    .replace(new RegExp(`${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}`, 'g'), '')
    .trim();

  const labels = HEADINGS[language] ?? HEADINGS.zh;

  const walkthroughTable = [
    labels.tableHeader,
    ...summary.walkthrough.map(w => `| \`${w.file}\` | ${w.changes.replace(/\|/g, '\\|')} |`),
  ].join('\n');

  const mermaidSection = summary.mermaidDiagram && summary.mermaidDiagram.trim()
    ? `\n### 🔄 ${language === 'en' ? 'Sequence Diagram' : '调用流程'}\n\n\`\`\`mermaid\n${summary.mermaidDiagram.trim()}\n\`\`\``
    : '';

  const summarySection = `\n\n${SUMMARY_START}\n${labels.summaryTitle}\n\n${summary.overview}\n\n${labels.walkthroughTitle}\n\n${walkthroughTable}${mermaidSection}\n${SUMMARY_END}`;

  return cleanBody ? `${cleanBody}${summarySection}` : summarySection.trimStart();
}

export function buildInlineCommentBody(comment: ReviewComment): string {
  const emoji = SEVERITY_EMOJI[comment.severity] ?? '🔵';
  const label = CATEGORY_LABEL[comment.category] ?? (comment.category ? (comment.category as string).toUpperCase() : 'COMMENT');

  let body = `${emoji} **[${label}]** ${comment.message}`;

  if (comment.suggestion && comment.suggestion.trim()) {
    body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
  }

  return body;
}
