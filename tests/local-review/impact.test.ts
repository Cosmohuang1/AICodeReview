import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeImpact } from '../../src/local-review/impact.js';
import { loadBrowserConfig, planAffectedScenarios } from '../../src/local-review/config.js';

const roots: string[] = [];
function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'impact-review-'));
  roots.push(cwd);
  function put(file: string, source: string) {
    const target = join(cwd, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  put('tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]},"moduleResolution":"bundler","module":"esnext","jsx":"react-jsx"}}');
  put('src/components/LoginForm.tsx', 'export function LoginForm() { return <button>Login</button>; }');
  put('src/components/Wrapper.tsx', 'import { LoginForm } from "@/components/LoginForm"; export default LoginForm;');
  put('src/app/login/page.tsx', 'import Wrapper from "../../components/Wrapper"; export default Wrapper;');
  put('src/app/users/[id]/page.tsx', 'import Wrapper from "../../../components/Wrapper"; export default Wrapper;');
  put('src/app/page.tsx', 'export default function Home() { return <h1>Home</h1>; }');
  return cwd;
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('TypeScript reverse dependency impact analysis', () => {
  it('traces aliased imports across files to Next.js routes and ignores unknown dynamic params', () => {
    const cwd = project();
    const config = loadBrowserConfig(null);
    const impact = analyzeImpact(cwd, ['src/components/LoginForm.tsx'], config);
    expect(impact.routes.map(r => r.route)).toContain('/login');
    expect(impact.routes.map(r => r.route)).not.toContain('/users/[id]');
    expect(impact.routes.find(r => r.route === '/login')?.sourceFiles).toContain('src/components/LoginForm.tsx');
    expect(impact.scannedFiles).toBeGreaterThan(3);
    const planned = planAffectedScenarios(['src/components/LoginForm.tsx'], { ...config, mappings: impact.mappings });
    expect(planned.unmappedFiles).toEqual([]);
    expect(planned.scenarios.find(s => s.route === '/login')?.expectationSource).toBe('smoke');
  });

  it('inherits explicit test mapping through reverse dependency, preserving configured assertions', () => {
    const cwd = project();
    const config = loadBrowserConfig([
      'browser:',
      '  mappings:',
      '    - files: ["src/app/login/page.tsx"]',
      '      route: /login',
      '      scenarios:',
      '        - id: configured-login',
      '          actions:',
      '            - { type: goto, path: /login }',
      '            - { type: assertVisible, target: { by: role, value: button, name: Login } }'
    ].join('\n'));
    const impact = analyzeImpact(cwd, ['src/components/LoginForm.tsx'], config);
    const plan = planAffectedScenarios(['src/components/LoginForm.tsx'], { ...config, mappings: impact.mappings });
    expect(plan.scenarios).toHaveLength(1);
    expect(plan.scenarios[0].id).toBe('configured-login');
    expect(plan.scenarios[0].sourceFiles).toEqual(['src/components/LoginForm.tsx']);
    expect(plan.unmappedFiles).toEqual([]);
  });

  it('does not infer ungrounded routes for unrelated files', () => {
    const cwd = project();
    const result = analyzeImpact(cwd, ['unrelated/new-file.ts'], loadBrowserConfig(null));
    expect(result.routes).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/No impacted route/);
  });
});

describe('React Router static route impact', () => {
  it('selects an impacted JSX screen, not unrelated pages', () => {
    const cwd = project();
    function put(file: string, source: string) {
      const target = join(cwd, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    put('src/screens/Login.tsx', 'import { LoginForm } from "../components/LoginForm"; export default function Login() { return <LoginForm/>; }');
    put('src/screens/Dashboard.tsx', 'export default function Dashboard() { return <h1>Dashboard</h1>; }');
    put('src/router.tsx', [
      'import { Routes, Route } from "react-router-dom";',
      'import Login from "./screens/Login";',
      'import Dashboard from "./screens/Dashboard";',
      'export const routes = <Routes><Route path="/login" element={<Login/>}/><Route path="/dashboard" element={<Dashboard/>}/></Routes>;'
    ].join('\n'));
    const result = analyzeImpact(cwd, ['src/components/LoginForm.tsx'], loadBrowserConfig(null));
    expect(result.routes.map(r => r.route)).toContain('/login');
    expect(result.routes.map(r => r.route)).not.toContain('/dashboard');
  });

  it('supports object-based createBrowserRouter and rejects dynamic paths', () => {
    const cwd = project();
    function put(file: string, source: string) {
      const target = join(cwd, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    put('src/screens/Login.tsx', 'import { LoginForm } from "../components/LoginForm"; export default function Login() { return <LoginForm/>; }');
    put('src/screens/Dashboard.tsx', 'export default function Dashboard() { return <h1>Dashboard</h1>; }');
    put('src/router.tsx', [
      'import { createBrowserRouter } from "react-router-dom";',
      'import Login from "./screens/Login";',
      'import Dashboard from "./screens/Dashboard";',
      'export const router = createBrowserRouter([{ path: "/login", element: <Login/> },',
      '{ path: "/dashboard", element: <Dashboard/> },',
      '{ path: "/users/:id", element: <Login/> }]);'
    ].join('\n'));
    const result = analyzeImpact(cwd, ['src/components/LoginForm.tsx'], loadBrowserConfig(null));
    expect(result.routes.map(r => r.route)).toContain('/login');
    expect(result.routes.map(r => r.route)).not.toContain('/dashboard');
    expect(result.routes.map(r => r.route)).not.toContain('/users/:id');
  });
});
