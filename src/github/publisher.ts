import { getOctokit } from './octokit.js';
import { buildPRBody, buildInlineCommentBody } from '../reporter/markdown.reporter.js';
import type { PRSummary, ReviewComment } from '../agents/types.js';
import type { PRContext } from './diff.fetcher.js';

export async function publishReview(
  ctx: PRContext,
  summary: PRSummary,
  comments: ReviewComment[]
): Promise<void>;
export async function publishReview(
  ctx: PRContext,
  summary: PRSummary,
  originalBody: string,
  comments: ReviewComment[]
): Promise<void>;
export async function publishReview(
  ctx: PRContext,
  summary: PRSummary,
  arg3: string | ReviewComment[],
  arg4?: ReviewComment[]
): Promise<void> {
  const originalBody = typeof arg3 === 'string' ? arg3 : '';
  const comments = Array.isArray(arg3) ? arg3 : (arg4 ?? []);

  const octokit = await getOctokit(ctx.installationId);

  // 1. 更新 PR Body（插入/替换 Summary section）
  const newBody = buildPRBody(summary, originalBody);
  await octokit.pulls.update({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    body: newBody,
  });

  // 2. 发布行级 Inline Review Comments
  if (comments.length > 0) {
    const reviewComments = comments.map(c => ({
      path: c.file,
      position: c.diffPosition ?? 1, // fallback to 1 if missing
      body: buildInlineCommentBody(c),
    }));

    // 补全 diffPosition（从 comment 里取，如果 comment 里没有则忽略）
    const validComments = reviewComments.filter(c => c.position > 0);

    if (validComments.length > 0) {
      await octokit.pulls.createReview({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.prNumber,
        event: 'COMMENT',
        comments: validComments,
      });
    }
  }
}
