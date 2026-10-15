import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

describe('precise review finding locations', () => {
  const html = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');

  it('shows file:line badges and a navigable finding index', () => {
    expect(html).toContain('问题定位索引');
    expect(html).toContain('renderFindingLocationBadge(c, index)');
    expect(html).toContain('renderFindingLocationBadge(c, i)');
    expect(html).toContain('findingLocationLabel(finding)');
    expect(html).toContain('openFindingDiff(index)');
  });

  it('generates safe external links only for permanent GitHub blob URLs', () => {
    expect(html).toContain('function safeFindingSourceUrl(finding)');
    expect(html).toContain("url.hostname !== 'github.com'");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("escapeHtml(source)");
  });

  it('does not link uncommitted edits to stale remote code', () => {
    expect(html).toContain('未提交的工作区改动仅定位到本地 Diff');
    expect(html).toContain('本地 Diff：');
    expect(html).toContain('目标行未出现在当前 Diff hunk 中');
    expect(html).toContain('row.textContent = text');
    expect(html).toContain('findingLocationLabel(c)');
  });

  it('keeps the inline frontend scripts syntactically valid', () => {
    const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1]).filter(Boolean);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const source = ts.createSourceFile('review-ui.js', block, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      expect(source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    }
  });
});
