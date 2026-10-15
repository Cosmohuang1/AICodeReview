export type GitScope = 'working' | 'staged' | 'last' | 'branch';

export interface GitChangeSet {
  scope: GitScope;
  head: string;
  base?: string;
  rawDiff: string;
  files: string[];
  warnings: string[];
}

export type Target =
  | { by: 'role'; value: string; name?: string }
  | { by: 'label' | 'text' | 'testId'; value: string };

export type TestAction =
  | { type: 'goto'; path: string }
  | { type: 'click'; target: Target }
  | { type: 'fill'; target: Target; value: string }
  | { type: 'assertVisible'; target: Target }
  | { type: 'assertURL'; path: string };

export interface TestScenario {
  id: string;
  route: string;
  sourceFiles: string[];
  expectationSource: 'configured' | 'smoke';
  actions: TestAction[];
}

export interface ScenarioResult {
  id: string;
  route: string;
  status: 'passed' | 'failed' | 'blocked' | 'error';
  expectationSource: 'configured' | 'smoke';
  durationMs: number;
  messages: string[];
  evidence: string[];
}

export interface BrowserVerificationResult {
  status: 'passed' | 'failed' | 'skipped' | 'partial';
  planned: number;
  executed: number;
  scenarios: ScenarioResult[];
  unmappedFiles: string[];
  warnings: string[];
}
