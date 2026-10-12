import { describe, it, expect } from 'vitest';
import { buildPRBody, buildInlineCommentBody } from '../../src/reporter/markdown.reporter.js';
import type { PRSummary, ReviewComment } from '../../src/agents/types.js';

const summary: PRSummary = {
  overview: '本次 PR 修复了用户认证 Bug。',
  walkthrough: [{ file: 'src/auth.ts', changes: '修复了 token 过期逻辑' }],
  mermaidDiagram: '',
};

describe('buildPRBody', () => {
  it('injects summary section into existing PR body', () => {
    const result = buildPRBody(summary, '原始 PR 描述');
    expect(result).toContain('原始 PR 描述');
    expect(result).toContain('AI Review 摘要');
    expect(result).toContain('本次 PR 修复了用户认证 Bug。');
    expect(result).toContain('| `src/auth.ts` | 修复了 token 过期逻辑 |');
  });

  it('replaces existing summary section on re-review', () => {
    const existingWithSummary = buildPRBody(summary, '原始描述');
    const newSummary: PRSummary = {
      overview: '第二次 Review',
      walkthrough: [{ file: 'src/user.ts', changes: '更新用户模型' }],
      mermaidDiagram: '',
    };
    const result = buildPRBody(newSummary, existingWithSummary);
    expect(result).toContain('第二次 Review');
    expect(result).not.toContain('本次 PR 修复了用户认证 Bug。');
    expect(result).toContain('原始描述');
    expect(result).toContain('| `src/user.ts` | 更新用户模型 |');
  });

  it('handles empty original body', () => {
    const result = buildPRBody(summary, '');
    expect(result).toContain('AI Review 摘要');
    expect(result).toContain('本次 PR 修复了用户认证 Bug。');
    expect(result.startsWith('<!-- ai-review-summary -->')).toBe(true);
  });

  it('includes mermaid diagram when present', () => {
    const withDiagram: PRSummary = {
      ...summary,
      mermaidDiagram: 'sequenceDiagram\n  A->>B: hello',
    };
    const result = buildPRBody(withDiagram, '');
    expect(result).toContain('### 🔄 调用流程');
    expect(result).toContain('```mermaid\nsequenceDiagram\n  A->>B: hello\n```');
  });

  it('omits mermaid diagram section when mermaidDiagram is empty', () => {
    const result = buildPRBody(summary, '');
    expect(result).not.toContain('### 🔄 调用流程');
    expect(result).not.toContain('```mermaid');
  });
});

describe('buildInlineCommentBody', () => {
  it('formats error comment with emoji', () => {
    const comment: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'error',
      category: 'bug',
      message: '空指针风险',
      confidence: 0.9,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('🔴');
    expect(result).toContain('**[BUG]**');
    expect(result).toContain('空指针风险');
  });

  it('formats warning comment with emoji', () => {
    const comment: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'warning',
      category: 'security',
      message: '未转义 SQL',
      confidence: 0.8,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('🟡');
    expect(result).toContain('**[SECURITY]**');
    expect(result).toContain('未转义 SQL');
  });

  it('formats info comment with emoji', () => {
    const comment: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'info',
      category: 'style',
      message: '命名不规范',
      confidence: 0.7,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('🔵');
    expect(result).toContain('**[STYLE]**');
    expect(result).toContain('命名不规范');
  });

  it('formats performance, test, and custom categories correctly', () => {
    const perf: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'warning',
      category: 'performance',
      message: '慢查询',
      confidence: 0.8,
    };
    expect(buildInlineCommentBody(perf)).toContain('**[PERF]**');

    const test: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'info',
      category: 'test',
      message: '缺少用例',
      confidence: 0.7,
    };
    expect(buildInlineCommentBody(test)).toContain('**[TEST]**');

    const custom: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'error',
      category: 'custom',
      message: '违反公司规范',
      confidence: 0.9,
    };
    expect(buildInlineCommentBody(custom)).toContain('**[RULE]**');
  });

  it('includes suggestion block when suggestion is provided', () => {
    const comment: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'error',
      category: 'bug',
      message: '问题',
      suggestion: 'const x = value ?? default;',
      confidence: 0.9,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('```suggestion');
    expect(result).toContain('const x = value ?? default;');
  });

  it('omits suggestion block when suggestion is undefined or empty', () => {
    const comment: ReviewComment = {
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'error',
      category: 'bug',
      message: '问题',
      confidence: 0.9,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).not.toContain('```suggestion');
  });
});
