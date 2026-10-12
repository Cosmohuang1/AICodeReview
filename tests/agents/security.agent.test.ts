import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { securityAgent } from '../../src/agents/security.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/auth/login.ts',
  language: 'typescript',
  diffContent: '+const query = `SELECT * FROM users WHERE user = "${user}"`;',
  fullContext: 'export function login(user: string) { const query = `SELECT * FROM users WHERE user = "${user}"`; }',
  startLine: 10,
  endLine: 10,
  diffPosition: 2,
};

describe('securityAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ReviewComment array from DeepSeek response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '[{"file":"src/auth/login.ts","line":10,"side":"RIGHT","severity":"error","category":"security","message":"SQL 注入风险","suggestion":"db.query(\'SELECT * FROM users WHERE user = ?\', [user])","confidence":0.95}]'
    );
    const config = parseRepoConfig({});
    const result = await securityAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('security');
    expect(result[0].severity).toBe('error');
    expect(result[0].file).toBe('src/auth/login.ts');
    expect(result[0].suggestion).toContain('SELECT * FROM users WHERE user = ?');
  });

  it('handles markdown codeblock JSON response', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(
      '```json\n[{"file":"src/auth/login.ts","line":10,"side":"RIGHT","severity":"error","category":"security","message":"SQL 注入","confidence":0.9}]\n```'
    );
    const config = parseRepoConfig({});
    const result = await securityAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('security');
  });

  it('returns empty array when DeepSeek returns empty list', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    const result = await securityAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('returns empty array on API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('Network error'));
    const config = parseRepoConfig({});
    const result = await securityAgent(mockChunk, config);
    expect(result).toEqual([]);
  });

  it('includes security checks in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('[]');
    const config = parseRepoConfig({});
    await securityAgent(mockChunk, config);
    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('SQL');
    expect(promptArg).toContain('XSS');
    expect(promptArg).toContain('src/auth/login.ts');
  });
});
