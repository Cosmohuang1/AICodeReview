import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadBrowserConfig, planAffectedScenarios } from '../../src/local-review/config.js';
import { analyzeImpact } from '../../src/local-review/impact.js';
import { collectCustomFrameworkEdges } from '../../src/local-review/custom-framework.js';

const roots: string[] = [];
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-review-'));
  roots.push(dir);
  return {
    dir,
    put(file: string, text: string) {
      const target = join(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  };
};
afterEach(() => roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('framework-independent C# / JavaScript / HTML impact', () => {
  it('traces a JS file into its literal HTML script consumer and configured page', () => {
    const p = project();
    p.put('wwwroot/js/orders.js', 'export function init() {}');
    p.put('wwwroot/orders.html', '<html><script src="/js/orders.js?v=1"></script></html>');
    p.put('wwwroot/dashboard.html', '<html><script src="/js/dashboard.js"></script></html>');
    p.put('wwwroot/js/dashboard.js', 'export const ok = true;');
    const cfg = loadBrowserConfig('browser:\n  mappings:\n    - files: ["wwwroot/orders.html"]\n      route: /orders\n    - files: ["wwwroot/dashboard.html"]\n      route: /dashboard');
    const edges = collectCustomFrameworkEdges(p.dir, cfg);
    expect(edges.edges.get('wwwroot/js/orders.js')).toContain('wwwroot/orders.html');
    const result = analyzeImpact(p.dir, ['wwwroot/js/orders.js'], cfg);
    const planned = planAffectedScenarios(['wwwroot/js/orders.js'], { ...cfg, mappings: result.mappings });
    expect(planned.scenarios.map(s => s.route)).toContain('/orders');
    expect(planned.scenarios.map(s => s.route)).not.toContain('/dashboard');
  });

  it('maps company C# services to pages through explicit dependency rules', () => {
    const p = project();
    p.put('Server/Services/OrderService.cs', 'public class OrderService {}');
    p.put('Server/Services/UserService.cs', 'public class UserService {}');
    p.put('wwwroot/orders.html', '<html><script src="/js/orders.js"></script></html>');
    p.put('wwwroot/js/orders.js', 'export const orders = true;');
    const cfg = loadBrowserConfig([
      'browser:',
      '  dependencyRules:',
      '    - dependencies: ["Server/Services/OrderService.cs"]',
      '      consumers: ["wwwroot/js/orders.js"]',
      '  mappings:',
      '    - files: ["wwwroot/orders.html"]',
      '      route: /orders'
    ].join('\n'));
    const result = analyzeImpact(p.dir, ['Server/Services/OrderService.cs'], cfg);
    const planned = planAffectedScenarios(['Server/Services/OrderService.cs'], { ...cfg, mappings: result.mappings });
    expect(planned.scenarios.map(s => s.route)).toContain('/orders');
    expect(result.routes.map(r => r.route)).toContain('/orders');
    const unrelated = analyzeImpact(p.dir, ['Server/Services/UserService.cs'], cfg);
    expect(planAffectedScenarios(['Server/Services/UserService.cs'], {
      ...cfg, mappings: unrelated.mappings
    }).scenarios).toHaveLength(0);
  });

  it('does not infer company routes from random C# class or HTML name', () => {
    const p = project();
    p.put('Backend/CustomHandler.cs', 'class CustomHandler {}');
    p.put('wwwroot/secret.html', '<script src="https://cdn.example.com/x.js"></script>');
    const result = analyzeImpact(p.dir, ['Backend/CustomHandler.cs'], loadBrowserConfig(null));
    expect(result.routes).toHaveLength(0);
  });
});
