import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { performanceAgent } from '../../src/agents/performance.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/services/items.ts',
  language: 'typescript',
  diffContent: '+for (const id of ids) {\n+  await db.query(`SELECT * FROM items WHERE id = ${id}`);\n+}',
  fullContext: 'async function getItems(ids: number[]) {\nfor (const id of ids) {\n  await db.query(`SELECT * FROM items WHERE id = ${id}`);\n}\n}',
  startLine: 15,
  endLine: 17,
  diffPosition: 4,
};

describe('performanceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ReviewComment array from DeepSeek response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/services/items.ts","line":16,"side":"RIGHT","severity":"warning","category":"performance","message":"循环内执行数据库查询，存在 N+1 查询性能问题","confidence":0.85}]'
    );
    const config = parseRepoConfig({});
    const result = await performanceAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('performance');
    expect(result[0].severity).toBe('warning');
    expect(result[0].line).toBe(16);
  });

  it('handles markdown codeblock JSON response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/services/items.ts","line":16,"side":"RIGHT","severity":"warning","category":"performance","message":"N+1 查询","confidence":0.9}]\n```'
    );
    const config = parseRepoConfig({});
    const result = await performanceAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('performance');
  });

  it('returns empty array when DeepSeek returns empty list', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    const result = await performanceAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('DeepSeek error'));
    const config = parseRepoConfig({});
    const result = await performanceAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('includes performance focus points in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    await performanceAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('N+1');
    expect(promptArg).toContain('内存泄漏');
    expect(promptArg).toContain('src/services/items.ts');
  });
});
