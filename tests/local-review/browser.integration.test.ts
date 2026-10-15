import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBrowserVerification } from '../../src/local-review/browser.js';
import { loadBrowserConfig } from '../../src/local-review/config.js';
import type { TestScenario } from '../../src/local-review/types.js';

const browserDescribe = process.env.RUN_BROWSER_E2E === '1' ? describe : describe.skip;

browserDescribe('real Playwright browser verification', () => {
  let server: Server;
  let baseURL = '';
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-browser-'));
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url === '/login') {
        res.end('<!doctype html><title>Login</title><button>Login</button>');
      } else {
        res.end('<!doctype html><title>Home</title>');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');
    baseURL = 'http://127.0.0.1:' + address.port;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });

  function scenario(id: string, label: string): TestScenario {
    return {
      id, route: '/login', sourceFiles: ['src/components/LoginForm.tsx'],
      expectationSource: 'configured',
      actions: [
        { type: 'goto', path: '/login' },
        { type: 'assertVisible', target: { by: 'role', value: 'button', name: label } }
      ]
    };
  }

  it('denies interaction by default and accepts an explicitly authorized configured click', async () => {
    const config = loadBrowserConfig('browser:\n  scenarioTimeoutMs: 3000');
    const interactive: TestScenario = {
      id: 'authorized-click', route: '/login',
      sourceFiles: ['src/components/LoginForm.tsx'], expectationSource: 'configured',
      actions: [
        { type: 'goto', path: '/login' },
        { type: 'click', target: { by: 'role', value: 'button', name: 'Login' } },
        { type: 'assertVisible', target: { by: 'role', value: 'button', name: 'Login' } }
      ]
    };
    const options = {
      cwd: process.cwd(), config, baseURL,
      scenarios: [interactive], unmappedFiles: [], warnings: [],
      artifactDir: directory, approveCDP: false, approveServerStart: false
    };
    const denied = await runBrowserVerification(options);
    expect(denied.status).toBe('partial');
    expect(denied.scenarios[0].messages.join(' ')).toContain('approve-interactions');
    const allowed = await runBrowserVerification({ ...options, approveInteractions: true });
    expect(allowed.status).toBe('passed');
  }, 30000);

  it('executes a real scenario and saves screenshot + trace for failed assertion', async () => {
    const config = loadBrowserConfig('browser:\n  scenarioTimeoutMs: 2500');
    const pass = await runBrowserVerification({
      cwd: process.cwd(), baseURL, config,
      scenarios: [scenario('login-ok', 'Login')], unmappedFiles: [],
      warnings: [], artifactDir: directory,
      approveCDP: false, approveServerStart: false
    });
    expect(pass.status).toBe('passed');
    expect(pass.scenarios[0].status).toBe('passed');

    const failure = await runBrowserVerification({
      cwd: process.cwd(), baseURL, config,
      scenarios: [scenario('login-error', 'NeverExists')], unmappedFiles: [],
      warnings: [], artifactDir: directory,
      approveCDP: false, approveServerStart: false
    });
    expect(failure.status).toBe('failed');
    expect(failure.scenarios[0].status).toBe('failed');
    expect(failure.scenarios[0].evidence.some(x => x.endsWith('.png') && existsSync(x))).toBe(true);
    expect(failure.scenarios[0].evidence.some(x => x.endsWith('.zip') && existsSync(x))).toBe(true);
  }, 30000);
});
