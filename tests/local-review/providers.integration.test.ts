import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { loadBrowserConfig } from '../../src/local-review/config.js';
import { runBrowserVerification } from '../../src/local-review/browser.js';
import type { TestScenario } from '../../src/local-review/types.js';

const browserDescribe = process.env.RUN_BROWSER_E2E === '1' ? describe : describe.skip;
const scenario: TestScenario = {
  id: 'health-smoke', route: '/', sourceFiles: ['src/app/page.tsx'], expectationSource: 'configured',
  actions: [{ type: 'goto', path: '/' }, { type: 'assertURL', path: '/' }]
};

browserDescribe('managed server and dedicated Chrome CDP providers', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ai-review-providers-'));
  let localApp: Server;
  let localURL = '';
  const chromeProcesses: ChildProcess[] = [];
  beforeAll(async () => {
    localApp = createServer((_req, res) => { res.end('<!doctype html><title>Local</title>'); });
    await new Promise<void>(resolve => localApp.listen(0, '127.0.0.1', resolve));
    const address = localApp.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    localURL = 'http://127.0.0.1:' + address.port;
  });
  afterAll(async () => {
    chromeProcesses.forEach(p => { try { p.kill('SIGTERM'); } catch {} });
    if (localApp) await new Promise<void>(resolve => localApp.close(() => resolve()));
    rmSync(folder, { recursive: true, force: true });
  });

  it('requires explicit consent before managed server startup', async () => {
    const config = loadBrowserConfig(null);
    config.server.mode = 'managed';
    config.server.command = process.execPath;
    const out = await runBrowserVerification({
      cwd: process.cwd(), config, baseURL: 'http://127.0.0.1:1',
      scenarios: [scenario], unmappedFiles: [], warnings: [],
      artifactDir: folder, approveServerStart: false, approveCDP: false
    });
    expect(out.status).toBe('partial');
    expect(out.warnings.join(' ')).toContain('--approve-server-start');
  });

  it('runs against a dedicated CDP Chrome browser profile', async () => {
    // Browser executable comes from npx playwright install --with-deps chromium.
    const debugServer = createServer();
    await new Promise<void>(resolve => debugServer.listen(0, '127.0.0.1', resolve));
    const address = debugServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing debug port');
    const port = address.port;
    await new Promise<void>(resolve => debugServer.close(() => resolve()));
    const profile = join(folder, 'chrome-test-profile');
    const child = spawn(chromium.executablePath(), [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
    ], { stdio: 'ignore' });
    chromeProcesses.push(child);
    const endpoint = 'http://127.0.0.1:' + port;
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(ready).toBe(true);
    const config = loadBrowserConfig(null);
    config.connection.mode = 'cdp';
    config.connection.endpoint = endpoint;
    const result = await runBrowserVerification({
      cwd: process.cwd(), config, baseURL: localURL,
      scenarios: [scenario], unmappedFiles: [], warnings: [],
      artifactDir: folder, approveServerStart: false, approveCDP: true
    });
    expect(result.status, JSON.stringify(result)).toBe('passed');
  }, 30000);
});
