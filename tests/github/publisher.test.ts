import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOctokit = vi.hoisted(() => ({
  pulls: {
    update: vi.fn().mockResolvedValue({}),
    createReview: vi.fn().mockResolvedValue({}),
    listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
  },
  issues: {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock('../../src/github/octokit.js', () => ({
  getOctokit: vi.fn().mockResolvedValue(mockOctokit),
}));

import { publishReview } from '../../src/github/publisher.js';
import type { PRSummary, ReviewComment } from '../../src/agents/types.js';
import type { PRContext } from '../../src/github/diff.fetcher.js';

const ctx: PRContext = {
  owner: 'test-owner',
  repo: 'test-repo',
  prNumber: 42,
  prTitle: 'Test PR',
  installationId: 12345,
};

const summary: PRSummary = {
  overview: 'Summary overview text',
  walkthrough: [{ file: 'src/a.ts', changes: 'fixed bug' }],
  mermaidDiagram: '',
};

const comments: ReviewComment[] = [
  {
    file: 'src/a.ts',
    line: 5,
    side: 'RIGHT',
    severity: 'error',
    category: 'bug',
    message: 'test bug message',
    confidence: 0.9,
    diffPosition: 3,
  },
];

describe('publishReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls octokit.pulls.update to set PR body', async () => {
    await publishReview(ctx, summary, 'original body', comments);
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        body: expect.stringContaining('Summary overview text'),
      })
    );
  });

  it('calls createReview with inline comments formatted correctly', async () => {
    await publishReview(ctx, summary, '', comments);
    expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        event: 'COMMENT',
        comments: [
          expect.objectContaining({
            path: 'src/a.ts',
            position: 3,
            body: expect.stringContaining('test bug message'),
          }),
        ],
      })
    );
  });

  it('supports 3 arguments signature (omitting originalBody)', async () => {
    await publishReview(ctx, summary, comments);
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        body: expect.stringContaining('Summary overview text'),
      })
    );
    expect(mockOctokit.pulls.createReview).toHaveBeenCalled();
  });

  it('uses default diffPosition = 1 when diffPosition is undefined on comment', async () => {
    const commentWithoutDiffPos: ReviewComment = {
      file: 'src/b.ts',
      line: 10,
      side: 'RIGHT',
      severity: 'warning',
      category: 'style',
      message: 'style issue',
      confidence: 0.8,
    };
    await publishReview(ctx, summary, [commentWithoutDiffPos]);
    expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        comments: [
          expect.objectContaining({
            path: 'src/b.ts',
            position: 1,
          }),
        ],
      })
    );
  });

  it('does not call createReview when comments array is empty', async () => {
    await publishReview(ctx, summary, 'existing body', []);
    expect(mockOctokit.pulls.update).toHaveBeenCalled();
    expect(mockOctokit.pulls.createReview).not.toHaveBeenCalled();
  });

  it('filters out comments with non-positive position', async () => {
    const invalidComment: ReviewComment = {
      file: 'src/c.ts',
      line: 10,
      side: 'RIGHT',
      severity: 'info',
      category: 'performance',
      message: 'perf note',
      confidence: 0.7,
      diffPosition: 0,
    };
    await publishReview(ctx, summary, [invalidComment]);
    expect(mockOctokit.pulls.update).toHaveBeenCalled();
    expect(mockOctokit.pulls.createReview).not.toHaveBeenCalled();
  });
});
