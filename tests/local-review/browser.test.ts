import { describe, expect, it } from 'vitest';
import { checkedOrigin, runBrowserVerification, targetUrl } from '../../src/local-review/browser.js';
import { loadBrowserConfig } from '../../src/local-review/config.js';

describe('local browser safety and diagnostics', () => {
  it('allows loopback endpoints and rejects external hosts and credentials', () => {
    expect(checkedOrigin('http://127.0.0.1:3000/login')).toBe('http://127.0.0.1:3000');
    expect(() => checkedOrigin('https://example.com')).toThrow();
    expect(() => checkedOrigin('http://user:pass@localhost:3000')).toThrow();
    const origins = new Set(['http://127.0.0.1:3000']);
    expect(targetUrl('http://127.0.0.1:3000', '/login', origins)).toBe('http://127.0.0.1:3000/login');
    expect(() => targetUrl('http://127.0.0.1:3000', '//evil.test', origins)).toThrow();
    expect(() => targetUrl('http://127.0.0.1:3000', 'https://evil.test', origins)).toThrow();
  });

  it('reports no mapping as skipped without launching a browser', async () => {
    const result = await runBrowserVerification({
      cwd: process.cwd(), config: loadBrowserConfig(null),
      baseURL: 'http://127.0.0.1:3000', scenarios: [],
      unmappedFiles: ['src/unknown.ts'], warnings: [],
      artifactDir: '/tmp/unused', approveCDP: false, approveServerStart: false
    });
    expect(result.status).toBe('skipped');
    expect(result.executed).toBe(0);
  });

  it('reports an unreachable local service as partial, not a code bug', async () => {
    const config = loadBrowserConfig(null);
    const result = await runBrowserVerification({
      cwd: process.cwd(), config,
      baseURL: 'http://127.0.0.1:1',
      scenarios: [{
        id: 'smoke', route: '/', sourceFiles: ['src/a.ts'], expectationSource: 'smoke',
        actions: [{ type: 'goto', path: '/' }]
      }],
      unmappedFiles: [], warnings: [], artifactDir: '/tmp/unused',
      approveCDP: false, approveServerStart: false
    });
    expect(result.status).toBe('partial');
    expect(result.executed).toBe(0);
    expect(result.warnings.some(x => x.includes('Server unavailable'))).toBe(true);
  });
});
