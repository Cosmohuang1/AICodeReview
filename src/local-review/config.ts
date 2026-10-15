import yaml from 'js-yaml';
import { z } from 'zod';
import type { TestAction, TestScenario } from './types.js';

const targetSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('role'), value: z.string().min(1), name: z.string().optional() }),
  z.object({ by: z.enum(['label', 'text', 'testId']), value: z.string().min(1) })
]);
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string().startsWith('/') }),
  z.object({ type: z.literal('click'), target: targetSchema }),
  z.object({ type: z.literal('fill'), target: targetSchema, value: z.string() }),
  z.object({ type: z.literal('assertVisible'), target: targetSchema }),
  z.object({ type: z.literal('assertURL'), path: z.string().startsWith('/') })
]);
const scenarioSchema = z.object({
  id: z.string().min(1),
  actions: z.array(actionSchema).min(1).max(30)
});
const mappingSchema = z.object({
  files: z.array(z.string().min(1)).min(1),
  route: z.string().startsWith('/'),
  scenarios: z.array(scenarioSchema).optional()
});
const browserSchema = z.object({
  enabled: z.boolean().default(false),
  baseURL: z.string().url().default('http://127.0.0.1:3000'),
  healthPath: z.string().startsWith('/').default('/'),
  allowedOrigins: z.array(z.string().url()).optional(),
  mappings: z.array(mappingSchema).default([]),
  dependencyRules: z.array(z.object({
    dependencies: z.array(z.string().min(1)).min(1),
    consumers: z.array(z.string().min(1)).min(1)
  })).max(100).default([]),
  server: z.object({
    mode: z.enum(['existing', 'managed']).default('existing'),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    startupTimeoutMs: z.number().int().min(1000).max(180000).default(60000)
  }).default({}),
  connection: z.object({
    mode: z.enum(['isolated', 'cdp']).default('isolated'),
    endpoint: z.string().url().optional(),
    headless: z.boolean().default(true)
  }).default({}),
  aiPlanning: z.object({
    enabled: z.boolean().default(false),
    maxScenarios: z.number().int().min(0).max(5).default(2)
  }).default({}),
  maxScenarios: z.number().int().min(1).max(30).default(5),
  scenarioTimeoutMs: z.number().int().min(1000).max(120000).default(30000)
}).default({});
const configSchema = z.object({ browser: browserSchema }).passthrough();

export type BrowserConfig = z.infer<typeof browserSchema>;

export function loadBrowserConfig(text: string | null): BrowserConfig {
  if (!text?.trim()) return browserSchema.parse({});
  // Invalid browser YAML must not silently fall back to permissive defaults.
  const obj = yaml.load(text);
  if (obj == null) return browserSchema.parse({});
  return configSchema.parse(obj).browser;
}

/** Glob subset: * matches one segment, ** crosses segments, ? one character. */
export function matchesGlob(file: string, glob: string): boolean {
  const input = file.replace(/\\/g, '/');
  const pattern = glob.replace(/\\/g, '/');
  let out = '^';
  for (let i = 0; i < pattern.length;) {
    if (pattern.slice(i, i + 3) === '**/') { out += '(?:.*/)?'; i += 3; }
    else if (pattern.slice(i, i + 2) === '**') { out += '.*'; i += 2; }
    else if (pattern[i] === '*') { out += '[^/]*'; i++; }
    else if (pattern[i] === '?') { out += '[^/]'; i++; }
    else { out += pattern[i].replace(/[|\\{}()[\]^$+.]/g, '\\$&'); i++; }
  }
  return new RegExp(out + '$').test(input);
}

export function planAffectedScenarios(
  files: string[],
  config: BrowserConfig
): { scenarios: TestScenario[]; unmappedFiles: string[]; warnings: string[] } {
  const mapped = new Set<string>();
  const scenarios: TestScenario[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const mapping of config.mappings) {
    const matched = files.filter(f => mapping.files.some(g => matchesGlob(f, g)));
    if (!matched.length) continue;
    matched.forEach(f => mapped.add(f));
    const plans = mapping.scenarios?.length
      ? mapping.scenarios
      : [{ id: 'smoke:' + mapping.route, actions: [
          { type: 'goto', path: mapping.route },
          { type: 'assertURL', path: mapping.route }
        ] as TestAction[] }];
    for (const plan of plans) {
      if (ids.has(plan.id)) { warnings.push('Duplicate scenario ID skipped: ' + plan.id); continue; }
      ids.add(plan.id);
      scenarios.push({
        id: plan.id, route: mapping.route, sourceFiles: matched,
        expectationSource: mapping.scenarios?.length ? 'configured' : 'smoke',
        actions: plan.actions as TestAction[]
      });
    }
  }
  if (scenarios.length > config.maxScenarios) {
    warnings.push('Scenario budget reached: selected ' + config.maxScenarios + ' of ' + scenarios.length);
  }
  return {
    scenarios: scenarios.slice(0, config.maxScenarios),
    unmappedFiles: files.filter(f => !mapped.has(f)),
    warnings
  };
}
