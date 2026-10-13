import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { apiRouter } from '../../src/server/api.routes.js';
import type { Server } from 'node:http';

describe('ReAct Agent API Routes', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api', apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/agent/react/run 缺少 prompt 时返回 400', async () => {
    const res = await fetch(`${baseUrl}/api/agent/react/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('prompt');
  });

  it('POST /api/agent/react/run 成功启动任务并返回 sessionId', async () => {
    const res = await fetch(`${baseUrl}/api/agent/react/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '测试健康检查', autoCommit: false }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.sessionId).toBeDefined();
  });

  it('POST /api/agent/react/abort/:sessionId 支持中止任务', async () => {
    const runRes = await fetch(`${baseUrl}/api/agent/react/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '耗时分析', autoCommit: false }),
    });
    const runData = await runRes.json();
    const sessionId = runData.sessionId;

    const abortRes = await fetch(`${baseUrl}/api/agent/react/abort/${sessionId}`, {
      method: 'POST',
    });
    expect(abortRes.status).toBe(200);
    const abortData = await abortRes.json();
    expect(abortData.success).toBe(true);
  });
});
