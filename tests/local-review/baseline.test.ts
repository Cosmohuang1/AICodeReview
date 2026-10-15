import { describe, expect, it } from 'vitest';
import { compareWithBaseline } from '../../src/local-review/baseline.js';
import type { BrowserVerificationResult, ScenarioResult } from '../../src/local-review/types.js';

const scenario = (status: ScenarioResult['status'], source: ScenarioResult['expectationSource'] = 'configured'): ScenarioResult =>
  ({ id: 'login', route: '/login', status, expectationSource: source,
     sourceFiles: ['src/login.tsx'], messages: [], evidence: [], durationMs: 1 });
const result = (s: ScenarioResult): BrowserVerificationResult =>
  ({ status: s.status === 'failed' ? 'failed' : 'passed',
     scenarios: [s], planned: 1, executed: 1, unmappedFiles: [], warnings: [] });

describe('baseline comparison', () => {
  it('marks passing baseline and failing head as a candidate, not a proven regression', () => {
    const comparison = compareWithBaseline(result(scenario('failed')), result(scenario('passed')));
    expect(comparison[0].assessment).toBe('candidate-regression');
    expect(comparison[0].note).toContain('Verify matching build');
  });
  it('identifies pre-existing failures and fixes', () => {
    expect(compareWithBaseline(result(scenario('failed')), result(scenario('failed')))[0].assessment).toBe('pre-existing-failure');
    expect(compareWithBaseline(result(scenario('passed')), result(scenario('failed')))[0].assessment).toBe('resolved');
  });
  it('will not promote AI-generated expectations into confirmed regression results', () => {
    const comparison = compareWithBaseline(result(scenario('failed', 'ai-proposed')), result(scenario('passed', 'ai-proposed')));
    expect(comparison).toHaveLength(0);
  });
  it('reports execution errors as inconclusive', () => {
    expect(compareWithBaseline(result(scenario('error')), result(scenario('passed')))[0].assessment).toBe('inconclusive');
  });
});
