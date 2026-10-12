import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { app } from '../../src/server/app.js';

describe('API routes (/api)', () => {
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

  it('GET /api/status returns status ok, cwd, and hasApiKey boolean', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.cwd).toBeDefined();
    expect(typeof data.hasApiKey).toBe('boolean');
  });

  it('POST /api/diff returns files and scope description for valid repo', async () => {
    const res = await fetch(`${baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: process.cwd(), mode: 'worktree' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scopeDesc).toBeDefined();
    expect(Array.isArray(data.files)).toBe(true);
  });

  it('POST /api/diff with invalid repo path returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: 'C:\\this\\path\\does\\not\\exist\\12345' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('不存在');
  });

  it('GET / serves the public/index.html web dashboard', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('AICodeReview');
    expect(html).toContain('shadcn');
  });

  it('GET /api/workspace/status returns real Git workspace metadata', async () => {
    const res = await fetch(`${baseUrl}/api/workspace/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.currentBranch).toBe('string');
    expect(typeof data.hasChanges).toBe('boolean');
    expect(Array.isArray(data.changedFiles)).toBe(true);
  });

  it('GET /api/recents returns initial real workspace task without mock data', async () => {
    const res = await fetch(`${baseUrl}/api/recents`);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].id).toBe('rev_current_workspace');
  });

  it('POST /api/agent/deliver returns branch delivery status and PR url', async () => {
    const res = await fetch(`${baseUrl}/api/agent/deliver`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'test/deliver-branch' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.branch).toBe('test/deliver-branch');
    expect(data.prUrl).toContain('test/deliver-branch');
  });

  it('POST /api/agent/execute with empty prompt returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/agent/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/analytics returns real metrics matching workspace and tasks', async () => {
    const res = await fetch(`${baseUrl}/api/analytics`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.activeRepositories).toBeGreaterThanOrEqual(1);
    expect(data.passedTests).toBe(171);
    expect(typeof data.workspaceAdditions).toBe('number');
    expect(typeof data.workspaceDeletions).toBe('number');
    expect(data.reviewerTimeSaved).toContain('小时');
  });

  it('GET /api/repositories returns connected repos and supports settings update', async () => {
    const res = await fetch(`${baseUrl}/api/repositories`);
    expect(res.status).toBe(200);
    const repos = await res.json();
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThanOrEqual(1);

    const firstRepo = repos[0];
    const settingsRes = await fetch(`${baseUrl}/api/repositories/${firstRepo.name}/settings`);
    expect(settingsRes.status).toBe(200);
    const settingsData = await settingsRes.json();
    expect(settingsData.settings).toBeDefined();

    const updateRes = await fetch(`${baseUrl}/api/repositories/${firstRepo.name}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoReviewPR: false, reviewProfile: 'Strict', rules: ['禁止滥用 any'] }),
    });
    expect(updateRes.status).toBe(200);
    const updateData = await updateRes.json();
    expect(updateData.success).toBe(true);
  });
});
