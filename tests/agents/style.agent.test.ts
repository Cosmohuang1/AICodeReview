import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { styleAgent } from '../../src/agents/style.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/utils/calc.ts',
  language: 'typescript',
  diffContent: '+const x1 = a * 86400000;',
  fullContext: 'function calc(a: number) {\n  const x1 = a * 86400000;\n  return x1;\n}',
  startLine: 2,
  endLine: 2,
  diffPosition: 2,
};

describe('styleAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ReviewComment array from DeepSeek response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/utils/calc.ts","line":2,"side":"RIGHT","severity":"info","category":"style","message":"86400000 是魔法数字，建议抽取为常量 MS_PER_DAY","suggestion":"const MS_PER_DAY = 86400000;\\nconst x1 = a * MS_PER_DAY;","confidence":0.8}]'
    );
    const config = parseRepoConfig({});
    const result = await styleAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('style');
    expect(result[0].severity).toBe('info');
    expect(result[0].file).toBe('src/utils/calc.ts');
  });

  it('handles markdown codeblock JSON response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/utils/calc.ts","line":2,"side":"RIGHT","severity":"info","category":"style","message":"命名不清晰","confidence":0.7}]\n```'
    );
    const config = parseRepoConfig({});
    const result = await styleAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('style');
  });

  it('returns empty array when DeepSeek returns empty list', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    const result = await styleAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('Style agent call failed'));
    const config = parseRepoConfig({});
    const result = await styleAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('includes code style focus points in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    await styleAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('命名');
    expect(promptArg).toContain('魔法数字');
    expect(promptArg).toContain('src/utils/calc.ts');
  });
});
