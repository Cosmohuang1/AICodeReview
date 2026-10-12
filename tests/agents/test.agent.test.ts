import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { testAgent } from '../../src/agents/test.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/payment/processor.ts',
  language: 'typescript',
  diffContent: '+export function refund(amount: number) {\n+  if (amount <= 0) throw new Error("Invalid");\n+  return gateway.refund(amount);\n+}',
  fullContext: 'export function refund(amount: number) {\n  if (amount <= 0) throw new Error("Invalid");\n  return gateway.refund(amount);\n}',
  startLine: 1,
  endLine: 4,
  diffPosition: 1,
};

describe('testAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ReviewComment array from DeepSeek response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/payment/processor.ts","line":2,"side":"RIGHT","severity":"warning","category":"test","message":"缺少针对 amount <= 0 抛出异常分支的单元测试","confidence":0.85}]'
    );
    const config = parseRepoConfig({});
    const result = await testAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('test');
    expect(result[0].severity).toBe('warning');
    expect(result[0].file).toBe('src/payment/processor.ts');
  });

  it('handles markdown codeblock JSON response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/payment/processor.ts","line":1,"side":"RIGHT","severity":"info","category":"test","message":"新增函数缺少测试","confidence":0.75}]\n```'
    );
    const config = parseRepoConfig({});
    const result = await testAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('test');
  });

  it('returns empty array when DeepSeek returns empty list', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    const result = await testAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('DeepSeek test error'));
    const config = parseRepoConfig({});
    const result = await testAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('includes testing focus points in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    await testAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('单元测试');
    expect(promptArg).toContain('分支');
    expect(promptArg).toContain('src/payment/processor.ts');
  });
});
