import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewService, type ReviewExecutionOptions } from '../../src/services/review.service.js';
import { parseRepoConfig } from '../../src/config/schema.js';

// Mock core review steps
vi.mock('../../src/orchestrator/index.js', () => ({
  runOrchestrator: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../../src/filter/self-critique.js', () => ({
  selfCritique: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../../src/agents/summary.agent.js', () => ({
  summaryAgent: vi.fn(),
  default: vi.fn(),
}));

import { runOrchestrator } from '../../src/orchestrator/index.js';
import { selfCritique } from '../../src/filter/self-critique.js';
import { summaryAgent } from '../../src/agents/summary.agent.js';

describe('ReviewService', () => {
  const sampleDiff = `diff --git a/src/index.ts b/src/index.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/index.ts
@@ -0,0 +1,5 @@
+export const API_KEY = "AKIA1234567890123456";
+export function add(a: number, b: number) {
+  return a + b;
+}
`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runOrchestrator).mockResolvedValue([
      {
        file: 'src/index.ts',
        line: 2,
        side: 'RIGHT',
        severity: 'warning',
        category: 'style',
        message: 'Missing type annotation',
        suggestion: 'export function add(a: number, b: number): number {',
        confidence: 0.8,
      },
    ]);
    vi.mocked(selfCritique).mockImplementation(async (comments) => comments);
    vi.mocked(summaryAgent).mockResolvedValue({
      overview: 'Added add function and API key',
      walkthrough: [{ file: 'src/index.ts', changes: 'Added add function' }],
      mermaidDiagram: 'graph TD; A-->B',
    });
  });

  it('handles empty diff gracefully', async () => {
    const config = parseRepoConfig({});
    const result = await ReviewService.executeReview({
      rawDiff: '',
      config,
      contextTitle: 'Test Empty Diff',
    });

    expect(result.parsedFiles).toHaveLength(0);
    expect(result.comments).toHaveLength(0);
    expect(result.summary.overview).toContain('未检测到');
  });

  it('executes full pipeline: deterministic scan, orchestrator, dedup, self-critique, anchoring and enrichment', async () => {
    const config = parseRepoConfig({});
    const fileContents = new Map<string, string>();
    fileContents.set('src/index.ts', 'export const API_KEY = "AKIA1234567890123456";\nexport function add(a: number, b: number) {\n  return a + b;\n}');

    const stepsCalled: string[] = [];
    const options: ReviewExecutionOptions = {
      rawDiff: sampleDiff,
      fileContents,
      config,
      contextTitle: 'Test Full Review',
      onStep: (step, name) => {
        stepsCalled.push(`${step}:${name}`);
      },
    };

    const result = await ReviewService.executeReview(options);

    expect(result.parsedFiles).toHaveLength(1);
    expect(result.analyzedFiles).toHaveLength(1);
    expect(result.chunks.length).toBeGreaterThan(0);
    // Should capture deterministic rule comment for AWS Key
    expect(result.deterministicCount).toBeGreaterThanOrEqual(1);
    // Should have enriched fields: priority, tag, whyPriority, diffSnippet
    expect(result.comments.length).toBeGreaterThanOrEqual(1);
    const p0 = result.comments.find(c => c.priority === 'P0');
    expect(p0).toBeDefined();
    expect(p0?.category).toBe('security');

    // Summary should be populated
    expect(result.summary.overview).toBe('Added add function and API key');
    expect(stepsCalled.length).toBeGreaterThan(0);
  });

  it('respects file exclusions from config', async () => {
    const config = parseRepoConfig({
      exclude: ['src/index.ts'],
    });

    const result = await ReviewService.executeReview({
      rawDiff: sampleDiff,
      config,
      contextTitle: 'Excluded Test',
    });

    expect(result.analyzedFiles).toHaveLength(0);
    expect(result.comments).toHaveLength(0);
  });
});
