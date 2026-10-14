import type { Request, Response } from 'express';
import crypto from 'crypto';
import { runReviewPipeline } from '../pipeline.js';
import type { PRContext } from '../github/diff.fetcher.js';
import { defaultSqliteStorage } from '../storage/sqlite.storage.js';

export function verifySignature(
  body: Buffer | string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;
  const bufferBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(bufferBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  const rawBody: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === 'string'
      ? Buffer.from(req.body)
      : Buffer.from(JSON.stringify(req.body ?? {}));

  if (!verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload =
      typeof req.body === 'object' && !Buffer.isBuffer(req.body) && req.body !== null
        ? req.body
        : JSON.parse(rawBody.toString('utf-8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  const event = (req.headers['x-github-event'] as string | undefined) ?? '';

  // 只处理 PR opened / synchronize 事件
  if (event !== 'pull_request' || !['opened', 'synchronize'].includes(payload?.action)) {
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  // Draft PR 跳过
  if (payload.pull_request?.draft) {
    res.status(200).json({ message: 'Draft PR skipped' });
    return;
  }

  // 立即返回 200（GitHub 要求 10 秒内响应）
  res.status(200).json({ message: 'Review started' });

  // 后台异步执行 Review Pipeline
  const ctx: PRContext = {
    owner: payload.repository?.owner?.login ?? '',
    repo: payload.repository?.name ?? '',
    prNumber: payload.pull_request?.number ?? 0,
    prTitle: payload.pull_request?.title ?? '',
    installationId: payload.installation?.id ?? 0,
  };

  setImmediate(async () => {
    try {
      await runReviewPipeline(ctx);

      try {
        const taskId = `gh_pr_${ctx.owner}_${ctx.repo}_${ctx.prNumber}_${Date.now()}`;
        defaultSqliteStorage.saveTask({
          id: taskId,
          title: `PR #${ctx.prNumber}: ${ctx.prTitle}`,
          repo: `${ctx.owner}/${ctx.repo}`,
          branch: payload.pull_request?.head?.ref || `pr-${ctx.prNumber}`,
          pushedCommit: payload.pull_request?.head?.sha || 'HEAD',
          author: payload.pull_request?.user?.login || 'GitHub User',
          workedTime: '刚刚完成',
          timestamp: '刚刚',
          status: 'completed',
          agentSummary: {
            commit: payload.pull_request?.head?.sha || 'HEAD',
            bulletPoints: [`GitHub PR #${ctx.prNumber} 审查完成并已推送到 GitHub`],
            riskNote: '已通过 GitHub App Webhook 完成审查并发布评论。',
            regressionStatus: 'PR 审查通过',
          },
          totalAdditions: payload.pull_request?.additions || 0,
          totalDeletions: payload.pull_request?.deletions || 0,
          editedFiles: [],
          comments: [],
          chatHistory: [],
          rawDiff: '',
        });
      } catch (storageErr) {
        console.warn('[ai-review] 写入 SQLite 任务历史失败:', storageErr);
      }
    } catch (err: unknown) {
      console.error('[ai-review] Pipeline error:', err);
    }
  });
}
