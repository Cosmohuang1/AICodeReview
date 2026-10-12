import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOctokit = vi.hoisted(() => ({
  pulls: {
    get: vi.fn(),
    listFiles: vi.fn(),
  },
  repos: {
    getContent: vi.fn(),
  },
}));

vi.mock('../../src/github/octokit.js', () => ({
  getOctokit: vi.fn().mockResolvedValue(mockOctokit),
}));

import { fetchPRDiff, type PRContext } from '../../src/github/diff.fetcher.js';

const ctx: PRContext = {
  owner: 'owner1',
  repo: 'repo1',
  prNumber: 99,
  prTitle: 'Add feature',
  installationId: 456,
};

describe('fetchPRDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches raw diff and PR body correctly', async () => {
    const rawDiffText = 'diff --git a/file1.ts b/file1.ts\n--- a/file1.ts\n+++ b/file1.ts\n@@ -1,1 +1,2 @@\n+const x = 1;';
    mockOctokit.pulls.get.mockImplementation(async (params: any) => {
      if (params.mediaType?.format === 'diff') {
        return { data: rawDiffText };
      }
      return {
        data: {
          body: 'PR description text',
          head: { sha: 'sha-123' },
        },
      };
    });

    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'file1.ts', status: 'modified' },
      ],
    });

    mockOctokit.repos.getContent.mockResolvedValue({
      data: {
        type: 'file',
        content: Buffer.from('const x = 1;\nconsole.log(x);').toString('base64'),
      },
    });

    const result = await fetchPRDiff(ctx);

    expect(result.rawDiff).toBe(rawDiffText);
    expect(result.originalBody).toBe('PR description text');
    expect(result.fileContents.get('file1.ts')).toBe('const x = 1;\nconsole.log(x);');
    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: 'owner1',
      repo: 'repo1',
      path: 'file1.ts',
      ref: 'sha-123',
    });
  });

  it('skips removed files when fetching content', async () => {
    mockOctokit.pulls.get.mockImplementation(async (params: any) => {
      if (params.mediaType?.format === 'diff') return { data: 'some diff' };
      return { data: { body: '', head: { sha: 'sha-456' } } };
    });

    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'deleted.ts', status: 'removed' },
        { filename: 'added.ts', status: 'added' },
      ],
    });

    mockOctokit.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from('hello').toString('base64'),
      },
    });

    const result = await fetchPRDiff(ctx);
    expect(result.fileContents.has('deleted.ts')).toBe(false);
    expect(result.fileContents.has('added.ts')).toBe(true);
    expect(mockOctokit.repos.getContent).toHaveBeenCalledTimes(1);
    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'added.ts' })
    );
  });

  it('handles empty PR body gracefully', async () => {
    mockOctokit.pulls.get.mockImplementation(async (params: any) => {
      if (params.mediaType?.format === 'diff') return { data: '' };
      return { data: { body: null, head: { sha: 'sha-789' } } };
    });

    mockOctokit.pulls.listFiles.mockResolvedValue({ data: [] });

    const result = await fetchPRDiff(ctx);
    expect(result.originalBody).toBe('');
    expect(result.fileContents.size).toBe(0);
  });

  it('limits content fetching to 20 files', async () => {
    mockOctokit.pulls.get.mockImplementation(async (params: any) => {
      if (params.mediaType?.format === 'diff') return { data: 'diff' };
      return { data: { body: '', head: { sha: 'sha-abc' } } };
    });

    const files = Array.from({ length: 30 }, (_, i) => ({
      filename: `file_${i}.ts`,
      status: 'modified',
    }));
    mockOctokit.pulls.listFiles.mockResolvedValue({ data: files });
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { content: Buffer.from('code').toString('base64') },
    });

    const result = await fetchPRDiff(ctx);
    expect(mockOctokit.repos.getContent).toHaveBeenCalledTimes(20);
    expect(result.fileContents.size).toBe(20);
  });

  it('continues if a single file getContent fails', async () => {
    mockOctokit.pulls.get.mockImplementation(async (params: any) => {
      if (params.mediaType?.format === 'diff') return { data: 'diff' };
      return { data: { body: 'body', head: { sha: 'sha-xyz' } } };
    });

    mockOctokit.pulls.listFiles.mockResolvedValue({
      data: [
        { filename: 'ok.ts', status: 'modified' },
        { filename: 'err.ts', status: 'modified' },
      ],
    });

    mockOctokit.repos.getContent.mockImplementation(async (params: any) => {
      if (params.path === 'err.ts') {
        throw new Error('Not found or binary');
      }
      return { data: { content: Buffer.from('ok content').toString('base64') } };
    });

    const result = await fetchPRDiff(ctx);
    expect(result.fileContents.get('ok.ts')).toBe('ok content');
    expect(result.fileContents.has('err.ts')).toBe(false);
  });
});
