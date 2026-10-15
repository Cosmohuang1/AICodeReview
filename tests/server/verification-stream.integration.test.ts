import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { app } from '../../src/server/app.js';

describe('streaming verification HTTP contract', () => {
  let server: Server;
  let baseURL = '';
  let cwd = '';
  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'review-stream-fixture-'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({
      private: true,
      scripts: {
        test: 'node -e "process.stdout.write(\'UNIT-START\\n\'); setTimeout(() => console.log(\'Tests  2 passed (2)\'), 60)"',
        build: 'node -e "process.stdout.write(\'BUILD-START\\n\'); setTimeout(() => console.log(\'BUILD-END\'), 60)"'
      }
    }));
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('invalid listener');
    baseURL = 'http://127.0.0.1:' + addr.port;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it('streams real stdout before test/build result and closes with finish', async () => {
    const response = await fetch(baseURL + '/api/verification/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: cwd, files: ['src/demo.js'] })
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const records = (await response.text()).trim().split('\n')
      .filter(Boolean).map(line => JSON.parse(line));
    const ix = (type: string, name?: string, text?: string) =>
      records.findIndex(event => event.type === type &&
        (!name || event.name === name) &&
        (!text || String(event.chunk || '').includes(text)));
    const testStart = ix('tool_call', 'test');
    const testOutput = ix('tool_output', 'test', 'UNIT-START');
    const testFinish = ix('tool_result', 'test');
    const buildStart = ix('tool_call', 'build');
    const buildOutput = ix('tool_output', 'build', 'BUILD-START');
    const buildFinish = ix('tool_result', 'build');
    expect(testStart).toBeGreaterThanOrEqual(0);
    expect(testOutput).toBeGreaterThan(testStart);
    expect(testFinish).toBeGreaterThan(testOutput);
    expect(buildStart).toBeGreaterThan(testFinish);
    expect(buildOutput).toBeGreaterThan(buildStart);
    expect(buildFinish).toBeGreaterThan(buildOutput);
    expect(records[testFinish]).toMatchObject({ exitCode: 0, status: 'passed', observedPassed: 2 });
    expect(records[buildFinish]).toMatchObject({ exitCode: 0, status: 'passed' });
    expect(records[records.length - 1].type).toBe('finish');
  }, 30000);

  it('returns error for a non-existent project folder instead of simulated validation', async () => {
    const response = await fetch(baseURL + '/api/verification/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: join(cwd, 'missing') })
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('not found');
  });
});
