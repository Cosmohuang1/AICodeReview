import { createHash } from 'node:crypto';
import path from 'node:path';
import type { BrowserVerificationResult } from './types.js';
import type { EnrichedReviewComment } from '../services/review.service.js';

export interface LinkedEvidence {
  id: string;
  scenarioId: string;
  route: string;
  outcome: 'passed' | 'failed' | 'blocked' | 'error';
  provenance: 'configured' | 'smoke' | 'ai-proposed';
  artifactPaths: string[];
  relatedSourceFiles: string[];
}

export interface LinkedFinding {
  id: string;
  location: { file: string; line: number };
  severity: string;
  category: string;
  explanation: string;
  suggestion?: string;
  verification: {
    status: 'unverified' | 'corroborated' | 'inconclusive';
    evidenceIds: string[];
    note: string;
  };
}

function key(value: string): string { return value.replace(/\\/g, '/').replace(/^\.\//, ''); }

export function linkReviewEvidence(comments: EnrichedReviewComment[], browser: BrowserVerificationResult | null): {
  findings: LinkedFinding[];
  evidence: LinkedEvidence[];
  unattributedFailures: string[];
} {
  const evidence: LinkedEvidence[] = (browser?.scenarios ?? []).map(s => ({
    id: createHash('sha256').update(s.id + ':' + s.route).digest('hex').slice(0, 16),
    scenarioId: s.id, route: s.route, outcome: s.status,
    provenance: s.expectationSource,
    artifactPaths: s.evidence,
    relatedSourceFiles: s.sourceFiles.map(key)
  }));
  const failures = evidence.filter(e => e.outcome === 'failed' || e.outcome === 'error');
  const attributed = new Set<string>();
  const findings: LinkedFinding[] = comments.map(comment => {
    const file = key(comment.file);
    const matches = failures.filter(e => e.relatedSourceFiles.includes(file));
    const credible = matches.filter(e => e.outcome === 'failed' && e.provenance === 'configured');
    matches.forEach(e => attributed.add(e.id));
    return {
      id: createHash('sha256').update(
        [file, comment.line, comment.category, comment.message].join(':')
      ).digest('hex').slice(0, 16),
      location: { file: comment.file, line: comment.line },
      severity: comment.severity, category: comment.category,
      explanation: comment.message, suggestion: comment.suggestion,
      verification: {
        status: credible.length ? 'corroborated' : matches.length ? 'inconclusive' : 'unverified',
        evidenceIds: matches.map(e => e.id),
        note: credible.length
          ? 'Configured browser assertion failed on a route impacted by this file. Correlation only; root cause and regression are NOT confirmed.'
          : matches.length
            ? 'Related browser failure is exploratory or operational; cannot establish the finding.'
            : 'No browser evidence linked to this finding.'
      }
    };
  });
  return { findings, evidence, unattributedFailures: failures.filter(e => !attributed.has(e.id)).map(e => e.id) };
}

export function evidenceHref(reportDir: string, filename: string): string | null {
  const rel = path.relative(reportDir, filename).replace(/\\/g, '/');
  if (!rel || rel.startsWith('../') || path.isAbsolute(rel) || rel.includes('\0')) return null;
  return rel.split('/').map(encodeURIComponent).join('/');
}
