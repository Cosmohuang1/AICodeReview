import { describe, expect, it } from 'vitest';
import { generatedTestSource } from '../../src/local-review/test-export.js';
import type { TestScenario } from '../../src/local-review/types.js';

describe('safe generated regression tests', () => {
  const base: TestScenario = {
    id: 'login-visibility', route: '/login', sourceFiles: ['src/login.tsx'],
    expectationSource: 'ai-proposed', actions: [
      { type: 'goto', path: '/login' },
      { type: 'assertVisible', target: { by: 'role', value: 'button', name: "Log'in" } }
    ]
  };

  it('emits valid Playwright code with escaped selectors and assertion', () => {
    const source = generatedTestSource(base, 'http://127.0.0.1:3000');
    expect(source).toContain("import { test, expect } from '@playwright/test'");
    expect(source).toContain('toBeVisible()');
    expect(source).toContain(JSON.stringify("Log'in"));
    expect(source).toContain('AI proposed expectations are NOT verified requirements');
  });

  it('rejects interaction side effects and non-local default URLs', () => {
    expect(() => generatedTestSource({ ...base, actions: [
      { type: 'goto', path: '/login' },
      { type: 'click', target: { by: 'text', value: 'Delete' } }
    ] }, 'http://localhost:3000')).toThrow();
    expect(() => generatedTestSource(base, 'https://example.com')).toThrow();
    expect(() => generatedTestSource({ ...base, expectationSource: 'smoke' }, 'http://localhost:3000')).toThrow();
  });
});
