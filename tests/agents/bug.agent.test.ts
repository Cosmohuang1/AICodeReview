import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { bugAgent } from '../../src/agents/bug.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/a.ts',
  language: 'typescript',
  diffContent: '+const x = obj.value;',
  fullContext: 'function test() { const x = obj.value; }',
  startLine: 5,
  endLine: 5,
  diffPosition: 3,
};

describe('bugAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ReviewComment array from DeepSeek response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/a.ts","line":5,"side":"RIGHT","severity":"error","category":"bug","message":"空指针","confidence":0.9}]'
    );
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('bug');
    expect(result[0].file).toBe('src/a.ts');
    expect(result[0].line).toBe(5);
    expect(result[0].severity).toBe('error');
    expect(result[0].confidence).toBe(0.9);
  });

  it('handles markdown codeblock JSON response from DeepSeek', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/a.ts","line":5,"side":"RIGHT","severity":"warning","category":"bug","message":"潜在未捕获异常","confidence":0.8}]\n```'
    );
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('潜在未捕获异常');
  });

  it('returns empty array when DeepSeek returns empty array or no issues', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('DeepSeek API timeout'));
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('falls back to chunk.file and chunk.startLine when omitted in response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"message":"无行号和文件名","severity":"warning"}]'
    );
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(mockChunk.file);
    expect(result[0].line).toBe(mockChunk.startLine);
    expect(result[0].category).toBe('bug');
  });

  it('includes language preference and diff content in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({ language: 'en' });
    await bugAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('src/a.ts');
    expect(promptArg).toContain('+const x = obj.value;');
    expect(promptArg).toContain('English');
  });
});
