import type { Command } from 'commander';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { collectLocalChanges, type Scope } from './git.js';
import { parseBrowserConfig, verifyBrowser, type BrowserResult } from './browser.js';
import { loadRepoConfig } from '../config/loader.js';
import { ReviewService } from '../services/review.service.js';
import { buildPRBody, buildInlineCommentBody } from '../reporter/markdown.reporter.js';

function contextFiles(root: string, filenames: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const realRoot = fs.realpathSync(root);
  for (const filename of filenames) {
    try {
      const resolved = path.resolve(root, filename);
      if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) continue;
      const actual = fs.realpathSync(resolved);
      if (!actual.startsWith(realRoot + path.sep)) continue;
      const stat = fs.statSync(actual);
      if (stat.size > 256 * 1024 || !stat.isFile()) continue;
      const data = fs.readFileSync(actual);
      if (!data.includes(0)) map.set(filename, data.toString('utf8'));
    } catch { /* deleted or unreadable */ }
  }
  return map;
}
function markdownBrowser(result: BrowserResult | null): string {
  if (!result) return '\n## Browser verification\nNot requested.\n';
  const items = result.scenarios.map(s => '\n### ' + s.id +
    '\n- route: ' + s.route + '\n- status: ' + s.status +
    '\n- duration: ' + s.durationMs + 'ms\n- details: ' + (s.message || 'none') +
    '\n' + s.artifacts.map(file => '- artifact: ' + file).join('\n')).join('\n');
  return '\n## Browser verification\n\nStatus: **' + result.status + '**; ' +
    result.executed + '/' + result.planned + ' scenarios executed.\n' + items +
    '\n\nUnmapped files: ' + (result.unmappedFiles.join(', ') || 'none') +
    '\n\nWarnings: ' + (result.warnings.join('; ') || 'none') + '\n';
}
export function registerLocalReviewCommand(program: Command): void {
  program.command('review')
    .description('Review local changes and optionally verify mapped browser scenarios')
    .option('--scope <scope>', 'working | staged | last | branch', 'working')
    .option('--base <ref>', 'compare HEAD against a branch/ref merge base')
    .option('--include-untracked', 'include untracked text files')
    .option('--browser', 'run mapped scenarios in isolated Playwright Chromium')
    .option('--browser-only', 'skip the LLM review; run browser verification only')
    .option('--url <url>', 'existing localhost application URL')
    .option('-c, --config <file>', 'YAML config path', '.ai-review.yml')
    .option('-o, --output <file>', 'Markdown report path')
    .action(async (options: {
      scope: Scope; base?: string; includeUntracked?: boolean;
      browser?: boolean; browserOnly?: boolean; url?: string;
      config: string; output?: string;
    }) => {
      try {
        const cwd = process.cwd();
        const configPath = path.resolve(cwd, options.config);
        const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
        const browserConfig = parseBrowserConfig(configText);
        const repoConfig = loadRepoConfig(configText);
        const changes = collectLocalChanges({
          cwd, scope: options.scope, base: options.base, includeUntracked: options.includeUntracked
        });
        if (!changes.diff.trim()) { console.log('No changes to review.'); return; }
        const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
        const reportFile = path.resolve(cwd, options.output || '.ai-review/runs/' + runId + '/report.md');
        const reportDir = path.dirname(reportFile);
        fs.mkdirSync(reportDir, { recursive: true });
        let review: Awaited<ReturnType<typeof ReviewService.executeReview>> | null = null;
        if (!options.browserOnly) {
          if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY missing; use --browser-only for browser verification');
          review = await ReviewService.executeReview({
            rawDiff: changes.diff,
            fileContents: contextFiles(cwd, changes.files),
            config: repoConfig,
            contextTitle: 'Local ' + changes.scope + ' review',
            onStep: (step, label) => console.log('[Review ' + step + '] ' + label)
          });
        }
        const browser = options.browser || options.browserOnly
          ? await verifyBrowser({ config: browserConfig, files: changes.files,
            url: options.url, artifactDir: path.join(reportDir, 'artifacts') })
          : null;
        const findings = (review?.comments || []).map(c => ({
          id: createHash('sha256').update(c.file + ':' + c.line + ':' + c.category + ':' + c.message).digest('hex').slice(0, 16),
          file: c.file, line: c.line, severity: c.severity, category: c.category,
          explanation: c.message, suggestion: c.suggestion,
          verification: { status: 'unverified', evidenceIds: [] as string[] }
        }));
        const skippedFiles = review ? changes.files.filter(file =>
          !review!.analyzedFiles.some(checked => checked.filePath === file)) : [];
        const isPartial = Boolean(browser && ['partial', 'skipped'].includes(browser.status)) || skippedFiles.length > 0;
        const status = (browser?.status === 'failed' || findings.some(f => f.severity === 'error'))
          ? 'findings' : isPartial ? 'partial' : 'passed';
        const report = {
          schemaVersion: 1, runId, status,
          git: { scope: changes.scope, revision: changes.revision, files: changes.files, warnings: changes.warnings },
          review: review ? { summary: review.summary, findings, skippedFiles,
            agentExecutionCompleteness: 'unknown' } : { skipped: true },
          browser
        };
        const reviewMd = review ? buildPRBody(review.summary, '# Local Code Review', repoConfig.language) +
          '\n\n## Findings\n\n' + (review.comments.length ? review.comments.map(c =>
            '### ' + c.file + ':' + c.line + '\n\n' + buildInlineCommentBody(c)).join('\n\n') :
            'No findings reported by completed steps. Agent execution completeness is unknown.') :
          '# Local Browser Verification\n\nLLM review skipped.\n';
        fs.writeFileSync(reportFile, reviewMd + markdownBrowser(browser), 'utf8');
        const jsonFile = path.join(reportDir, 'report.json');
        fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), 'utf8');
        console.log('Status: ' + status + '\nMarkdown: ' + reportFile + '\nJSON: ' + jsonFile);
        if (status === 'findings') process.exitCode = 1;
        else if (status === 'partial') process.exitCode = 3;
      } catch (error) {
        console.error('[ai-review] ' + (error instanceof Error ? error.message : String(error)));
        process.exitCode = 2;
      }
    });
}
