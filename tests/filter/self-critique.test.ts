import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewComment, CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { selfCritique } from '../../src/filter/self-critique.js';
import { callDeepSeek } from '../../src/agents/base.js';

const mockComment: ReviewComment = {
  file: 'a.ts',
  line: 1,
  side: 'RIGHT',
  severity: 'error',
  category: 'bug',
  message: 'bug found',
  suggestion: 'const x = 2;',
  confidence: 0.9,
};

const mockChunk: CodeChunk = {
  file: 'a.ts',
  language: 'typescript',
  diffContent: '+const x = 1;',
  fullContext: 'const x = 1;',
  startLine: 1,
  endLine: 1,
  diffPosition: 1,
};

describe('selfCritique', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns comments with confidence above threshold', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([{ ...mockComment, confidence: 0.9 }])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].file).toBe('a.ts');
  });

  it('filters out comments below threshold', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([{ ...mockComment, confidence: 0.3 }])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toHaveLength(0);
  });

  it('returns original comments on filter error (callDeepSeek rejection)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(callDeepSeek).mockRejectedValueOnce(new Error('DeepSeek timeout'));
    const config = parseRepoConfig({});
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toEqual([mockComment]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ai-review] Self-critique filter failed')
    );
    warnSpy.mockRestore();
  });

  it('returns empty array immediately without calling DeepSeek when comments array is empty', async () => {
    const config = parseRepoConfig({});
    const result = await selfCritique([], [mockChunk], config);
    expect(result).toEqual([]);
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it('handles empty chunks array gracefully', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([{ ...mockComment, confidence: 0.8 }])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [], config);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.8);
  });

  it('handles markdown codeblock JSON response from DeepSeek', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      '```json\n[{"file":"a.ts","line":1,"side":"RIGHT","severity":"error","category":"bug","message":"bug found","confidence":0.75}]\n```'
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.75);
  });

  it('filters multi-item responses according to threshold', async () => {
    const comment2: ReviewComment = {
      file: 'b.ts',
      line: 10,
      side: 'RIGHT',
      severity: 'warning',
      category: 'style',
      message: 'naming issue',
      confidence: 0.7,
    };
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([
        { ...mockComment, confidence: 0.85 },
        { ...comment2, confidence: 0.55 },
      ])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.7 });
    const result = await selfCritique([mockComment, comment2], [mockChunk], config);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('a.ts');
    expect(result[0].confidence).toBe(0.85);
  });

  it('preserves original comment details (suggestion, side, line) even if DeepSeek omits some', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([
        { file: 'a.ts', line: 1, message: 'bug found', confidence: 0.95 },
      ])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toHaveLength(1);
    expect(result[0].suggestion).toBe('const x = 2;');
    expect(result[0].side).toBe('RIGHT');
    expect(result[0].severity).toBe('error');
    expect(result[0].category).toBe('bug');
    expect(result[0].confidence).toBe(0.95);
  });

  it('handles new valid comments returned by DeepSeek not matched by file/line', async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      JSON.stringify([
        {
          file: 'c.ts',
          line: 20,
          side: 'RIGHT',
          severity: 'warning',
          category: 'performance',
          message: 'perf issue',
          suggestion: 'optimize()',
          confidence: 0.9,
        },
      ])
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([mockComment], [mockChunk], config);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('c.ts');
    expect(result[0].category).toBe('performance');
    expect(result[0].suggestion).toBe('optimize()');
  });
});
