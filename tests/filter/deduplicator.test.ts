import { describe, it, expect } from 'vitest';
import { deduplicateComments } from '../../src/filter/deduplicator.js';
import type { ReviewComment } from '../../src/agents/types.js';

describe('CommentDeduplicator (Cross-Agent Deduplication & Clustering)', () => {
  const createComment = (partial: Partial<ReviewComment>): ReviewComment => ({
    file: 'src/app.ts',
    line: 25,
    side: 'RIGHT',
    severity: 'warning',
    category: 'bug',
    message: 'Possible null pointer exception',
    confidence: 0.8,
    ...partial,
  });

  describe('Deduplication on the exact same line', () => {
    it('merges comments on the same file & line, retaining the highest severity', () => {
      const c1 = createComment({
        severity: 'warning',
        category: 'bug',
        message: '变量可能未定义',
        confidence: 0.7,
      });
      const c2 = createComment({
        severity: 'error',
        category: 'security',
        message: '未受控的输入导致空指针或崩溃',
        confidence: 0.9,
      });

      const merged = deduplicateComments([c1, c2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].severity).toBe('error');
      expect(merged[0].category).toBe('security');
      // Confidence boosted due to multi-agent consensus
      expect(merged[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('preserves the commitable suggestion if one comment has it and the other does not', () => {
      const c1 = createComment({
        message: '建议增加判空',
        suggestion: undefined,
      });
      const c2 = createComment({
        message: '判空处理',
        suggestion: 'if (!user) return null;',
      });

      const merged = deduplicateComments([c1, c2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].suggestion).toBe('if (!user) return null;');
    });
  });

  describe('Clustering adjacent lines for identical problems', () => {
    it('merges redundant comments within 1 line distance with similar message', () => {
      const c1 = createComment({
        line: 30,
        message: '未捕获的 Promise 异常',
      });
      const c2 = createComment({
        line: 31,
        message: '未捕获的 Promise 异常，请使用 catch',
      });

      const merged = deduplicateComments([c1, c2]);
      expect(merged).toHaveLength(1);
    });

    it('does NOT merge comments on different lines with completely different concerns', () => {
      const c1 = createComment({
        line: 30,
        category: 'style',
        message: '变量命名不符合驼峰规则',
      });
      const c2 = createComment({
        line: 31,
        category: 'security',
        message: 'SQL 注入风险',
      });

      const merged = deduplicateComments([c1, c2]);
      expect(merged).toHaveLength(2);
    });
  });

  describe('Sorting order', () => {
    it('sorts comments by file, then line ascending, then severity (error before warning)', () => {
      const c1 = createComment({ file: 'b.ts', line: 10, severity: 'warning' });
      const c2 = createComment({ file: 'a.ts', line: 20, severity: 'error' });
      const c3 = createComment({ file: 'a.ts', line: 5, severity: 'info' });

      const sorted = deduplicateComments([c1, c2, c3]);
      expect(sorted[0].file).toBe('a.ts');
      expect(sorted[0].line).toBe(5);
      expect(sorted[1].file).toBe('a.ts');
      expect(sorted[1].line).toBe(20);
      expect(sorted[2].file).toBe('b.ts');
    });
  });

  describe('Empty and single-item inputs', () => {
    it('handles empty list gracefully', () => {
      expect(deduplicateComments([])).toEqual([]);
    });

    it('returns single comment intact', () => {
      const c = createComment({});
      expect(deduplicateComments([c])).toEqual([c]);
    });
  });
});
