import { describe, expect, it } from 'vitest';
import { matchFileGlob, parseBrowserConfig, planBrowserScenarios } from '../../src/local-review/browser.js';

describe('local browser planning', () => {
  it('matches directory and basename globs', () => {
    expect(matchFileGlob('src/app/login/page.tsx', 'src/app/**')).toBe(true);
    expect(matchFileGlob('src/components/LoginForm.tsx', 'src/components/*.tsx')).toBe(true);
    expect(matchFileGlob('src/a/b/file.ts', 'src/*.ts')).toBe(false);
  });
  it('only creates scenarios for mapped changes', () => {
    const config = parseBrowserConfig([
      'browser:',
      '  mappings:',
      '    - files: ["src/app/login/**"]',
      '      route: /login'
    ].join('\n'));
    const result = planBrowserScenarios(['src/app/login/page.tsx', 'src/api/users.ts'], config);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].actions).toHaveLength(2);
    expect(result.unmappedFiles).toEqual(['src/api/users.ts']);
  });
  it('refuses malformed browser configuration rather than falling back silently', () => {
    expect(() => parseBrowserConfig('browser: [invalid')).toThrow();
  });
  it('respects configured scenario budget', () => {
    const config = parseBrowserConfig([
      'browser:',
      '  maxScenarios: 1',
      '  mappings:',
      '    - files: ["src/**"]',
      '      route: /one',
      '    - files: ["src/**"]',
      '      route: /two'
    ].join('\n'));
    expect(planBrowserScenarios(['src/page.ts'], config).scenarios).toHaveLength(1);
  });
});
