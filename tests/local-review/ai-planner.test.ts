import { describe, expect, it } from 'vitest';
import { proposeReadOnlyScenarios } from '../../src/local-review/ai-planner.js';
import type { ImpactRoute } from '../../src/local-review/impact.js';

const routes: ImpactRoute[] = [{
  route: '/login', routeFile: 'src/app/login/page.tsx',
  via: ['src/app/login/page.tsx'],
  sourceFiles: ['src/components/LoginForm.tsx'], confidence: 'framework'
}];

describe('AI read-only test planner', () => {
  it('accepts schema-valid assertions on known routes', async () => {
    const result = await proposeReadOnlyScenarios({
      routes, diff: '+<button>Login</button>', remainingBudget: 2,
      requestModel: async () => JSON.stringify({
        scenarios: [{
          id: 'login-visible', route: '/login', rationale: 'Button was introduced by the diff',
          actions: [
            { type: 'goto', path: '/login' },
            { type: 'assertVisible', target: { by: 'role', value: 'button', name: 'Login' } }
          ]
        }]
      })
    });
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].expectationSource).toBe('ai-proposed');
    expect(result.scenarios[0].sourceFiles).toContain('src/components/LoginForm.tsx');
    expect(result.warnings).toEqual([]);
  });

  it('refuses AI-generated clicks, even if response is syntactically valid JSON', async () => {
    const result = await proposeReadOnlyScenarios({
      routes, diff: 'a diff', remainingBudget: 1,
      requestModel: async () => JSON.stringify({
        scenarios: [{ id: 'danger', route: '/login', rationale: 'trigger',
          actions: [{ type: 'goto', path: '/login' },
            { type: 'click', target: { by: 'text', value: 'Delete account' } }]
        }]
      })
    });
    expect(result.scenarios).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects unknown routes and cross-route navigation', async () => {
    const result = await proposeReadOnlyScenarios({
      routes, diff: 'diff', remainingBudget: 2,
      requestModel: async () => JSON.stringify({
        scenarios: [
          { id: 'foreign', route: '/admin', rationale: 'guess', actions: [
            { type: 'goto', path: '/admin' },
            { type: 'assertURL', path: '/admin' }] },
          { id: 'cross', route: '/login', rationale: 'guess', actions: [
            { type: 'goto', path: '/login' },
            { type: 'assertURL', path: '/admin' }] }
        ]
      })
    });
    expect(result.scenarios).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
