import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import crypto from 'crypto';
import { app } from '../../src/server/app.js';

describe('app server', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('GET /health returns 200 with status ok and version 0.1.0', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('POST /webhook without signature returns 401', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'pull_request',
      },
      body: JSON.stringify({ action: 'opened' }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data).toEqual({ error: 'Invalid signature' });
  });

  it('POST /webhook with valid signature and ignored event returns 200', async () => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? 'test-secret';
    process.env.GITHUB_WEBHOOK_SECRET = secret;

    const payload = JSON.stringify({ zen: 'Keep it logically awesome.' });
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'ping',
        'x-hub-signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ message: 'Event ignored' });
  });

  it('GET /api/non-existent returns 404 with JSON error', async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-endpoint-test`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Endpoint not found');
  });
});
