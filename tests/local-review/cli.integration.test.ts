import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const browserDescribe = process.env.RUN_BROWSER_E2E === '1' ? describe : describe.skip;

browserDescribe('complete local CLI browser-only flow', () => {
  const appRoot = process.cwd();
  const cwd = mkdtempSync(join(tmpdir(), 'ai-review-e2e-'));
  let server: Server;
  let baseURL = '';

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  beforeAll(async () => {
    git('init', '-q');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'user.name', 'CI');
    const file = join(cwd, 'src/app/page.tsx');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export default function Page() { return <main>Old</main>; }\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    writeFileSync(file, 'export default function Page() { return <main>New</main>; }\n');
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Test app</title><main>New</main>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    baseURL = 'http://127.0.0.1:' + address.port;
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  });

  it('runs real Chromium from CLI and writes JSON, Markdown, HTML and plan', async () => {
    const output = join(cwd, 'review.md');
    const child = spawnSync(process.execPath, [
      '--import', 'tsx', resolve(appRoot, 'src/cli.ts'),
      'review', '--browser-only', '--url', baseURL, '-o', output
    ], {
      cwd, encoding: 'utf8',
      timeout: 35000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, DEEPSEEK_API_KEY: '' }
    });
    expect(child.status, child.stderr + child.stdout).toBe(0);
    expect(existsSync(output)).toBe(true);
    const report = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8'));
    expect(report.browser.status).toBe('passed');
    expect(report.browser.scenarios[0].route).toBe('/');
    expect(report.impact.routes[0].sourceFiles).toContain('src/app/page.tsx');
    expect(existsSync(join(cwd, 'report.html'))).toBe(true);
    expect(existsSync(join(cwd, 'test-plan.json'))).toBe(true);
  }, 45000);
});
