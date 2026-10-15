import yaml from 'js-yaml';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const target = z.object({
  by: z.enum(['role', 'label', 'text', 'testId']),
  value: z.string().min(1),
  name: z.string().optional()
});
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), path: z.string().startsWith('/') }),
  z.object({ type: z.literal('click'), target }),
  z.object({ type: z.literal('fill'), target, value: z.string() }),
  z.object({ type: z.literal('assertVisible'), target }),
  z.object({ type: z.literal('assertURL'), path: z.string().startsWith('/') })
]);
const scenario = z.object({ id: z.string().min(1), actions: z.array(action).min(1).max(30) });
const browserSchema = z.object({
  baseURL: z.string().url().default('http://127.0.0.1:3000'),
  mappings: z.array(z.object({
    files: z.array(z.string().min(1)).min(1),
    route: z.string().startsWith('/'),
    scenarios: z.array(scenario).optional()
  })).default([]),
  maxScenarios: z.number().int().min(1).max(20).default(5),
  scenarioTimeoutMs: z.number().int().min(1000).max(120000).default(30000)
});
type BrowserConfig = z.infer<typeof browserSchema>;
type Action = z.infer<typeof action>;
export interface BrowserScenario {
  id: string; route: string; files: string[]; actions: Action[]; expectation: 'configured' | 'smoke';
}
export interface BrowserScenarioResult {
  id: string; route: string; status: 'passed' | 'failed' | 'blocked' | 'error';
  durationMs: number; message?: string; artifacts: string[];
}
export interface BrowserResult {
  status: 'passed' | 'failed' | 'partial' | 'skipped';
  planned: number; executed: number; unmappedFiles: string[];
  scenarios: BrowserScenarioResult[]; warnings: string[];
}
export function parseBrowserConfig(content: string | null): BrowserConfig {
  if (!content?.trim()) return browserSchema.parse({});
  const parsed = yaml.load(content);
  if (parsed == null) return browserSchema.parse({});
  return z.object({ browser: browserSchema.default({}) }).passthrough().parse(parsed).browser;
}
export function matchFileGlob(file: string, glob: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  const expression = glob.replace(/\\/g, '/');
  let pattern = '^';
  for (let i = 0; i < expression.length;) {
    if (expression.slice(i, i + 3) === '**/') { pattern += '(?:.*/)?'; i += 3; }
    else if (expression.slice(i, i + 2) === '**') { pattern += '.*'; i += 2; }
    else if (expression[i] === '*') { pattern += '[^/]*'; i++; }
    else if (expression[i] === '?') { pattern += '[^/]'; i++; }
    else { pattern += expression[i].replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); i++; }
  }
  return new RegExp(pattern + '$').test(normalized);
}
export function planBrowserScenarios(files: string[], config: BrowserConfig): {
  scenarios: BrowserScenario[]; unmappedFiles: string[]; warnings: string[];
} {
  const mapped = new Set<string>();
  const ids = new Set<string>();
  const scenarios: BrowserScenario[] = [];
  const warnings: string[] = [];
  for (const mapping of config.mappings) {
    const related = files.filter(file => mapping.files.some(pattern => matchFileGlob(file, pattern)));
    if (!related.length) continue;
    related.forEach(file => mapped.add(file));
    const plans = mapping.scenarios?.length ? mapping.scenarios : [{
      id: 'smoke:' + mapping.route,
      actions: [{ type: 'goto' as const, path: mapping.route }, { type: 'assertURL' as const, path: mapping.route }]
    }];
    for (const plan of plans) {
      if (ids.has(plan.id)) { warnings.push('Duplicate scenario ID: ' + plan.id); continue; }
      ids.add(plan.id);
      scenarios.push({ id: plan.id, route: mapping.route, files: related,
        actions: plan.actions, expectation: mapping.scenarios?.length ? 'configured' : 'smoke' });
    }
  }
  if (scenarios.length > config.maxScenarios) warnings.push('Scenario budget exceeded; some routes were not tested');
  return { scenarios: scenarios.slice(0, config.maxScenarios),
    unmappedFiles: files.filter(file => !mapped.has(file)), warnings };
}
function assertLocalOrigin(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
      url.username || url.password) {
    throw new Error('Browser MVP only permits explicit loopback HTTP(S) URLs');
  }
  return url.origin;
}
function safeURL(base: string, route: string): string {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    throw new Error('Unsafe route: ' + route);
  }
  const url = new URL(route, base);
  if (url.origin !== new URL(base).origin) throw new Error('Cross-origin route refused');
  return url.href;
}
function getLocator(page: any, target: z.infer<typeof target>): any {
  switch (target.by) {
    case 'role': return page.getByRole(target.value, target.name ? { name: target.name } : {});
    case 'label': return page.getByLabel(target.value);
    case 'text': return page.getByText(target.value);
    case 'testId': return page.getByTestId(target.value);
  }
}
async function applyAction(page: any, item: Action, base: string, timeout: number) {
  if (item.type === 'goto') {
    const response = await page.goto(safeURL(base, item.path), { timeout, waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 400) throw new Error('HTTP ' + response.status());
  } else if (item.type === 'click') await getLocator(page, item.target).click({ timeout });
  else if (item.type === 'fill') await getLocator(page, item.target).fill(item.value, { timeout });
  else if (item.type === 'assertVisible') await getLocator(page, item.target).waitFor({ state: 'visible', timeout });
  else if (item.type === 'assertURL') await page.waitForURL(safeURL(base, item.path), { timeout });
}
/**
 * Playwright is deliberately loaded only when --browser is requested. Install using:
 * npm install playwright && npx playwright install chromium
 * Keeping the dependency optional preserves existing Review and CI workflows.
 */
export async function verifyBrowser(options: {
  config: BrowserConfig; files: string[]; url?: string; artifactDir: string;
}): Promise<BrowserResult> {
  const { scenarios, unmappedFiles, warnings } = planBrowserScenarios(options.files, options.config);
  const base = options.url || options.config.baseURL;
  const origin = assertLocalOrigin(base);
  if (!scenarios.length) return { status: 'skipped', planned: 0, executed: 0,
    unmappedFiles, scenarios: [], warnings: [...warnings, 'No matched browser route mappings'] };
  const results: BrowserScenarioResult[] = [];
  try {
    const health = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (health.status >= 500) throw new Error('HTTP ' + health.status);
  } catch (error) {
    return { status: 'partial', planned: scenarios.length, executed: 0, unmappedFiles, scenarios: [],
      warnings: [...warnings, 'Local server unavailable: ' + String(error)] };
  }
  let chromium: any;
  try {
    const dependency: string = 'playwright';
    chromium = (await import(dependency)).chromium;
  } catch {
    return { status: 'partial', planned: scenarios.length, executed: 0, unmappedFiles, scenarios: [],
      warnings: [...warnings, 'Playwright missing. Run: npm install playwright && npx playwright install chromium'] };
  }
  for (const plan of scenarios) {
    const start = Date.now();
    const id = plan.id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64);
    const artifacts: string[] = [];
    let message = '';
    let status: BrowserScenarioResult['status'] = 'passed';
    let browser: any;
    let context: any;
    let traceStarted = false;
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ acceptDownloads: false, viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.route('**/*', (route: any) => {
        try { if (new URL(route.request().url()).origin === origin) void route.continue();
              else void route.abort(); }
        catch { void route.abort(); }
      });
      page.on('popup', (popup: any) => { void popup.close().catch(() => {}); });
      page.on('pageerror', (err: Error) => { message += 'Page error: ' + err.message.slice(0, 180) + '; '; });
      await context.tracing.start({ screenshots: true, snapshots: true });
      traceStarted = true;
      const deadline = Date.now() + options.config.scenarioTimeoutMs;
      for (const item of plan.actions) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Scenario timeout');
        await applyAction(page, item, base, Math.min(remaining, 10000));
      }
    } catch (error) {
      status = 'failed';
      message += String(error instanceof Error ? error.message : error).slice(0, 600);
    } finally {
      if (context) {
        try {
          if (status !== 'passed') {
            await mkdir(options.artifactDir, { recursive: true });
            const screenshot = path.join(options.artifactDir, id + '.png');
            await context.pages()[0]?.screenshot({ path: screenshot, timeout: 3000 });
            artifacts.push(screenshot);
          }
        } catch { message += '; screenshot unavailable'; }
        if (traceStarted) {
          try {
            if (status === 'passed') await context.tracing.stop();
            else {
              await mkdir(options.artifactDir, { recursive: true });
              const trace = path.join(options.artifactDir, id + '.zip');
              await context.tracing.stop({ path: trace });
              artifacts.push(trace);
            }
          } catch { message += '; trace unavailable'; }
        }
      }
      try { await browser?.close(); } catch { message += '; cleanup failed'; }
    }
    results.push({ id: plan.id, route: plan.route, status,
      durationMs: Date.now() - start, message: message || undefined, artifacts });
  }
  const failed = results.some(s => s.status === 'failed');
  return { status: failed ? 'failed' : unmappedFiles.length || warnings.length ? 'partial' : 'passed',
    planned: scenarios.length, executed: results.length, unmappedFiles, scenarios: results, warnings };
}
