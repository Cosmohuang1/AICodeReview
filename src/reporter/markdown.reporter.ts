import type { PRSummary, ReviewComment } from '../agents/types.js';

const SUMMARY_START = '<!-- ai-review-summary -->';
const SUMMARY_END = '<!-- /ai-review-summary -->';

const SEVERITY_EMOJI: Record<string, string> = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

const CATEGORY_LABEL: Record<string, string> = {
  bug: 'BUG',
  security: 'SECURITY',
  performance: 'PERF',
  style: 'STYLE',
  test: 'TEST',
  custom: 'RULE',
};

export function buildPRBody(summary: PRSummary, originalBody: string): string {
  // 移除旧的 summary section（幂等性）
  const cleanBody = (originalBody ?? '')
    .replace(new RegExp(`${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}`, 'g'), '')
    .trim();

  const walkthroughTable = [
    '| 文件 | 变更内容 |',
    '|:---|:---|',
    ...summary.walkthrough.map(w => `| \`${w.file}\` | ${w.changes} |`),
  ].join('\n');

  const mermaidSection = summary.mermaidDiagram && summary.mermaidDiagram.trim()
    ? `\n### 🔄 调用流程\n\n\`\`\`mermaid\n${summary.mermaidDiagram.trim()}\n\`\`\``
    : '';

  const summarySection = `\n\n${SUMMARY_START}\n## 🤖 AI Review 摘要\n\n${summary.overview}\n\n### 📋 变更清单\n\n${walkthroughTable}${mermaidSection}\n${SUMMARY_END}`;

  return cleanBody ? `${cleanBody}${summarySection}` : summarySection.trimStart();
}

export function buildInlineCommentBody(comment: ReviewComment): string {
  const emoji = SEVERITY_EMOJI[comment.severity] ?? '🔵';
  const label = CATEGORY_LABEL[comment.category] ?? (comment.category ? comment.category.toUpperCase() : 'COMMENT');

  let body = `${emoji} **[${label}]** ${comment.message}`;

  if (comment.suggestion && comment.suggestion.trim()) {
    body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
  }

  return body;
}
