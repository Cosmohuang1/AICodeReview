import { getOctokit } from './octokit.js';

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  installationId: number;
}

export async function fetchPRDiff(ctx: PRContext): Promise<{
  rawDiff: string;
  fileContents: Map<string, string>;
  originalBody: string;
}> {
  const octokit = await getOctokit(ctx.installationId);

  // 获取 PR diff
  const { data: diffData } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    mediaType: { format: 'diff' },
  });
  const rawDiff = typeof diffData === 'string' ? diffData : String(diffData ?? '');

  // 获取 PR 当前 body（用于幂等更新）
  const { data: pr } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
  });
  const originalBody = pr.body ?? '';

  // 获取变更文件列表，读取每个文件的完整内容（用于 AST 上下文扩充）
  const { data: files } = await octokit.pulls.listFiles({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    per_page: 100,
  });

  const fileContents = new Map<string, string>();
  await Promise.allSettled(
    files
      .filter(f => f.status !== 'removed')
      .slice(0, 20) // 最多 20 个文件
      .map(async f => {
        try {
          const { data } = await octokit.repos.getContent({
            owner: ctx.owner,
            repo: ctx.repo,
            path: f.filename,
            ref: pr.head?.sha,
          });
          if ('content' in data && typeof data.content === 'string') {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            fileContents.set(f.filename, content);
          }
        } catch {
          // 忽略单个文件读取失败
        }
      })
  );

  return { rawDiff, fileContents, originalBody };
}
