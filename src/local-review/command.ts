import type { Command } from 'commander';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectGitChanges } from './git.js';
import { loadBrowserConfig, planAffectedScenarios } from './config.js';
import { runBrowserVerification } from './browser.js';
import { loadRepoConfig } from '../config/loader.js';
import { ReviewService } from '../services/review.service.js';
import { buildPRBody, buildInlineCommentBody } from '../reporter/markdown.reporter.js';
import type { GitScope, BrowserVerificationResult } from './types.js';

function contextFiles(root: string, filenames: string[]): Map<string, string> {
  const contents = new Map<string, string>();
  const realRoot = realpathSync(root);
  for (const filename of filenames) {
    const full = path.resolve(root, filename);
    if (!full.startsWith(path.resolve(root) + path.sep) || !existsSync(full)) continue;
    try {
      const actual = realpathSync(full);
      if (!actual.startsWith(realRoot + path.sep)) continue;
      const buffer = readFileSync(actual);
      if (buffer.length <= 256 * 1024 && !buffer.includes(0)) {
        contents.set(filename, buffer.toString('utf8'));
      }
    } catch { /* deleted, binary or unreadable */ }
  }
  return contents;
}

function escaped(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function browserMarkdown(browser: BrowserVerificationResult | null): string {
  if (!browser) return '\n## 浏览器验证\n\n未启用（使用 --browser）。\n';
  const rows = browser.scenarios.map(s =>
    '| ' + escaped(s.id) + ' | ' + escaped(s.route) + ' | ' + s.status +
    ' | ' + s.expectationSource + ' | ' + s.durationMs + 'ms |'
  ).join('\n');
  return '\n## 浏览器验证\n\n状态：**' + browser.status + '**，计划 ' +
    browser.planned + '，已执行 ' + browser.executed + '。\n\n' +
    '| 测试 | 路由 | 结果 | 依据 | 耗时 |\n| --- | --- | --- | --- | --- |\n' + rows + '\n' +
    browser.scenarios.map(s => '\n### ' + escaped(s.id) + '\n' +
      (s.messages.map(m => '- ' + escaped(m)).join('\n') || '无异常记录') + '\n' +
      s.evidence.map(e => '- Evidence: ' + e).join('\n')).join('\n') +
    (browser.unmappedFiles.length ?
      '\n\n**未映射文件：** ' + browser.unmappedFiles.map(escaped).join(', ') + '\n' : '') +
    (browser.warnings.length ?
      '\n**警告：**\n' + browser.warnings.map(x => '- ' + escaped(x)).join('\n') + '\n' : '');
}

export function registerLocalReviewCommand(program: Command): void {
  program.command('review')
    .description('Review local Git changes and optionally verify affected browser routes')
    .option('--scope <scope>', 'working | staged | last | branch', 'working')
    .option('--base <git-ref>', 'branch comparison baseline (merge-base)')
    .option('--include-untracked', 'include untracked text files (max 256 KB each)')
    .option('--browser', 'verify impacted routes using Playwright')
    .option('--browser-only', 'skip DeepSeek and run only browser verification')
    .option('--url <url>', 'local application base URL')
    .option('--server-mode <mode>', 'existing | managed')
    .option('--browser-connection <mode>', 'isolated | cdp')
    .option('--cdp-endpoint <url>', 'approved Chrome CDP endpoint')
    .option('--approve-server-start', 'approve configured dev-server command')
    .option('--approve-cdp', 'approve accessing an existing Chrome CDP session')
    .option('-c, --config <path>', 'repository YAML config', '.ai-review.yml')
    .option('-o, --output <path>', 'Markdown report path')
    .action(async (options: {
      scope: GitScope; base?: string; includeUntracked?: boolean;
      browser?: boolean; browserOnly?: boolean; url?: string;
      serverMode?: 'existing' | 'managed'; browserConnection?: 'isolated' | 'cdp';
      cdpEndpoint?: string; approveServerStart?: boolean; approveCdp?: boolean;
      config: string; output?: string;
    }) => {
      try {
        const cwd = process.cwd();
        const configPath = path.resolve(cwd, options.config);
        const text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
        const browserConfig = loadBrowserConfig(text);
        const reviewConfig = loadRepoConfig(text);
        if (options.url) browserConfig.baseURL = options.url;
        if (options.serverMode) browserConfig.server.mode = options.serverMode;
        if (options.browserConnection) browserConfig.connection.mode = options.browserConnection;
        if (options.cdpEndpoint) browserConfig.connection.endpoint = options.cdpEndpoint;

        const changes = collectGitChanges({
          cwd, scope: options.base ? 'branch' : options.scope,
          base: options.base, includeUntracked: options.includeUntracked
        });
        if (!changes.rawDiff.trim()) {
          console.log('No changed files. Nothing to review or verify.');
          return;
        }

        const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
        const output = path.resolve(cwd, options.output || ('.ai-review/runs/' + runId + '/report.md'));
        const outputDir = path.dirname(output);
        mkdirSync(outputDir, { recursive: true });
        const started = Date.now();
        let review: Awaited<ReturnType<typeof ReviewService.executeReview>> | null = null;

        if (!options.browserOnly) {
          if (!process.env.DEEPSEEK_API_KEY) {
            throw new Error('DEEPSEEK_API_KEY is required; use --browser-only for browser tests without AI.');
          }
          review = await ReviewService.executeReview({
            rawDiff: changes.rawDiff,
            fileContents: contextFiles(cwd, changes.files),
            config: reviewConfig,
            contextTitle: 'Local ' + changes.scope + ' review',
            onStep: (step, name) => console.log('[Review ' + step + '] ' + name)
          });
        }

        let browser: BrowserVerificationResult | null = null;
        if (options.browser || options.browserOnly) {
          const plan = planAffectedScenarios(changes.files, browserConfig);
          browser = await runBrowserVerification({
            cwd, config: browserConfig, baseURL: browserConfig.baseURL,
            scenarios: plan.scenarios, unmappedFiles: plan.unmappedFiles,
            warnings: plan.warnings, artifactDir: path.join(outputDir, 'artifacts'),
            approveServerStart: Boolean(options.approveServerStart),
            approveCDP: Boolean(options.approveCdp), endpoint: options.cdpEndpoint
          });
        }

        const findings = review?.comments.map(comment => ({
          id: createHash('sha256').update(
            [comment.file, comment.line, comment.category, comment.message].join(':')
          ).digest('hex').slice(0, 16),
          location: { file: comment.file, line: comment.line },
          severity: comment.severity, category: comment.category,
          explanation: comment.message, suggestion: comment.suggestion,
          verification: { status: 'unverified', evidenceIds: [] as string[] }
        })) ?? [];

        const filesSkipped = review ? changes.files.filter(
          file => !review!.analyzedFiles.some(analyzed => analyzed.filePath === file)
        ) : [];
        // Legacy Agents cannot yet report execution completeness.
        const partial = Boolean(review) || filesSkipped.length > 0 ||
          Boolean(browser && ['partial', 'skipped'].includes(browser.status));
        const hasFindings = findings.some(f => f.severity === 'error') || browser?.status === 'failed';

        const report = {
          schemaVersion: 1, runId, startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          git: { ...changes, rawDiff: undefined },
          review: review ? {
            analyzedFiles: review.analyzedFiles.map(f => f.filePath),
            findings, summary: review.summary,
            executionCompleteness: 'unknown',
            filesSkipped
          } : { skipped: true },
          browser,
          status: hasFindings ? 'findings' : partial ? 'partial' : 'passed'
        };

        const reviewMd = review
          ? buildPRBody(review.summary, '# Local Code Review', reviewConfig.language) + '\n' +
            (review.comments.length ? '\n## Review Findings\n\n' + review.comments.map(c =>
              '### ' + c.file + ':' + c.line + '\n\n' + buildInlineCommentBody(c)).join('\n\n')
              : '\nNo findings returned from completed review steps. Agent completeness is currently unknown.\n')
          : '# Local Browser Verification\n\nDeepSeek review skipped.\n';

        writeFileSync(output, reviewMd + browserMarkdown(browser), 'utf8');
        const jsonPath = path.join(outputDir, 'report.json');
        writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
        console.log('Review status: ' + report.status + '\nMarkdown: ' + output + '\nJSON: ' + jsonPath);

        if (hasFindings) process.exitCode = 1;
        else if (partial) process.exitCode = 3;
      } catch (error) {
        console.error('[ai-review] ' + (error instanceof Error ? error.message : String(error)));
        process.exitCode = 2;
      }
    });
}
