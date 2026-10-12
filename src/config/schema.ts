import { z } from 'zod';

export type Category = 'bug' | 'security' | 'performance' | 'style' | 'test' | 'custom';
export type Severity = 'error' | 'warning' | 'info';

const categoryEnum = z.enum(['bug', 'security', 'performance', 'style', 'test', 'custom']);
const severityEnum = z.enum(['error', 'warning', 'info']);

export const DEFAULT_EXCLUDE = [
  '*.min.js', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'dist/**', 'build/**', '*.generated.ts', '*.generated.js',
];

const RepoConfigSchema = z.object({
  language: z.enum(['zh', 'en']).default('zh'),
  rules: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default(DEFAULT_EXCLUDE),
  severityOverride: z.record(categoryEnum, severityEnum).default({}),
  selfCritiqueThreshold: z.number().min(0).max(1).default(0.6),
  maxFilesPerReview: z.number().int().positive().default(20),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export function parseRepoConfig(raw: unknown): RepoConfig {
  return RepoConfigSchema.parse(raw);
}
