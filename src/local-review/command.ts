import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectGitChanges } from './git.js';
import { loadBrowserConfig, planAffectedScenarios } from './config.js';
import { runBrowserVerification } from './browser.js';
import { analyzeImpact, type ImpactAnalysis } from './impact.js';
import { proposeReadOnlyScenarios } from './ai-planner.js';
import { linkReviewEvidence } from './evidence.js';
import { renderLocalReviewHTML } from './html.js';
import { compareWithBaseline } from './baseline.js';
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
    .option('--browser-only', 'skip DeepSeek code review and run browser verification')
    .option('--ai-tests', 'opt into read-only AI-proposed UI test scenarios')
    .option('--baseline-url <url>', 'compare configured assertions against a separately running local baseline')
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
      browser?: boolean; browserOnly?: boolean; aiTests?: boolean; baselineUrl?: string; url?: string;
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
        let baseline: BrowserVerificationResult | null = null;
        let comparison: ReturnType<typeof compareWithBaseline> | null = null;
        let impact: ImpactAnalysis | null = null;
        let aiRationales: Record<string, string> = {};
        const browserEnabled = options.browser || options.browserOnly || options.aiTests || options.baselineUrl;
        if (browserEnabled) {
          impact = analyzeImpact(cwd, changes.files, browserConfig);
          const explicitAndInferred = { ...browserConfig, mappings: impact.mappings };
          const plan = planAffectedScenarios(changes.files, explicitAndInferred);
          const planned = [...plan.scenarios];
          const warnings = [...plan.warnings, ...impact.warnings];
          if (options.aiTests || browserConfig.aiPlanning.enabled) {
            if (!process.env.DEEPSEEK_API_KEY) {
              warnings.push('AI planning skipped: DEEPSEEK_API_KEY not configured.');
            } else {
              const ai = await proposeReadOnlyScenarios({
                routes: impact.routes,
                diff: changes.rawDiff,
                remainingBudget: Math.min(browserConfig.aiPlanning.maxScenarios,
                  Math.max(0, browserConfig.maxScenarios - planned.length))
              });
              planned.push(...ai.scenarios);
              warnings.push(...ai.warnings);
              aiRationales = ai.rationales;
            }
          }
          writeFileSync(path.join(outputDir, 'test-plan.json'), JSON.stringify(
            planned.map(scenario => ({
              ...scenario,
              actions: scenario.actions.map(action =>
                action.type === 'fill' ? { ...action, value: '[REDACTED]' } : action)
            })), null, 2), 'utf8');
          browser = await runBrowserVerification({
            cwd, config: browserConfig, baseURL: browserConfig.baseURL,
            scenarios: planned, unmappedFiles: plan.unmappedFiles,
            warnings, artifactDir: path.join(outputDir, 'artifacts'),
            approveServerStart: Boolean(options.approveServerStart),
            approveCDP: Boolean(options.approveCdp), endpoint: options.cdpEndpoint
          });
          if (options.baselineUrl) {
            // Baseline must already be served independently. Never start commands
            // against an old Git tree or access personal Chrome for the baseline.
            const baselineConfig = {
              ...browserConfig,
              server: { ...browserConfig.server, mode: 'existing' as const },
              connection: { ...browserConfig.connection, mode: 'isolated' as const },
              allowedOrigins: [options.baselineUrl]
            };
            baseline = await runBrowserVerification({
              cwd, config: baselineConfig, baseURL: options.baselineUrl,
              scenarios: planned, unmappedFiles: plan.unmappedFiles,
              warnings: [], artifactDir: path.join(outputDir, 'baseline-artifacts'),
              approveServerStart: false, approveCDP: false
            });
            comparison = compareWithBaseline(browser, baseline);
          }
        }

        const linked = linkReviewEvidence(review?.comments ?? [], browser);
        const findings = linked.findings;

        const filesSkipped = review ? changes.files.filter(
          file => !review!.analyzedFiles.some(analyzed => analyzed.filePath === file)
        ) : [];
        // Legacy Agents cannot yet report execution completeness.
        const partial = Boolean(review) || filesSkipped.length > 0 ||
          Boolean(browser && ['partial', 'skipped'].includes(browser.status)) || Boolean(impact?.truncated);
        const hasFindings = findings.some(f => f.severity === 'error') || browser?.status === 'failed';

        const report = {
          schemaVersion: 1, runId, startedAt: new Date(started).toISOString(),
          durationMs: Date.now() - started,
          git: { ...changes, rawDiff: undefined },
          impact: impact ? { routes: impact.routes, scannedFiles: impact.scannedFiles,
            truncated: impact.truncated, warnings: impact.warnings } : null,
          evidence: linked.evidence,
          unattributedFailures: linked.unattributedFailures,
          aiTestRationales: aiRationales,
          baseline: baseline ? { url: options.baselineUrl, ...baseline } : null,
          regressionComparison: comparison,
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

        writeFileSync(output, reviewMd + browserMarkdown(browser) +
          (comparison ? '\n## Baseline comparison (potential regressions, not proof)\n\n' +
            comparison.map(item => '- ' + item.scenarioId + ': ' + item.assessment + ' (' + item.note + ')').join('\n') : ''), 'utf8');
        const htmlPath = path.join(outputDir, 'report.html');
        writeFileSync(htmlPath, renderLocalReviewHTML({
          runId, status: report.status, head: changes.head, impact, browser,
          findings, evidence: linked.evidence, reportDir: outputDir,
          regressionComparison: comparison
        }), 'utf8');
        const jsonPath = path.join(outputDir, 'report.json');
        writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
        console.log('Review status: ' + report.status + '\nMarkdown: ' + output + '\nJSON: ' + jsonPath + '\nHTML: ' + htmlPath);

        if (hasFindings) process.exitCode = 1;
        else if (partial) process.exitCode = 3;
      } catch (error) {
        console.error('[ai-review] ' + (error instanceof Error ? error.message : String(error)));
        process.exitCode = 2;
      }
    });
}
