import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewComment, CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

vi.mock('../../src/agents/bug.agent.js', () => ({
  bugAgent: vi.fn(),
  default: vi.fn(),
}));
vi.mock('../../src/agents/security.agent.js', () => ({
  securityAgent: vi.fn(),
  default: vi.fn(),
}));
vi.mock('../../src/agents/performance.agent.js', () => ({
  performanceAgent: vi.fn(),
  default: vi.fn(),
}));
vi.mock('../../src/agents/style.agent.js', () => ({
  styleAgent: vi.fn(),
  default: vi.fn(),
}));
vi.mock('../../src/agents/test.agent.js', () => ({
  testAgent: vi.fn(),
  default: vi.fn(),
}));
vi.mock('../../src/agents/custom.agent.js', () => ({
  customAgent: vi.fn(),
  default: vi.fn(),
}));

import { runOrchestrator } from '../../src/orchestrator/index.js';
import { bugAgent } from '../../src/agents/bug.agent.js';
import { securityAgent } from '../../src/agents/security.agent.js';
import { performanceAgent } from '../../src/agents/performance.agent.js';
import { styleAgent } from '../../src/agents/style.agent.js';
import { testAgent } from '../../src/agents/test.agent.js';
import { customAgent } from '../../src/agents/custom.agent.js';

const mockChunk: CodeChunk = {
  file: 'a.ts',
  language: 'typescript',
  diffContent: '+const x = 1;',
  fullContext: 'const x = 1;',
  startLine: 1,
  endLine: 1,
  diffPosition: 3,
};

const mockComment: ReviewComment = {
  file: 'a.ts',
  line: 1,
  side: 'RIGHT',
  severity: 'error',
  category: 'bug',
  message: 'bug found',
  confidence: 0.9,
};

describe('runOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bugAgent).mockResolvedValue([mockComment]);
    vi.mocked(securityAgent).mockResolvedValue([]);
    vi.mocked(performanceAgent).mockResolvedValue([]);
    vi.mocked(styleAgent).mockResolvedValue([]);
    vi.mocked(testAgent).mockResolvedValue([]);
    vi.mocked(customAgent).mockResolvedValue([]);
  });

  it('collects results from all agents', async () => {
    const config = parseRepoConfig({});
    const results = await runOrchestrator([mockChunk], config);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe('bug');
    expect(results[0].message).toBe('bug found');
  });

  it('handles empty chunks array without calling agents', async () => {
    const config = parseRepoConfig({});
    const results = await runOrchestrator([], config);
    expect(results).toEqual([]);
    expect(bugAgent).not.toHaveBeenCalled();
    expect(securityAgent).not.toHaveBeenCalled();
  });

  it('dispatches to all 6 agents for each chunk', async () => {
    const config = parseRepoConfig({});
    await runOrchestrator([mockChunk], config);
    expect(bugAgent).toHaveBeenCalledWith(mockChunk, config);
    expect(securityAgent).toHaveBeenCalledWith(mockChunk, config);
    expect(performanceAgent).toHaveBeenCalledWith(mockChunk, config);
    expect(styleAgent).toHaveBeenCalledWith(mockChunk, config);
    expect(testAgent).toHaveBeenCalledWith(mockChunk, config);
    expect(customAgent).toHaveBeenCalledWith(mockChunk, config);
  });

  it('is resilient when an agent throws an error or rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(securityAgent).mockRejectedValueOnce(new Error('API failure'));
    const config = parseRepoConfig({});
    const results = await runOrchestrator([mockChunk], config);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('bug');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ai-review] Agent "security" failed'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('processes multiple chunks and aggregates all comments', async () => {
    const chunk2: CodeChunk = {
      file: 'b.ts',
      language: 'typescript',
      diffContent: '+const y = 2;',
      fullContext: 'const y = 2;',
      startLine: 10,
      endLine: 10,
      diffPosition: 5,
    };
    const secComment: ReviewComment = {
      file: 'b.ts',
      line: 10,
      side: 'RIGHT',
      severity: 'error',
      category: 'security',
      message: 'hardcoded key',
      confidence: 0.95,
    };
    vi.mocked(securityAgent).mockResolvedValueOnce([]).mockResolvedValueOnce([secComment]);

    const config = parseRepoConfig({});
    const results = await runOrchestrator([mockChunk, chunk2], config);
    expect(results).toHaveLength(3); // bug for chunk1 (mockComment), bug for chunk2 (mockComment), sec for chunk2 (secComment)
  });

  it('applies severityOverride from RepoConfig', async () => {
    const config = parseRepoConfig({
      severityOverride: { bug: 'warning' },
    });
    const results = await runOrchestrator([mockChunk], config);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('bug');
    expect(results[0].severity).toBe('warning');
  });

  it('respects concurrency limit when processing many chunks', async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;

    vi.mocked(bugAgent).mockImplementation(async () => {
      activeTasks++;
      if (activeTasks > maxActiveTasks) {
        maxActiveTasks = activeTasks;
      }
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 20));
      activeTasks--;
      return [];
    });

    const chunks: CodeChunk[] = Array.from({ length: 10 }, (_, i) => ({
      file: `file${i}.ts`,
      language: 'typescript',
      diffContent: `+line${i}`,
      fullContext: `line${i}`,
      startLine: 1,
      endLine: 1,
      diffPosition: 1,
    }));

    const config = parseRepoConfig({});
    await runOrchestrator(chunks, config);
    expect(maxActiveTasks).toBeLessThanOrEqual(4);
    expect(maxActiveTasks).toBeGreaterThan(1);
  });
});
