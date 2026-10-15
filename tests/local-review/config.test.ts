import { describe, expect, it } from 'vitest';
import { loadBrowserConfig, matchesGlob, planAffectedScenarios } from '../../src/local-review/config.js';

describe('browser configuration and impact mapping', () => {
  it('is opt-in and uses an isolated browser by default', () => {
    const config = loadBrowserConfig(null);
    expect(config.enabled).toBe(false);
    expect(config.server.mode).toBe('existing');
    expect(config.connection.mode).toBe('isolated');
    expect(config.maxScenarios).toBe(5);
  });

  it('fails closed on invalid YAML or invalid test actions', () => {
    expect(() => loadBrowserConfig('browser: [')).toThrow();
    expect(() => loadBrowserConfig('browser:\n  mappings:\n    - files: [src/**]\n      route: /login\n      scenarios:\n        - id: x\n          actions:\n            - type: executeShell\n              command: rm -rf .')).toThrow();
  });

  it('matches explicit mappings and reports files without a route', () => {
    expect(matchesGlob('src/app/login/page.tsx', 'src/app/**')).toBe(true);
    expect(matchesGlob('src/components/LoginForm.tsx', 'src/app/**')).toBe(false);
    const config = loadBrowserConfig([
      'browser:',
      '  maxScenarios: 3',
      '  mappings:',
      '    - files: ["src/app/login/**", "src/components/LoginForm.tsx"]',
      '      route: /login',
      '      scenarios:',
      '        - id: login-visible',
      '          actions:',
      '            - type: goto',
      '              path: /login',
      '            - type: assertVisible',
      '              target: { by: role, value: button, name: Login }'
    ].join('\n'));
    const result = planAffectedScenarios(
      ['src/components/LoginForm.tsx', 'src/api/payment.ts'], config
    );
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].route).toBe('/login');
    expect(result.scenarios[0].expectationSource).toBe('configured');
    expect(result.unmappedFiles).toEqual(['src/api/payment.ts']);
  });

  it('generates only a reachability smoke test when no assertions are configured', () => {
    const config = loadBrowserConfig('browser:\n  mappings:\n    - files: ["src/**"]\n      route: /');
    const plan = planAffectedScenarios(['src/index.tsx'], config);
    expect(plan.scenarios[0].expectationSource).toBe('smoke');
    expect(plan.scenarios[0].actions.map(x => x.type)).toEqual(['goto', 'assertURL']);
  });
});
