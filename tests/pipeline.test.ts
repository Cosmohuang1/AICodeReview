import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PRContext } from '../src/github/diff.fetcher.js';
import type { ParsedFile } from '../src/parser/diff.parser.js';
import type { CodeChunk, PRSummary, ReviewComment } from '../src/agents/types.js';
import { parseRepoConfig } from '../src/config/schema.js';

vi.mock('../src/github/diff.fetcher.js', () => ({
  fetchPRDiff: vi.fn(),
}));

vi.mock('../src/parser/diff.parser.js', () => ({
  parseDiff: vi.fn(),
}));

vi.mock('../src/parser/chunker.js', () => ({
  chunkFiles: vi.fn(),
}));

vi.mock('../src/config/loader.js', () => ({
  loadRepoConfig: vi.fn(),
}));

vi.mock('../src/orchestrator/index.js', () => ({
  runOrchestrator: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../src/filter/self-critique.js', () => ({
  selfCritique: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../src/agents/summary.agent.js', () => ({
  summaryAgent: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../src/github/publisher.js', () => ({
  publishReview: vi.fn(),
}));

import { fetchPRDiff } from '../src/github/diff.fetcher.js';
import { parseDiff } from '../src/parser/diff.parser.js';
import { chunkFiles } from '../src/parser/chunker.js';
import { loadRepoConfig } from '../src/config/loader.js';
import { runOrchestrator } from '../src/orchestrator/index.js';
import { selfCritique } from '../src/filter/self-critique.js';
import { summaryAgent } from '../src/agents/summary.agent.js';
import { publishReview } from '../src/github/publisher.js';
import { runReviewPipeline } from '../src/pipeline.js';

describe('runReviewPipeline', () => {
  const mockCtx: PRContext = {
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 42,
    prTitle: 'feat: add user authentication',
    installationId: 12345,
  };

  const mockParsedFile: ParsedFile = {
    filePath: 'src/auth/login.ts',
    language: 'typescript',
    isNew: false,
    isDeleted: false,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        newLines: ['const token = generateToken(user);'],
        diffPosition: 3,
        rawHunk: '+const token = generateToken(user);',
      },
    ],
  };

  const mockChunk: CodeChunk = {
    file: 'src/auth/login.ts',
    language: 'typescript',
    diffContent: '+const token = generateToken(user);',
    fullContext: 'function login(user) { const token = generateToken(user); }',
    startLine: 1,
    endLine: 1,
    diffPosition: 3,
  };

  const mockRawComment: ReviewComment = {
    file: 'src/auth/login.ts',
    line: 1,
    side: 'RIGHT',
    severity: 'error',
    category: 'security',
    message: 'missing token expiry',
    confidence: 0.8,
    diffPosition: 3,
  };

  const mockFilteredComment: ReviewComment = {
    ...mockRawComment,
    confidence: 0.95,
  };

  const mockSummary: PRSummary = {
    overview: 'Added login token functionality.',
    walkthrough: [{ file: 'src/auth/login.ts', changes: 'Token generation' }],
    mermaidDiagram: 'sequenceDiagram\n  User->>App: Login',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const defaultConfig = parseRepoConfig({});
    vi.mocked(loadRepoConfig).mockReturnValue(defaultConfig);

    vi.mocked(fetchPRDiff).mockResolvedValue({
      rawDiff: 'diff --git a/src/auth/login.ts b/src/auth/login.ts\n...',
      fileContents: new Map([['src/auth/login.ts', 'function login() {}']]),
      originalBody: 'Initial PR description',
    });

    vi.mocked(parseDiff).mockReturnValue([mockParsedFile]);
    vi.mocked(chunkFiles).mockReturnValue([mockChunk]);
    vi.mocked(runOrchestrator).mockResolvedValue([mockRawComment]);
    vi.mocked(selfCritique).mockResolvedValue([mockFilteredComment]);
    vi.mocked(summaryAgent).mockResolvedValue(mockSummary);
    vi.mocked(publishReview).mockResolvedValue(undefined);
  });

  it('orchestrates all review pipeline stages end-to-end', async () => {
    await runReviewPipeline(mockCtx);

    // 1. Diff fetched
    expect(fetchPRDiff).toHaveBeenCalledWith(mockCtx);

    // 2. Repo config loaded
    expect(loadRepoConfig).toHaveBeenCalledWith(null);

    // 3. Diff parsed
    expect(parseDiff).toHaveBeenCalledWith('diff --git a/src/auth/login.ts b/src/auth/login.ts\n...');

    // 4. Chunks generated with filtered files and fileContents
    expect(chunkFiles).toHaveBeenCalledWith([mockParsedFile], expect.any(Map));

    // 5. Orchestrator called with chunks and config
    expect(runOrchestrator).toHaveBeenCalledWith([mockChunk], expect.any(Object));

    // 6. Self-critique filter called with orchestrator output
    expect(selfCritique).toHaveBeenCalledWith([mockRawComment], [mockChunk], expect.any(Object));

    // 7. Summary agent called with title, files, config
    expect(summaryAgent).toHaveBeenCalledWith(mockCtx.prTitle, [mockParsedFile], expect.any(Object));

    // 8. Review published with original PR body and critique-filtered comments
    expect(publishReview).toHaveBeenCalledWith(
      mockCtx,
      mockSummary,
      'Initial PR description',
      [mockFilteredComment]
    );
  });

  describe('dynamic configuration loading (bonus enhancement)', () => {
    it('loads .ai-review.yml when present in fileContents', async () => {
      const ymlContent = 'language: en\nmaxFilesPerReview: 10\n';
      const fileContents = new Map<string, string>([
        ['.ai-review.yml', ymlContent],
        ['src/auth/login.ts', 'code'],
      ]);
      vi.mocked(fetchPRDiff).mockResolvedValue({
        rawDiff: 'diff',
        fileContents,
        originalBody: '',
      });

      const customConfig = parseRepoConfig({ language: 'en', maxFilesPerReview: 10 });
      vi.mocked(loadRepoConfig).mockReturnValue(customConfig);

      await runReviewPipeline(mockCtx);

      expect(loadRepoConfig).toHaveBeenCalledWith(ymlContent);
      expect(runOrchestrator).toHaveBeenCalledWith([mockChunk], customConfig);
      expect(selfCritique).toHaveBeenCalledWith([mockRawComment], [mockChunk], customConfig);
      expect(summaryAgent).toHaveBeenCalledWith(mockCtx.prTitle, [mockParsedFile], customConfig);
    });

    it('loads .ai-review.yaml when .ai-review.yml is not present', async () => {
      const yamlContent = 'selfCritiqueThreshold: 0.8\n';
      const fileContents = new Map<string, string>([
        ['.ai-review.yaml', yamlContent],
        ['src/auth/login.ts', 'code'],
      ]);
      vi.mocked(fetchPRDiff).mockResolvedValue({
        rawDiff: 'diff',
        fileContents,
        originalBody: '',
      });

      await runReviewPipeline(mockCtx);

      expect(loadRepoConfig).toHaveBeenCalledWith(yamlContent);
    });

    it('prefers .ai-review.yml over .ai-review.yaml if both are in fileContents', async () => {
      const ymlContent = 'language: zh\n';
      const yamlContent = 'language: en\n';
      const fileContents = new Map<string, string>([
        ['.ai-review.yml', ymlContent],
        ['.ai-review.yaml', yamlContent],
      ]);
      vi.mocked(fetchPRDiff).mockResolvedValue({
        rawDiff: 'diff',
        fileContents,
        originalBody: '',
      });

      await runReviewPipeline(mockCtx);

      expect(loadRepoConfig).toHaveBeenCalledWith(ymlContent);
    });

    it('passes null to loadRepoConfig when neither config file is present', async () => {
      const fileContents = new Map<string, string>([
        ['src/auth/login.ts', 'code'],
      ]);
      vi.mocked(fetchPRDiff).mockResolvedValue({
        rawDiff: 'diff',
        fileContents,
        originalBody: '',
      });

      await runReviewPipeline(mockCtx);

      expect(loadRepoConfig).toHaveBeenCalledWith(null);
    });
  });

  describe('file filtering and exclusion', () => {
    it('filters out files matching default exclude patterns', async () => {
      const files: ParsedFile[] = [
        { ...mockParsedFile, filePath: 'src/main.ts' },
        { ...mockParsedFile, filePath: 'dist/index.js' },
        { ...mockParsedFile, filePath: 'package-lock.json' },
        { ...mockParsedFile, filePath: 'src/vendor.min.js' },
        { ...mockParsedFile, filePath: 'src/service.generated.ts' },
      ];
      vi.mocked(parseDiff).mockReturnValue(files);

      await runReviewPipeline(mockCtx);

      // Only src/main.ts should pass through
      expect(chunkFiles).toHaveBeenCalledWith(
        [expect.objectContaining({ filePath: 'src/main.ts' })],
        expect.any(Map)
      );
      expect(summaryAgent).toHaveBeenCalledWith(
        mockCtx.prTitle,
        [expect.objectContaining({ filePath: 'src/main.ts' })],
        expect.any(Object)
      );
    });

    it('filters out files matching custom exclude patterns from repo config', async () => {
      const customConfig = parseRepoConfig({
        exclude: ['*.snap', 'coverage/**', '__mocks__/**'],
      });
      vi.mocked(loadRepoConfig).mockReturnValue(customConfig);

      const files: ParsedFile[] = [
        { ...mockParsedFile, filePath: 'src/app.ts' },
        { ...mockParsedFile, filePath: 'tests/__snapshots__/app.test.ts.snap' },
        { ...mockParsedFile, filePath: 'coverage/lcov.info' },
        { ...mockParsedFile, filePath: '__mocks__/db.ts' },
      ];
      vi.mocked(parseDiff).mockReturnValue(files);

      await runReviewPipeline(mockCtx);

      expect(chunkFiles).toHaveBeenCalledWith(
        [expect.objectContaining({ filePath: 'src/app.ts' })],
        expect.any(Map)
      );
    });
  });

  describe('maxFilesPerReview limit', () => {
    it('limits files to maxFilesPerReview and logs a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = parseRepoConfig({ maxFilesPerReview: 2 });
      vi.mocked(loadRepoConfig).mockReturnValue(config);

      const files: ParsedFile[] = [
        { ...mockParsedFile, filePath: 'src/1.ts' },
        { ...mockParsedFile, filePath: 'src/2.ts' },
        { ...mockParsedFile, filePath: 'src/3.ts' },
        { ...mockParsedFile, filePath: 'src/4.ts' },
      ];
      vi.mocked(parseDiff).mockReturnValue(files);

      await runReviewPipeline(mockCtx);

      expect(chunkFiles).toHaveBeenCalledWith(
        [
          expect.objectContaining({ filePath: 'src/1.ts' }),
          expect.objectContaining({ filePath: 'src/2.ts' }),
        ],
        expect.any(Map)
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('文件数超限')
      );

      warnSpy.mockRestore();
    });

    it('does not log warning when file count is within maxFilesPerReview', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = parseRepoConfig({ maxFilesPerReview: 5 });
      vi.mocked(loadRepoConfig).mockReturnValue(config);

      const files: ParsedFile[] = [
        { ...mockParsedFile, filePath: 'src/1.ts' },
        { ...mockParsedFile, filePath: 'src/2.ts' },
      ];
      vi.mocked(parseDiff).mockReturnValue(files);

      await runReviewPipeline(mockCtx);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('error handling and resilience', () => {
    it('falls back to default summary when summaryAgent fails', async () => {
      vi.mocked(summaryAgent).mockRejectedValueOnce(new Error('DeepSeek API timed out'));

      await runReviewPipeline(mockCtx);

      expect(publishReview).toHaveBeenCalledWith(
        mockCtx,
        expect.objectContaining({
          overview: expect.any(String),
          walkthrough: expect.any(Array),
          mermaidDiagram: '',
        }),
        'Initial PR description',
        [mockFilteredComment]
      );
    });

    it('propagates error when fetchPRDiff fails', async () => {
      vi.mocked(fetchPRDiff).mockRejectedValueOnce(new Error('GitHub API rate limit exceeded'));

      await expect(runReviewPipeline(mockCtx)).rejects.toThrow('GitHub API rate limit exceeded');
      expect(publishReview).not.toHaveBeenCalled();
    });

    it('handles empty diff gracefully', async () => {
      vi.mocked(parseDiff).mockReturnValue([]);
      vi.mocked(chunkFiles).mockReturnValue([]);
      vi.mocked(runOrchestrator).mockResolvedValue([]);
      vi.mocked(selfCritique).mockResolvedValue([]);

      await runReviewPipeline(mockCtx);

      expect(chunkFiles).toHaveBeenCalledWith([], expect.any(Map));
      expect(runOrchestrator).toHaveBeenCalledWith([], expect.any(Object));
      expect(publishReview).toHaveBeenCalledWith(
        mockCtx,
        mockSummary,
        'Initial PR description',
        []
      );
    });
  });
});
