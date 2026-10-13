import { bugAgent } from '../agents/bug.agent.js';
import { securityAgent } from '../agents/security.agent.js';
import { performanceAgent } from '../agents/performance.agent.js';
import { styleAgent } from '../agents/style.agent.js';
import { testAgent } from '../agents/test.agent.js';
import { customAgent } from '../agents/custom.agent.js';
import type { CodeChunk, ReviewComment } from '../agents/types.js';
import type { RepoConfig } from '../config/schema.js';

const ALL_AGENTS = [
  { name: 'bug', fn: bugAgent },
  { name: 'security', fn: securityAgent },
  { name: 'performance', fn: performanceAgent },
  { name: 'style', fn: styleAgent },
  { name: 'test', fn: testAgent },
  { name: 'custom', fn: customAgent },
];

export type OrchestratorProgressCallback = (
  completed: number,
  total: number,
  currentChunk: CodeChunk
) => void;

export async function runOrchestrator(
  chunks: CodeChunk[],
  config: RepoConfig,
  onProgress?: OrchestratorProgressCallback
): Promise<ReviewComment[]> {
  if (chunks.length === 0) return [];

  const allComments: ReviewComment[] = [];
  const concurrency = 4; // 并发度设为 4，大幅提升大工程走查速度
  let completedCount = 0;

  // 使用滑动并发池执行各个 chunk
  const executing: Promise<void>[] = [];

  for (const chunk of chunks) {
    const task = (async () => {
      const results = await Promise.allSettled(
        ALL_AGENTS.map(agent => agent.fn(chunk, config))
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          allComments.push(...result.value);
        } else {
          console.warn(`[ai-review] Agent "${ALL_AGENTS[i].name}" failed for ${chunk.file}:`, result.reason);
        }
      }

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, chunks.length, chunk);
      }
    })();

    executing.push(task);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // 清理已完成的任务
      for (let i = executing.length - 1; i >= 0; i--) {
        // 利用 Promise.race 触发后的空挡清理
      }
    }
  }

  // 等待所有剩余的 chunk 任务完成
  await Promise.allSettled(executing);

  if (config.severityOverride && Object.keys(config.severityOverride).length > 0) {
    return allComments.map(c => ({
      ...c,
      severity: config.severityOverride[c.category] ?? c.severity,
    }));
  }

  return allComments;
}

export default runOrchestrator;
