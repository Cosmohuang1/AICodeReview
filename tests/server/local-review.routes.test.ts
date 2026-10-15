import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { app } from '../../src/server/app.js';

describe('opt-in local browser verification web endpoint', () => {
  let server: Server;
  let url = '';
  const oldEnabled = process.env.ENABLE_LOCAL_BROWSER_API;
  const oldToken = process.env.LOCAL_REVIEW_API_TOKEN;
  const token = 'test-only-browser-local-api-token-long';
  beforeAll(async () => {
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unexpected listener address');
    url = 'http://127.0.0.1:' + address.port;
  });
  afterAll(async () => {
    if (oldEnabled === undefined) delete process.env.ENABLE_LOCAL_BROWSER_API;
    else process.env.ENABLE_LOCAL_BROWSER_API = oldEnabled;
    if (oldToken === undefined) delete process.env.LOCAL_REVIEW_API_TOKEN;
    else process.env.LOCAL_REVIEW_API_TOKEN = oldToken;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const post = (scope: string, headers: Record<string,string> = {}) =>
    fetch(url + '/api/local-review/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ scope })
    });

  it('is disabled by default', async () => {
    delete process.env.ENABLE_LOCAL_BROWSER_API;
    process.env.LOCAL_REVIEW_API_TOKEN = token;
    expect((await post('working')).status).toBe(404);
  });

  it('requires token even on localhost', async () => {
    process.env.ENABLE_LOCAL_BROWSER_API = '1';
    process.env.LOCAL_REVIEW_API_TOKEN = token;
    expect((await post('working')).status).toBe(401);
  });

  it('rejects cross-origin calls despite the existing general CORS middleware', async () => {
    process.env.ENABLE_LOCAL_BROWSER_API = '1';
    process.env.LOCAL_REVIEW_API_TOKEN = token;
    const response = await post('working', {
      'X-Local-Review-Token': token, Origin: 'https://attacker.example'
    });
    expect(response.status).toBe(403);
  });

  it('rejects unsafe scope before running a Git or browser command', async () => {
    process.env.ENABLE_LOCAL_BROWSER_API = '1';
    process.env.LOCAL_REVIEW_API_TOKEN = token;
    const response = await post('anything', { 'X-Local-Review-Token': token });
    expect(response.status).toBe(400);
  });

  it('does not allow arbitrary report paths', async () => {
    process.env.ENABLE_LOCAL_BROWSER_API = '1';
    process.env.LOCAL_REVIEW_API_TOKEN = token;
    const response = await fetch(url + '/api/local-review/report/%2e%2e%5cpasswd', {
      headers: { 'X-Local-Review-Token': token }
    });
    expect([400, 404]).toContain(response.status);
  });
});
