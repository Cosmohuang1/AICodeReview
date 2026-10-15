import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import type { BrowserConfig } from './config.js';
import type { BrowserVerificationResult, ScenarioResult, Target, TestAction, TestScenario } from './types.js';

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}

export function checkedOrigin(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || !isLoopback(url.hostname) || url.username || url.password) {
    throw new Error('Only local HTTP(S) app endpoints are allowed: ' + input);
  }
  return url.origin;
}

export function targetUrl(baseURL: string, route: string, allowedOrigins: Set<string>): string {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    throw new Error('Unsafe relative route: ' + route);
  }
  const destination = new URL(route, baseURL);
  if (!allowedOrigins.has(destination.origin)) throw new Error('Origin not allowed: ' + destination.origin);
  return destination.href;
}

async function checkHealth(baseURL: string, healthPath: string, allowed: Set<string>): Promise<boolean> {
  try {
    const response = await fetch(targetUrl(baseURL, healthPath, allowed), {
      redirect: 'manual', signal: AbortSignal.timeout(3000)
    });
    // Auth-required and SPA routes may be 401/403/404, but 5xx is unhealthy.
    return response.status < 500;
  } catch { return false; }
}

function stopChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

/** The existing server is never terminated; managed mode needs explicit approval. */
export async function acquireServer(config: BrowserConfig, options: {
  cwd: string; approveServerStart: boolean; baseURL: string;
}): Promise<{ close(): Promise<void> }> {
  const allowed = new Set([checkedOrigin(options.baseURL)]);
  if (config.server.mode === 'existing') {
    if (!await checkHealth(options.baseURL, config.healthPath, allowed)) {
      throw new Error('Local service not reachable: ' + options.baseURL);
    }
    return { async close() {} };
  }
  if (!options.approveServerStart) throw new Error('Server startup requires --approve-server-start');
  if (!config.server.command) throw new Error('browser.server.command is required');
  if (await checkHealth(options.baseURL, config.healthPath, allowed)) {
    throw new Error('Port already responds; use server.mode=existing to reuse the service');
  }
  const child = spawn(config.server.command, config.server.args, {
    cwd: options.cwd, shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2048); });
  child.stdout?.on('data', () => {});
  child.on('error', error => { stderr = (stderr + error.message).slice(-2048); });
  try {
    const deadline = Date.now() + config.server.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Server exited: ' + stderr);
      if (await checkHealth(options.baseURL, config.healthPath, allowed)) {
        return { async close() { stopChild(child); } };
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Server startup timed out: ' + stderr);
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

interface BrowserSession {
  page: Page;
  context: BrowserContext;
  close(): Promise<void>;
}

async function connectBrowser(config: BrowserConfig, options: { approveCDP: boolean; endpoint?: string }): Promise<BrowserSession> {
  const { chromium } = await import('playwright');
  if (config.connection.mode === 'cdp') {
    if (!options.approveCDP) throw new Error('Chrome CDP requires --approve-cdp');
    const endpoint = options.endpoint || config.connection.endpoint;
    if (!endpoint) throw new Error('browser.connection.endpoint is required');
    const url = new URL(endpoint);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ||
        !isLoopback(url.hostname) || url.username || url.password) {
      throw new Error('CDP must use an explicitly approved loopback endpoint');
    }
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error('No Chrome context available');
      const page = await context.newPage();
      return {
        page, context,
        async close() {
          await page.close().catch(() => {});
          // For connectOverCDP this closes the Playwright connection, not the user's Chrome process.
          await browser.close();
        }
      };
    } catch (error) {
      await browser.close();
      throw error;
    }
  }
  const browser: Browser = await chromium.launch({ headless: config.connection.headless });
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    return {
      page, context,
      async close() {
        try { await context.close(); } finally { await browser.close(); }
      }
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function locator(page: Page, target: Target): Locator {
  switch (target.by) {
    case 'role': return page.getByRole(target.value as 'button', target.name ? { name: target.name } : {});
    case 'label': return page.getByLabel(target.value);
    case 'text': return page.getByText(target.value);
    case 'testId': return page.getByTestId(target.value);
  }
}

async function executeAction(page: Page, action: TestAction, baseURL: string, allowed: Set<string>, timeout: number) {
  switch (action.type) {
    case 'goto': {
      const response = await page.goto(targetUrl(baseURL, action.path, allowed), {
        timeout, waitUntil: 'domcontentloaded'
      });
      if (response && response.status() >= 400) {
        throw new Error('Navigation returned HTTP ' + response.status());
      }
      break;
    }
    case 'click': await locator(page, action.target).click({ timeout }); break;
    case 'fill': await locator(page, action.target).fill(action.value, { timeout }); break;
    case 'assertVisible': await locator(page, action.target).waitFor({ state: 'visible', timeout }); break;
    case 'assertURL': await page.waitForURL(targetUrl(baseURL, action.path, allowed), { timeout }); break;
  }
}

async function executeScenario(scenario: TestScenario, config: BrowserConfig, options: {
  baseURL: string; endpoint?: string; approveCDP: boolean; approveInteractions?: boolean; artifactDir: string;
}, allowed: Set<string>): Promise<ScenarioResult> {
  const start = Date.now();
  const messages: string[] = [];
  const evidence: string[] = [];
  let session: BrowserSession | undefined;
  let status: ScenarioResult['status'] = 'passed';
  let traceStarted = false;
  const safeName = scenario.id.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) + '-' +
    createHash('sha256').update(scenario.id).digest('hex').slice(0, 8);
  try {
    session = await connectBrowser(config, options);
    const page = session.page;
    page.on('pageerror', error => { messages.push('Page error: ' + error.message.slice(0, 300)); });
    page.on('popup', popup => { void popup.close().catch(() => {}); });
    const requestRouter = config.connection.mode === 'isolated' ? session.context : page;
    await requestRouter.route('**/*', route => {
      try {
        const url = new URL(route.request().url());
        if (!allowed.has(url.origin)) { void route.abort(); return; }
      } catch { void route.abort(); return; }
      void route.continue().catch(() => {});
    });
    if (config.connection.mode === 'isolated') {
      await session.context.routeWebSocket('**/*', ws => {
        try {
          const url = new URL(ws.url());
          if (url.protocol === 'ws:') url.protocol = 'http:';
          if (url.protocol === 'wss:') url.protocol = 'https:';
          if (allowed.has(url.origin)) { ws.connectToServer(); return; }
        } catch { /* invalid WebSocket URL */ }
        ws.close();
      });
    }
    // A new scenario gets a fresh isolated context unless an explicitly authorized CDP session is used.
    if (config.connection.mode === 'isolated') {
      await session.context.tracing.start({ screenshots: true, snapshots: true });
      traceStarted = true;
    }
    const deadline = Date.now() + config.scenarioTimeoutMs;
    for (const action of scenario.actions) {
      if ((action.type === 'click' || action.type === 'fill') && !options.approveInteractions) {
        throw new Error('Interactive actions require --approve-interactions (may have side effects)');
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Scenario timeout');
      try {
        await executeAction(page, action, options.baseURL, allowed, Math.min(remaining, 10000));
      } catch (error) {
        status = action.type.startsWith('assert') ? 'failed' : 'error';
        throw error;
      }
    }
  } catch (error) {
    if (status === 'passed') status = 'error';
    messages.push(String(error instanceof Error ? error.message : error).slice(0, 700));
  } finally {
    if (session) {
      if (status !== 'passed') {
        try {
          await mkdir(options.artifactDir, { recursive: true });
          const screenshot = join(options.artifactDir, safeName + '.png');
          await session.page.screenshot({ path: screenshot, timeout: 3000 });
          evidence.push(screenshot);
        } catch (error) { messages.push('Screenshot unavailable: ' + String(error).slice(0, 100)); }
      }
      if (traceStarted) {
        try {
          if (status === 'passed') await session.context.tracing.stop();
          else {
            const trace = join(options.artifactDir, safeName + '.zip');
            await mkdir(options.artifactDir, { recursive: true });
            await session.context.tracing.stop({ path: trace });
            evidence.push(trace);
          }
        } catch (error) { messages.push('Trace unavailable: ' + String(error).slice(0, 100)); }
      }
      await session.close().catch(error => { messages.push('Cleanup error: ' + String(error).slice(0, 100)); });
    }
  }
  return {
    id: scenario.id, route: scenario.route, status,
    sourceFiles: scenario.sourceFiles,
    expectationSource: scenario.expectationSource,
    durationMs: Date.now() - start, messages, evidence
  };
}

export async function runBrowserVerification(options: {
  cwd: string;
  config: BrowserConfig;
  baseURL: string;
  scenarios: TestScenario[];
  unmappedFiles: string[];
  warnings: string[];
  artifactDir: string;
  approveServerStart: boolean;
  approveCDP: boolean;
  approveInteractions?: boolean;
  endpoint?: string;
}): Promise<BrowserVerificationResult> {
  const { config, scenarios } = options;
  const warnings = [...options.warnings];
  if (!scenarios.length) return {
    status: 'skipped', planned: 0, executed: 0, scenarios: [],
    unmappedFiles: options.unmappedFiles,
    warnings: [...warnings, 'No impacted route mapping; browser tests were not run.']
  };

  const allowed = new Set((config.allowedOrigins?.length ? config.allowedOrigins : [options.baseURL]).map(checkedOrigin));
  if (!allowed.has(checkedOrigin(options.baseURL))) throw new Error('baseURL must appear in allowedOrigins');

  let server: Awaited<ReturnType<typeof acquireServer>>;
  try {
    server = await acquireServer(config, options);
  } catch (error) {
    return {
      status: 'partial', planned: scenarios.length, executed: 0, scenarios: [],
      unmappedFiles: options.unmappedFiles,
      warnings: [...warnings, 'Server unavailable: ' + String(error).slice(0, 300)]
    };
  }

  const results: ScenarioResult[] = [];
  try {
    for (const scenario of scenarios) {
      results.push(await executeScenario(scenario, config, options, allowed));
    }
  } finally { await server.close(); }

  return {
    status: results.some(result => result.status === 'failed' && result.expectationSource === 'configured') ? 'failed' :
      results.some(result => result.status !== 'passed') || options.unmappedFiles.length ? 'partial' : 'passed',
    planned: scenarios.length,
    executed: results.length,
    scenarios: results,
    unmappedFiles: options.unmappedFiles,
    warnings
  };
}
