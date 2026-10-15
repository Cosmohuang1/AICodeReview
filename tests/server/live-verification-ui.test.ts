import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

describe('verification UI truthfulness', () => {
  it('never hardcodes passing test counts, and shows running output distinctly', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
    expect(html).not.toContain('262 通过');
    expect(html).not.toContain("t.passed ?? 262");
    expect(html).toContain("es.addEventListener('tool_output'");
    expect(html).toContain("reactEventSource.addEventListener('tool_output'");
    expect(html).toContain('程序运行中，等待 stdout/stderr 输出');
    expect(html).toContain('/api/verification/stream');
    const snippets = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1]).filter(Boolean);
    expect(snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets) {
      const js = ts.createSourceFile('index-inline.js', snippet, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      expect(js.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\\n'))).toEqual([]);
    }
  });
});
