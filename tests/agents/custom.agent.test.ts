import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { customAgent } from '../../src/agents/custom.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/controllers/user.ts',
  language: 'typescript',
  diffContent: '+console.log("user logged in", userId);\n+eval(userData);',
  fullContext: 'function handle(userId: string, userData: string) {\n  console.log("user logged in", userId);\n  eval(userData);\n}',
  startLine: 2,
  endLine: 3,
  diffPosition: 1,
};

describe('customAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array immediately without calling DeepSeek when rules is empty', async () => {
    const config = parseRepoConfig({ rules: [] });
    const result = await customAgent(mockChunk, config);
    expect(result).toEqual([]);
    expect(callDeepSeek).not.toHaveBeenCalled();
  });

  it('returns ReviewComment array when rules are violated', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/controllers/user.ts","line":2,"side":"RIGHT","severity":"error","category":"custom","message":"违反自定义规范：生产代码中严禁使用 console.log","suggestion":"","confidence":0.95}]'
    );
    const config = parseRepoConfig({
      rules: ['生产代码中严禁使用 console.log', '禁止使用 eval 函数'],
    });
    const result = await customAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('custom');
    expect(result[0].severity).toBe('error');
    expect(result[0].message).toContain('console.log');
  });

  it('interpolates rules into DeepSeek prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({
      rules: ['规则1：所有 API 必须携带 traceId', '规则2：严禁硬编码域名'],
    });
    await customAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('规则1：所有 API 必须携带 traceId');
    expect(promptArg).toContain('规则2：严禁硬编码域名');
    expect(promptArg).toContain('src/controllers/user.ts');
  });

  it('handles markdown codeblock JSON response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/controllers/user.ts","line":3,"side":"RIGHT","severity":"error","category":"custom","message":"违反自定义规范：禁止使用 eval","confidence":0.99}]\n```'
    );
    const config = parseRepoConfig({
      rules: ['禁止使用 eval'],
    });
    const result = await customAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('custom');
    expect(result[0].confidence).toBe(0.99);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('Custom agent failure'));
    const config = parseRepoConfig({
      rules: ['禁止使用 eval'],
    });
    const result = await customAgent(mockChunk, config);
    expect(result).toEqual([]);
  });
});
