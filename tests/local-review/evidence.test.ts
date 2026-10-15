import { describe, expect, it } from 'vitest';
import { linkReviewEvidence } from '../../src/local-review/evidence.js';
import { renderLocalReviewHTML } from '../../src/local-review/html.js';
import type { EnrichedReviewComment } from '../../src/services/review.service.js';
import type { BrowserVerificationResult } from '../../src/local-review/types.js';

const finding = {
  file: 'src/components/LoginForm.tsx', line: 42, side: 'RIGHT',
  severity: 'error', category: 'bug', confidence: 0.9,
  message: 'Login button may remain loading', priority: 'P0',
  tag: 'Bug', whyPriority: 'High', diffSnippet: ''
} as EnrichedReviewComment;

function verification(source: 'configured' | 'ai-proposed'): BrowserVerificationResult {
  return {
    status: source === 'configured' ? 'failed' : 'partial',
    planned: 1, executed: 1, unmappedFiles: [], warnings: [],
    scenarios: [{
      id: 'login-fail', route: '/login',
      status: 'failed', expectationSource: source,
      sourceFiles: ['src/components/LoginForm.tsx'],
      durationMs: 50, messages: ['assertion failed'], evidence: ['/tmp/review/artifacts/login.png']
    }]
  };
}
describe('Review evidence attribution', () => {
  it('corroborates correlation without claiming regression proof', () => {
    const linked = linkReviewEvidence([finding], verification('configured'));
    expect(linked.findings[0].verification.status).toBe('corroborated');
    expect(linked.findings[0].verification.note).toContain('NOT confirmed');
    expect(linked.findings[0].verification.evidenceIds).toEqual([linked.evidence[0].id]);
    expect(linked.unattributedFailures).toEqual([]);
  });

  it('does not promote LLM-inferred failed expectations to verified issues', () => {
    const linked = linkReviewEvidence([finding], verification('ai-proposed'));
    expect(linked.findings[0].verification.status).toBe('inconclusive');
  });

  it('escapes untrusted findings and builds offline report', () => {
    const linked = linkReviewEvidence([{ ...finding, message: '<img src=x onerror=alert(1)>' }], verification('configured'));
    const html = renderLocalReviewHTML({
      runId: 'run-1', head: 'abcdef123456', status: 'findings',
      impact: null, browser: verification('configured'),
      findings: linked.findings, evidence: linked.evidence, reportDir: '/tmp/review'
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('artifacts/login.png');
  });
});
