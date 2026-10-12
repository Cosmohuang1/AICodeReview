import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/base.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents/base.js')>();
  return {
    ...actual,
    callDeepSeek: vi.fn(),
  };
});

import { summaryAgent } from '../../src/agents/summary.agent.js';
import { callDeepSeek } from '../../src/agents/base.js';
import type { ParsedFile } from '../../src/parser/diff.parser.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockFiles: ParsedFile[] = [
  {
    filePath: 'src/auth/jwt.ts',
    language: 'typescript',
    isNew: false,
    isDeleted: false,
    hunks: [
      {
        oldStart: 10,
        newStart: 10,
        newLines: ['const token = sign(payload);', 'return token;'],
        diffPosition: 2,
        rawHunk: '+const token = sign(payload);\n+return token;',
      },
    ],
  },
  {
    filePath: 'src/auth/verify.ts',
    language: 'typescript',
    isNew: false,
    isDeleted: false,
    hunks: [
      {
        oldStart: 20,
        newStart: 20,
        newLines: ['return verify(token);'],
        diffPosition: 3,
        rawHunk: '+return verify(token);',
      },
    ],
  },
];

describe('summaryAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns PRSummary from DeepSeek response', async () => {
    const mockResponse = JSON.stringify({
      overview: '重构了 JWT 签名与验证逻辑。',
      walkthrough: [
        { file: 'src/auth/jwt.ts', changes: '重构签名逻辑' },
        { file: 'src/auth/verify.ts', changes: '重构验证逻辑' },
      ],
      mermaidDiagram: 'sequenceDiagram\n  User->>App: Login\n  App->>JWT: sign()',
    });
    vi.mocked(callDeepSeek).mockResolvedValue(mockResponse);

    const config = parseRepoConfig({});
    const result = await summaryAgent('feat: JWT refactor', mockFiles, config);

    expect(result.overview).toBe('重构了 JWT 签名与验证逻辑。');
    expect(result.walkthrough).toHaveLength(2);
    expect(result.walkthrough[0].file).toBe('src/auth/jwt.ts');
    expect(result.walkthrough[0].changes).toBe('重构签名逻辑');
    expect(result.mermaidDiagram).toContain('sequenceDiagram');
  });

  it('handles markdown codeblock JSON response from DeepSeek', async () => {
    const mockResponse = '```json\n{\n  "overview": "修复安全漏洞",\n  "walkthrough": [{"file": "src/auth/jwt.ts", "changes": "更新密钥"}],\n  "mermaidDiagram": ""\n}\n```';
    vi.mocked(callDeepSeek).mockResolvedValue(mockResponse);

    const config = parseRepoConfig({});
    const result = await summaryAgent('fix: security hole', mockFiles, config);

    expect(result.overview).toBe('修复安全漏洞');
    expect(result.walkthrough).toHaveLength(1);
    expect(result.walkthrough[0].file).toBe('src/auth/jwt.ts');
  });

  it('returns default PRSummary on DeepSeek API error', async () => {
    vi.mocked(callDeepSeek).mockRejectedValue(new Error('DeepSeek API timeout'));

    const config = parseRepoConfig({});
    const result = await summaryAgent('fix: crash', mockFiles, config);

    expect(result.overview).toContain('本次 PR 包含代码变更');
    expect(result.walkthrough).toHaveLength(2);
    expect(result.walkthrough[0].file).toBe('src/auth/jwt.ts');
    expect(result.mermaidDiagram).toBe('');
  });

  it('returns default PRSummary when DeepSeek returns invalid JSON', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue('Sorry, I could not generate summary.');

    const config = parseRepoConfig({});
    const result = await summaryAgent('fix: crash', mockFiles, config);

    expect(result.overview).toContain('本次 PR 包含代码变更');
    expect(result.walkthrough).toHaveLength(2);
    expect(result.walkthrough[0].file).toBe('src/auth/jwt.ts');
    expect(result.mermaidDiagram).toBe('');
  });

  it('handles empty files list', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(JSON.stringify({
      overview: '空 PR',
      walkthrough: [],
      mermaidDiagram: '',
    }));

    const config = parseRepoConfig({});
    const result = await summaryAgent('empty pr', [], config);

    expect(result.overview).toBe('空 PR');
    expect(result.walkthrough).toEqual([]);
  });

  it('includes PR title, language preference, and file diffs in prompt', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(JSON.stringify({
      overview: 'Summary',
      walkthrough: [],
      mermaidDiagram: '',
    }));

    const config = parseRepoConfig({ language: 'en' });
    await summaryAgent('feat: payment integration', mockFiles, config);

    expect(callDeepSeek).toHaveBeenCalledTimes(1);
    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('feat: payment integration');
    expect(promptArg).toContain('src/auth/jwt.ts');
    expect(promptArg).toContain('+const token = sign(payload);');
    expect(promptArg).toContain('English');
  });

  it('slices diff to first 10 files if PR contains more than 10 files', async () => {
    vi.mocked(callDeepSeek).mockResolvedValue(JSON.stringify({
      overview: 'Large PR',
      walkthrough: [],
      mermaidDiagram: '',
    }));

    const manyFiles: ParsedFile[] = Array.from({ length: 15 }, (_, i) => ({
      filePath: `src/file_${i}.ts`,
      language: 'typescript',
      isNew: false,
      isDeleted: false,
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          newLines: [`console.log(${i});`],
          diffPosition: 1,
          rawHunk: `+console.log(${i});`,
        },
      ],
    }));

    const config = parseRepoConfig({});
    await summaryAgent('feat: massive changes', manyFiles, config);

    const promptArg = vi.mocked(callDeepSeek).mock.calls[0][0];
    expect(promptArg).toContain('src/file_0.ts');
    expect(promptArg).toContain('src/file_9.ts');
    expect(promptArg).not.toContain('src/file_10.ts');
  });
});
