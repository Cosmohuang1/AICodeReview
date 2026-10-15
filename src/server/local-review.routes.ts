import { Router, type Request, type Response } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { collectGitChanges } from '../local-review/git.js';
import type { GitScope } from '../local-review/types.js';
import { analyzeImpact } from '../local-review/impact.js';
import { loadBrowserConfig, planAffectedScenarios } from '../local-review/config.js';
import { runBrowserVerification } from '../local-review/browser.js';
import { renderLocalReviewHTML } from '../local-review/html.js';

export const localReviewRouter = Router();
let running = false;

function loopback(address: string | undefined): boolean {
  return Boolean(address && (address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'));
}

function authorized(req: Request, res: Response): boolean {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (process.env.ENABLE_LOCAL_BROWSER_API !== '1') {
    res.status(404).json({ error: 'Local browser API is disabled' });
    return false;
  }
  const secret = process.env.LOCAL_REVIEW_API_TOKEN || '';
  if (secret.length < 24) {
    res.status(503).json({ error: 'Configure a local API token of at least 24 characters' });
    return false;
  }
  if (!loopback(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Loopback requests only' });
    return false;
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.host !== req.get('host')) throw new Error('origin mismatch');
    } catch {
      res.status(403).json({ error: 'Cross-origin browser requests are forbidden' });
      return false;
    }
  }
  const supplied = req.get('x-local-review-token') || '';
  const tokenHash = createHash('sha256').update(secret).digest();
  const providedHash = createHash('sha256').update(supplied).digest();
  if (!timingSafeEqual(tokenHash, providedHash)) {
    res.status(401).json({ error: 'Invalid local review token' });
    return false;
  }
  return true;
}

/**
 * Separate opt-in read-only Web UI entry point.
 * Never accepts arbitrary repoPath, shell command, dev server mode or CDP.
 */
localReviewRouter.post('/verify', async (req: Request, res: Response) => {
  if (!authorized(req, res)) return;
  if (running) { res.status(429).json({ error: 'Browser verification already running' }); return; }
  const scope = req.body?.scope ?? 'working';
  if (!['working', 'staged', 'last'].includes(scope)) {
    res.status(400).json({ error: 'Unsupported scope' }); return;
  }
  running = true;
  try {
    const cwd = path.resolve(process.env.LOCAL_REVIEW_ROOT || process.cwd());
    const configFile = path.join(cwd, '.ai-review.yml');
    const config = loadBrowserConfig(fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : null);
    // Override unsafe modes even when repository configuration asks for them.
    const safeConfig = {
      ...config,
      server: { ...config.server, mode: 'existing' as const },
      connection: { ...config.connection, mode: 'isolated' as const },
      maxScenarios: Math.min(config.maxScenarios, 3),
      scenarioTimeoutMs: Math.min(config.scenarioTimeoutMs, 20_000)
    };
    const changes = collectGitChanges({ cwd, scope: scope as GitScope });
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    const directory = path.join(cwd, '.ai-review', 'runs', id);
    const impact = analyzeImpact(cwd, changes.files, safeConfig);
    const plan = planAffectedScenarios(changes.files, { ...safeConfig, mappings: impact.mappings });
    // Even configured clicks/fills are disabled from the HTTP API.
    const safeScenarios = plan.scenarios.filter(s =>
      s.actions.every(action => ['goto', 'assertVisible', 'assertURL'].includes(action.type))
    );
    const warnings = [...changes.warnings, ...impact.warnings, ...plan.warnings];
    if (safeScenarios.length < plan.scenarios.length) warnings.push('Interactive tests require the local CLI and were skipped in Web mode.');
    const browser = await runBrowserVerification({
      cwd, baseURL: safeConfig.baseURL, config: safeConfig,
      scenarios: safeScenarios, unmappedFiles: plan.unmappedFiles,
      warnings, artifactDir: path.join(directory, 'artifacts'),
      approveServerStart: false, approveCDP: false
    });
    fs.mkdirSync(directory, { recursive: true });
    const result = {
      id, scope, changedFiles: changes.files, impact: {
        routes: impact.routes, scannedFiles: impact.scannedFiles,
        truncated: impact.truncated, warnings: impact.warnings
      }, browser
    };
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(path.join(directory, 'report.html'), renderLocalReviewHTML({
      runId: id, head: changes.head,
      status: browser.status, impact, browser,
      findings: [], evidence: [], reportDir: directory
    }));
    res.json({ success: true, result });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
});

localReviewRouter.get('/report/:id', (req: Request, res: Response) => {
  if (!authorized(req, res)) return;
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) {
    res.status(400).json({ error: 'Invalid run ID' }); return;
  }
  try {
    const cwd = path.resolve(process.env.LOCAL_REVIEW_ROOT || process.cwd());
    const file = path.join(cwd, '.ai-review', 'runs', id, 'report.json');
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'Report not found' }); return; }
    res.type('json').send(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
