import type { Category, Severity, RepoConfig } from '../config/schema.js';

export type { Category, Severity };

export interface ReviewComment {
  file: string;
  line: number;
  startLine?: number;
  side: 'RIGHT';
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
  confidence: number;
  diffPosition?: number;
}

export interface CodeChunk {
  file: string;
  language: string;
  diffContent: string;
  fullContext: string;
  startLine: number;
  endLine: number;
  diffPosition: number; // GitHub pull_request_review_comment 的 position 参数
}

export interface PRSummary {
  overview: string;
  walkthrough: Array<{ file: string; changes: string }>;
  mermaidDiagram: string;
}

export type AgentFn = (chunk: CodeChunk, config: RepoConfig) => Promise<ReviewComment[]>;
