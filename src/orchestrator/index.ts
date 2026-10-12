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

export async function runOrchestrator(
  chunks: CodeChunk[],
  config: RepoConfig
): Promise<ReviewComment[]> {
  if (chunks.length === 0) return [];

  const allComments: ReviewComment[] = [];

  for (const chunk of chunks) {
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
  }

  if (config.severityOverride && Object.keys(config.severityOverride).length > 0) {
    return allComments.map(c => ({
      ...c,
      severity: config.severityOverride[c.category] ?? c.severity,
    }));
  }

  return allComments;
}

export default runOrchestrator;
