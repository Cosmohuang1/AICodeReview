import type { BrowserVerificationResult } from './types.js';

export interface RegressionComparison {
  scenarioId: string;
  route: string;
  currentStatus: string;
  baselineStatus: string;
  assessment: 'candidate-regression' | 'pre-existing-failure' | 'resolved' | 'unchanged-pass' | 'inconclusive';
  note: string;
}

/**
 * Compare the same configured assertion against two independently served local
 * app versions. A candidate regression is not proof of causation: environment,
 * database, sessions and build revision may still differ.
 */
export function compareWithBaseline(current: BrowserVerificationResult, baseline: BrowserVerificationResult): RegressionComparison[] {
  const lookup = new Map(baseline.scenarios.map(s => [s.id, s]));
  return current.scenarios.filter(s => s.expectationSource === 'configured').map(s => {
    const previous = lookup.get(s.id);
    const currentStatus = s.status;
    const baselineStatus = previous?.status ?? 'not-run';
    let assessment: RegressionComparison['assessment'] = 'inconclusive';
    if (previous?.expectationSource !== 'configured' || !previous || !['passed', 'failed'].includes(previous.status) ||
        !['passed', 'failed'].includes(s.status)) {
      assessment = 'inconclusive';
    } else if (previous.status === 'passed' && s.status === 'failed') {
      assessment = 'candidate-regression';
    } else if (previous.status === 'failed' && s.status === 'failed') {
      assessment = 'pre-existing-failure';
    } else if (previous.status === 'failed' && s.status === 'passed') {
      assessment = 'resolved';
    } else assessment = 'unchanged-pass';
    return {
      scenarioId: s.id, route: s.route, currentStatus, baselineStatus, assessment,
      note: assessment === 'candidate-regression'
        ? 'Previously passed and currently fails. Verify matching build, data, accounts and environment before confirming causation.'
        : assessment === 'inconclusive'
          ? 'At least one test was not executed successfully in both environments.'
          : 'Comparison of configured assertions only; environment equivalence is not established.'
    };
  });
}
