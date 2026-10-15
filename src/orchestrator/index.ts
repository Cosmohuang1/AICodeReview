import { bugAgent } from '../agents/bug.agent.js';
import { securityAgent } from '../agents/security.agent.js';
import { performanceAgent } from '../agents/performance.agent.js';
import { styleAgent } from '../agents/style.agent.js';
import { testAgent } from '../agents/test.agent.js';
import { customAgent } from '../agents/custom.agent.js';
import type { CodeChunk, ReviewComment } from '../agents/types.js';
import type { RepoConfig } from '../config/schema.js';
import { traceAgent } from '../agents/telemetry.js';

export interface AgentFailure { agent: string; file: string; message: string; }

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
  onProgress?: OrchestratorProgressCallback,
  onDiagnostics?: (failures: AgentFailure[]) => void
): Promise<ReviewComment[]> {
  if (chunks.length === 0) { onDiagnostics?.([]); return []; }

  const allComments: ReviewComment[] = [];
  const failures: AgentFailure[] = [];
  const concurrency = 4; // 并发度设为 4，大幅提升大工程走查速度
  let completedCount = 0;

  // 使用滑动并发池执行各个 chunk
  const executing = new Set<Promise<void>>();

  for (const chunk of chunks) {
    const task: Promise<void> = (async () => {
      const results = await Promise.allSettled(
        ALL_AGENTS.map(async agent => {
          const telemetry = { failures: [] as string[] };
          const comments = await traceAgent(telemetry, () => agent.fn(chunk, config));
          return { comments, telemetry };
        })
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          allComments.push(...result.value.comments);
          for (const message of result.value.telemetry.failures) {
            failures.push({ agent: ALL_AGENTS[i].name, file: chunk.file, message });
            console.warn('[ai-review] Agent "' + ALL_AGENTS[i].name + '" model failed for ' + chunk.file + ': ' + message);
          }
        } else {
          failures.push({ agent: ALL_AGENTS[i].name, file: chunk.file, message: String(result.reason).slice(0, 300) });
          console.warn(`[ai-review] Agent "${ALL_AGENTS[i].name}" failed for ${chunk.file}:`, result.reason);
        }
      }

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, chunks.length, chunk);
      }
    })().finally(() => {
      executing.delete(task);
    });

    executing.add(task);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  // 等待所有剩余的 chunk 任务完成
  await Promise.allSettled(Array.from(executing));
  onDiagnostics?.(failures);

  if (config.severityOverride && Object.keys(config.severityOverride).length > 0) {
    return allComments.map(c => ({
      ...c,
      severity: config.severityOverride[c.category] ?? c.severity,
    }));
  }

  return allComments;
}

export default runOrchestrator;
