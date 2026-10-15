import path from 'node:path';
import type { BrowserVerificationResult } from './types.js';
import type { ImpactAnalysis } from './impact.js';
import type { LinkedEvidence, LinkedFinding } from './evidence.js';
import { evidenceHref } from './evidence.js';
import type { RegressionComparison } from './baseline.js';
import type { ProjectTestReport } from '../testing/project-tests.js';

function escapeHTML(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
  );
}

export function renderLocalReviewHTML(input: {
  runId: string;
  status: string;
  head: string;
  impact: ImpactAnalysis | null;
  browser: BrowserVerificationResult | null;
  findings: LinkedFinding[];
  evidence: LinkedEvidence[];
  reportDir: string;
  regressionComparison?: RegressionComparison[] | null;
  testing?: ProjectTestReport | null;
}): string {
  const evidenceById = new Map(input.evidence.map(e => [e.id, e]));
  const linkArtifacts = (items: string[]) => items.map(filename => {
    const rel = evidenceHref(input.reportDir, filename);
    if (!rel) return '';
    const name = path.basename(filename);
    return '<a href="' + escapeHTML(rel) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHTML(name) + '</a>';
  }).filter(Boolean).join(' ');
  const findings = input.findings.map(f =>
    '<article><h3>' + escapeHTML(f.category) + ' · ' + escapeHTML(f.location.file) +
    ':' + f.location.line + '</h3><p>' + escapeHTML(f.explanation) +
    '</p><small>Severity: ' + escapeHTML(f.severity) + ' · Evidence: ' +
    escapeHTML(f.verification.status) + '</small><p>' + escapeHTML(f.verification.note) + '</p>' +
    f.verification.evidenceIds.map(id => {
      const e = evidenceById.get(id);
      return e ? '<p>Scenario ' + escapeHTML(e.scenarioId) + ': ' +
        linkArtifacts(e.artifactPaths) + '</p>' : '';
    }).join('') + '</article>'
  ).join('');
  const routes = (input.impact?.routes ?? []).map(r =>
    '<li><code>' + escapeHTML(r.route) + '</code> · ' + escapeHTML(r.confidence) +
    ' · ' + escapeHTML(r.sourceFiles.join(', ')) + '</li>'
  ).join('');
  const scenarios = (input.browser?.scenarios ?? []).map(s =>
    '<tr><td>' + escapeHTML(s.id) + '</td><td>' + escapeHTML(s.route) +
    '</td><td>' + escapeHTML(s.status) + '</td><td>' + escapeHTML(s.expectationSource) +
    '</td><td>' + escapeHTML(s.messages.join('; ')) + '</td><td>' + linkArtifacts(s.evidence) +
    '</td></tr>'
  ).join('');
  const regressions = (input.regressionComparison ?? []).map(item =>
    '<li><strong>' + escapeHTML(item.assessment) + '</strong> · ' +
    escapeHTML(item.scenarioId) + ' · ' + escapeHTML(item.note) + '</li>'
  ).join('');

  const testing = input.testing;
  const testRows = (testing?.projects ?? []).map(project => {
    const execution = testing?.executions.find(e =>
      e.project.kind === project.kind && e.project.directory === project.directory);
    return '<tr><td>' + escapeHTML(project.kind) + '</td><td>' +
      escapeHTML(project.directory) + '</td><td>' + escapeHTML(project.note) +
      '</td><td>' + escapeHTML(execution?.status ?? (testing?.approved ? 'not-configured' : 'not-run')) +
      '</td><td>' + escapeHTML(execution?.observedPassed ?? 'unknown') +
      '</td></tr>';
  }).join('');
  const testSection = testing ? '<section><h2>自动化测试发现与执行</h2><p>状态：' +
    escapeHTML(testing.status) + ' · 执行授权：' + escapeHTML(testing.approved ? '已授权' : '未授权') +
    '</p><table><thead><tr><th>技术栈</th><th>模块</th><th>测试配置</th><th>执行结果</th><th>通过用例</th></tr></thead>' +
    '<tbody>' + testRows + '</tbody></table><ul>' +
    testing.warnings.map(w => '<li>' + escapeHTML(w) + '</li>').join('') +
    '</ul></section>' : '';
  const warnings = [
    ...(input.impact?.warnings ?? []),
    ...(input.browser?.warnings ?? []),
    ...(input.browser?.unmappedFiles.length
      ? ['Unmapped changed files: ' + input.browser.unmappedFiles.join(', ')] : [])
  ].map(w => '<li>' + escapeHTML(w) + '</li>').join('');
  return [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; ',
    'style-src &#39;unsafe-inline&#39;; img-src &#39;self&#39; data:">',
    '<title>AICodeReview · ' + escapeHTML(input.runId) + '</title>',
    '<style>body{font:15px system-ui,sans-serif;color:#18212f;max-width:1100px;margin:32px auto;padding:0 20px;background:#f7f9fc}',
    'h1,h2{margin:0 0 14px}header,article,section{padding:20px 24px;margin:0 0 18px;background:white;border:1px solid #e2e8f0;border-radius:12px}',
    'article{border-left:4px solid #e09c52}table{border-collapse:collapse;width:100%;background:#fff}td,th{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}',
    'code{background:#eef2f7;padding:2px 5px;border-radius:4px}small{color:#64748b}a{color:#2153ad}ul{padding-left:24px}p{overflow-wrap:anywhere}',
    '</style></head><body>',
    '<header><h1>AICodeReview · 本地变更验证</h1><p>Run: ' + escapeHTML(input.runId) +
    ' · Git: ' + escapeHTML(input.head.slice(0, 12)) + ' · Status: <strong>' + escapeHTML(input.status) +
    '</strong></p><small>Browser failures show observed test results, not proven regressions.</small></header>',
    '<section><h2>受影响页面</h2><ul>' + (routes || '<li>未识别</li>') + '</ul></section>',
    '<section><h2>代码审查</h2>' + (findings || '<p>没有返回审查意见，或本次只运行浏览器验证。</p>') + '</section>',
    testSection,
    '<section><h2>浏览器测试</h2><table><thead><tr><th>场景</th><th>页面</th><th>状态</th>',
    '<th>预期来源</th><th>诊断</th><th>证据</th></tr></thead><tbody>' + scenarios + '</tbody></table></section>',
    (input.regressionComparison ? '<section><h2>Baseline / HEAD 对比</h2><p>对比结果只是线索，尚未证明环境完全一致。</p><ul>' + regressions + '</ul></section>' : ''),
    '<section><h2>覆盖与限制</h2><ul>' + (warnings || '<li>没有额外警告</li>') + '</ul></section>',
    '</body></html>'
  ].join('');
}
