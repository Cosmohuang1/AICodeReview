import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectProjectTests, verifyProjectTests } from '../../src/testing/project-tests.js';

const roots: string[] = [];
function temp() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'review-project-detect-'));
  roots.push(cwd);
  return {
    cwd,
    put(name: string, content = '') {
      const full = path.join(cwd, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('multi-language project test discovery', () => {
  it('detects Node, Java, .NET and Python by manifests without executing commands', () => {
    const root = temp();
    root.put('frontend/package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    root.put('backend/Service.sln', 'Microsoft Visual Studio Solution File');
    root.put('library/Tests.csproj', '<Project><IsTestProject>true</IsTestProject></Project>');
    root.put('api/pom.xml', '<project></project>');
    root.put('gradle/build.gradle.kts', 'plugins { java }');
    root.put('py/pyproject.toml', '[project]\nname = "py"');
    root.put('py/pytest.ini', '[pytest]\ntestpaths = tests');
    const found = detectProjectTests(root.cwd);
    expect(found.projects.map(p => p.kind).sort()).toEqual(
      ['dotnet', 'dotnet', 'java', 'java', 'node', 'python'].sort()
    );
    expect(found.projects.every(p => p.command?.args.every(x => typeof x === 'string'))).toBe(true);
    expect(found.projects.find(p => p.kind === 'dotnet' && p.directory === 'backend')?.command?.args)
      .toContain('--no-restore');
    expect(found.projects.find(p => p.kind === 'java' && p.directory === 'api')?.command?.args)
      .toContain('--offline');
  });

  it('targets changed subproject rather than unrelated monorepo modules', () => {
    const root = temp();
    root.put('foo/package.json', JSON.stringify({ scripts: { test: 'vitest run' } }));
    root.put('bar/pyproject.toml', '[tool.pytest.ini_options]\ntestpaths = ["tests"]');
    const found = detectProjectTests(root.cwd, ['foo/src/app.js']);
    expect(found.projects.map(p => p.directory)).toEqual(['foo']);
  });

  it('marks absent Node test script and Python tests as not configured, never green', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    root.put('scripts/pyproject.toml', '[project]\nname = "python-only"');
    const found = detectProjectTests(root.cwd);
    expect(found.projects.every(p => p.readiness === 'not-configured')).toBe(true);
    const report = await verifyProjectTests(root.cwd, found, true);
    expect(report.status).toBe('no-tests');
    expect(report.executions).toHaveLength(0);
  });

  it('requires explicit approval before executing even a valid test script', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "require(\'fs\').writeFileSync(\'executed.txt\', \'yes\')"' }
    }));
    const found = detectProjectTests(root.cwd);
    const report = await verifyProjectTests(root.cwd, found, false);
    expect(report.status).toBe('not-run');
    expect(fs.existsSync(path.join(root.cwd, 'executed.txt'))).toBe(false);
  });

  it('executes approved Node tests, records counts and verifies real exit code', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "console.log(\'Tests  2 passed (2)\')"' }
    }));
    const report = await verifyProjectTests(root.cwd, detectProjectTests(root.cwd), true);
    expect(report.status).toBe('passed');
    expect(report.executions[0]).toMatchObject({
      status: 'passed', exitCode: 0, observedPassed: 2, observedFailed: 0
    });
  }, 20000);

  it('does not report a successful exit without observed tests as passed', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "console.log(\'all good\')"' }
    }));
    const report = await verifyProjectTests(root.cwd, detectProjectTests(root.cwd), true);
    expect(report.status).toBe('partial');
    expect(report.executions[0].status).toBe('inconclusive');
  }, 20000);


  it('emits project test stdout while the process is still running and then reports exit', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "process.stdout.write(\'first-chunk\\n\'); setTimeout(() => console.log(\'Tests  2 passed (2)\'), 75)"' }
    }));
    const events: Array<{ phase: string; chunk?: string; result?: { exitCode: number | null } }> = [];
    const report = await verifyProjectTests(
      root.cwd, detectProjectTests(root.cwd), true, 20000,
      event => events.push({ phase: event.phase, chunk: event.chunk, result: event.result })
    );
    expect(report.status).toBe('passed');
    const first = events.findIndex(e => e.phase === 'start');
    const middle = events.findIndex(e => e.phase === 'output' && e.chunk?.includes('first-chunk'));
    const last = events.findIndex(e => e.phase === 'finish' && e.result?.exitCode === 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(middle).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(middle);
  }, 30000);
  it('records an actual failing process without claiming unrun tests passed', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "console.error(\'Tests  1 failed (1)\'); process.exit(1)"' }
    }));
    const report = await verifyProjectTests(root.cwd, detectProjectTests(root.cwd), true);
    expect(report.status).toBe('failed');
    expect(report.executions[0].exitCode).toBe(1);
  }, 20000);
  it('distinguishes missing pytest dependency from a real failed test assertion', async () => {
    const root = temp();
    root.put('package.json', JSON.stringify({
      scripts: { test: 'node -e "console.error(\'No module named pytest\'); process.exit(1)"' }
    }));
    const report = await verifyProjectTests(root.cwd, detectProjectTests(root.cwd), true);
    expect(report.status).toBe('partial');
    expect(report.executions[0].status).toBe('blocked');
  }, 20000);

});
