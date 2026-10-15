import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ProjectKind = 'node' | 'python' | 'dotnet' | 'java';
export type TestReadiness = 'ready' | 'not-configured';
export type TestOutcome = 'passed' | 'failed' | 'blocked' | 'inconclusive';

export interface DetectedProject {
  kind: ProjectKind;
  directory: string;
  manifests: string[];
  readiness: TestReadiness;
  /** Literal argv only; never interpolate into a shell. */
  command?: { executable: string; args: string[] };
  note: string;
}

export interface ProjectDetection {
  projects: DetectedProject[];
  warnings: string[];
  truncated: boolean;
}

export interface TestExecution {
  project: DetectedProject;
  status: TestOutcome;
  exitCode: number | null;
  durationMs: number;
  observedPassed: number | null;
  observedFailed: number | null;
  outputSnippet: string;
  reason: string;
}

export interface TestProgressEvent {
  phase: 'start' | 'output' | 'finish';
  project: DetectedProject;
  command: string;
  stream?: 'stdout' | 'stderr';
  chunk?: string;
  result?: TestExecution;
}

export interface ProjectTestReport {
  status: 'passed' | 'failed' | 'partial' | 'not-run' | 'no-tests';
  approved: boolean;
  projects: DetectedProject[];
  executions: TestExecution[];
  warnings: string[];
}

const OMIT = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'bin',
  'obj', 'dist', 'build', '.next', '.nuxt', 'coverage', '.ai-review', '.tox', 'target',
  '.gradle', 'TestResults', '.vs']);
const PROJECT_FILES = new Set(['package.json', 'pyproject.toml', 'pytest.ini', 'tox.ini',
  'setup.cfg', 'requirements.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts']);
const MAX_DIRECTORIES = 800;
const MAX_PROJECTS = 32;
const MAX_MANIFEST_BYTES = 128 * 1024;

function normalized(p: string): string { return p.split(path.sep).join('/'); }

function readSmall(filename: string): string {
  try {
    if (fs.statSync(filename).size > MAX_MANIFEST_BYTES) return '';
    return fs.readFileSync(filename, 'utf8');
  } catch { return ''; }
}

function includesTests(directory: string): boolean {
  for (const name of ['tests', 'test']) {
    try {
      if (fs.statSync(path.join(directory, name)).isDirectory()) return true;
    } catch { /* absent */ }
  }
  try {
    return fs.readdirSync(directory).some(name => /^test_.*\.py$|^.*_test\.py$/.test(name));
  } catch { return false; }
}

/** Static-only discovery: does not install dependencies, invoke scripts, or execute user code. */
export function detectProjectTests(root: string, changedFiles: string[] = []): ProjectDetection {
  const absoluteRoot = path.resolve(root);
  const warnings: string[] = [];
  const dirs: Array<{ full: string; depth: number }> = [{ full: absoluteRoot, depth: 0 }];
  const manifests = new Map<string, string[]>();
  let walked = 0, truncated = false;
  while (dirs.length) {
    if (walked >= MAX_DIRECTORIES) { truncated = true; break; }
    const { full, depth } = dirs.shift()!;
    walked++;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { continue; }
    const listed: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && depth < 5 && !OMIT.has(entry.name) && !entry.name.startsWith('.')) {
        dirs.push({ full: path.join(full, entry.name), depth: depth + 1 });
      } else if (entry.isFile() &&
        (PROJECT_FILES.has(entry.name) || /\.slnx?$|\.csproj$/.test(entry.name) ||
          ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].includes(entry.name))) {
        listed.push(entry.name);
      }
    }
    if (listed.length) manifests.set(normalized(path.relative(absoluteRoot, full)) || '.', listed);
  }
  if (truncated) warnings.push('Project detection scan limit reached; some modules were not inspected.');

  const all: DetectedProject[] = [];
  for (const [directory, names] of manifests) {
    const full = directory === '.' ? absoluteRoot : path.join(absoluteRoot, directory);
    const add = (p: DetectedProject) => all.push(p);
    if (names.includes('package.json')) {
      let script: unknown;
      try {
        const pkg = JSON.parse(readSmall(path.join(full, 'package.json')));
        script = pkg.scripts?.test;
      } catch { warnings.push('Invalid package.json in ' + directory); }
      const valid = typeof script === 'string' && Boolean(script.trim()) &&
        !/no test specified|exit\s+1/i.test(script);
      const manager = names.includes('pnpm-lock.yaml') ? 'pnpm' :
        names.includes('yarn.lock') ? 'yarn' : 'npm';
      add({
        kind: 'node', directory, manifests: ['package.json'],
        readiness: valid ? 'ready' : 'not-configured',
        command: valid ? { executable: manager, args: ['test'] } : undefined,
        note: valid ? manager + ' test (configured in package.json)' : 'No usable package.json test script'
      });
    }
    const solutions = names.filter(n => /\.slnx?$/.test(n)).sort();
    const projects = names.filter(n => /\.csproj$/.test(n)).sort();
    if (solutions.length) {
      add({
        kind: 'dotnet', directory, manifests: solutions,
        readiness: solutions.length === 1 ? 'ready' : 'not-configured',
        command: solutions.length === 1 ? {
          executable: 'dotnet', args: ['test', solutions[0], '--no-restore', '--nologo', '--verbosity', 'normal', '--logger', 'console;verbosity=normal']
        } : undefined,
        note: solutions.length === 1 ? 'dotnet solution test; requires previously restored dependencies' :
          'Multiple solutions; choose a test target explicitly'
      });
    } else {
      for (const proj of projects) {
        const xml = readSmall(path.join(full, proj));
        const isTest = /<IsTestProject>\s*true\s*<\/IsTestProject>|Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest/i.test(xml);
        add({
          kind: 'dotnet', directory, manifests: [proj],
          readiness: isTest ? 'ready' : 'not-configured',
          command: isTest ? { executable: 'dotnet', args: ['test', proj, '--no-restore', '--nologo', '--verbosity', 'normal', '--logger', 'console;verbosity=normal'] } : undefined,
          note: isTest ? 'Detected .NET test project (no automatic restore)' :
            'C# project found, but no test SDK or test-project marker identified'
        });
      }
    }
    if (names.includes('pom.xml') || names.includes('build.gradle') || names.includes('build.gradle.kts')) {
      const maven = names.includes('pom.xml');
      add({
        kind: 'java', directory, manifests: maven ? ['pom.xml'] :
          [names.includes('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle'],
        readiness: 'ready',
        command: maven
          ? { executable: 'mvn', args: ['--offline', '--batch-mode', 'test'] }
          : { executable: 'gradle', args: ['--offline', '--no-daemon', 'test'] },
        note: maven ? 'Maven tests (offline; dependencies must be cached)' :
          'Gradle tests (offline; dependencies must be cached)'
      });
      if (maven && (names.includes('build.gradle') || names.includes('build.gradle.kts'))) {
        warnings.push('Both Maven and Gradle found in ' + directory + '; choose test runner explicitly if needed.');
      }
    }
    if (names.some(n => ['pyproject.toml','pytest.ini','tox.ini','setup.cfg','requirements.txt'].includes(n))) {
      const hasTests = includesTests(full) || names.includes('pytest.ini') ||
        /pytest/i.test(['pyproject.toml','tox.ini','setup.cfg','requirements.txt']
          .filter(name => names.includes(name))
          .map(name => readSmall(path.join(full, name))).join('\n'));
      add({
        kind: 'python', directory,
        manifests: names.filter(n => ['pyproject.toml','pytest.ini','tox.ini','setup.cfg','requirements.txt'].includes(n)),
        readiness: hasTests ? 'ready' : 'not-configured',
        command: hasTests ? {
          executable: process.platform === 'win32' ? 'python' : 'python3',
          args: ['-m', 'pytest', '-q']
        } : undefined,
        note: hasTests ? 'pytest discovered (requires an installed interpreter and pytest)' :
          'Python project found; no pytest config or tests located'
      });
    }
  }

  // For multi-project repos prefer the modified module. A root-level project
  // remains applicable because its tests may cover changed subdirectories.
  const normalizedChanges = changedFiles.map(f => normalized(f).replace(/^\.\//, ''));
  const applicable = normalizedChanges.length
    ? all.filter(p => p.directory === '.' ||
        normalizedChanges.some(file => file === p.directory || file.startsWith(p.directory + '/')))
    : all;
  const chosen = applicable.length ? applicable : all;
  if (chosen.length > MAX_PROJECTS) {
    truncated = true;
    warnings.push('At most ' + MAX_PROJECTS + ' project test targets can be selected at once.');
  }
  return { projects: chosen.slice(0, MAX_PROJECTS), warnings, truncated };
}

function missingTestEnvironment(output: string): boolean {
  const message = output.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
  return /No module named ['"]?pytest\b|ModuleNotFoundError:\s+No module named|NETSDK1004|project\.assets\.json.*not found|Could not resolve dependencies.*offline|No cached version .* available|(?:vitest|jest|mocha|pytest|dotnet|mvn|gradle):\s*(?:command )?not found|Cannot find module ['"](?:vitest|jest|mocha|ava|tsx|ts-node)['"]/i.test(message);
}

function getCounts(output: string): { passed: number | null; failed: number | null } {
  const vitest = output.match(/Tests\s+([^\n\r]*)/i);
  if (vitest) {
    const passed = vitest[1].match(/(\d+)\s+passed/i);
    const failed = vitest[1].match(/(\d+)\s+failed/i);
    if (passed || failed) return {
      passed: passed ? Number(passed[1]) : 0, failed: failed ? Number(failed[1]) : 0
    };
  }
  const pytest = output.match(/(\d+)\s+passed(?:\s*,\s*(\d+)\s+failed)?/i);
  if (pytest) return { passed: Number(pytest[1]), failed: Number(pytest[2] || 0) };
  // dotnet test reports "Failed: 1, Passed: 7, Skipped: 0" in that
  // order, so read both counters independently. A failing command may
  // report a nonzero exit code even if only some test counts are present.
  const dotnetPassed = output.match(/\bPassed:\s*(\d+)/i);
  const dotnetFailed = output.match(/\bFailed:\s*(\d+)/i);
  if (dotnetPassed || dotnetFailed) return {
    passed: dotnetPassed ? Number(dotnetPassed[1]) : 0,
    failed: dotnetFailed ? Number(dotnetFailed[1]) : 0
  };
  const maven = output.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/i);
  if (maven) return {
    passed: Math.max(0, Number(maven[1]) - Number(maven[2]) - Number(maven[3])),
    failed: Number(maven[2]) + Number(maven[3])
  };
  return { passed: null, failed: null };
}

/** Explicitly approved test execution. Never auto-install or execute model-supplied shell text. */
export async function verifyProjectTests(
  root: string, detection: ProjectDetection, approved: boolean, timeoutMs = 90_000,
  onProgress?: (event: TestProgressEvent) => void
): Promise<ProjectTestReport> {
  const emit = (event: TestProgressEvent) => {
    try { onProgress?.(event); } catch { /* UI errors must not abort tests */ }
  };
  const warnings = [...detection.warnings];
  if (!approved) return {
    status: 'not-run', approved: false, projects: detection.projects, executions: [],
    warnings: [...warnings, 'Test execution requires explicit approval (--run-tests).']
  };
  const runnable = detection.projects.filter(p => p.readiness === 'ready' && p.command);
  if (!runnable.length) return {
    status: 'no-tests', approved: true, projects: detection.projects, executions: [],
    warnings: [...warnings, 'No configured test target found; no tests executed.']
  };
  const executions: TestExecution[] = [];
  for (const project of runnable) {
    const started = Date.now();
    const command = project.command!;
    const cwd = project.directory === '.' ? path.resolve(root) : path.resolve(root, project.directory);
    const commandText = [command.executable, ...command.args].join(' ');
    emit({ phase: 'start', project, command: commandText });
    const result = await new Promise<TestExecution>(resolve => {
      const child = execFile(command.executable, command.args, {
        cwd, shell: false,
        timeout: Math.max(1000, Math.min(timeoutMs, 180_000)),
        maxBuffer: 2 * 1024 * 1024, windowsHide: true
      }, (error, stdout, stderr) => {
        const combined = String(stdout || '') + '\n' + String(stderr || '');
        const observed = getCounts(combined);
        const exitCode = error && typeof error.code === 'number' ? error.code :
          error ? null : 0;
        const blocked = Boolean(error &&
          (missingTestEnvironment(combined) ||
           ('code' in error && ['ENOENT', 'EACCES', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(String(error.code))) ||
           ('killed' in error && error.killed)));
        const status: TestOutcome = blocked ? 'blocked' :
          exitCode === 0 ? (observed.passed !== null && observed.passed > 0 ? 'passed' : 'inconclusive') :
          'failed';
        const reason = blocked ? 'Test executable/dependencies unavailable, timed out, or output exceeded limit' :
          exitCode === 0 ? status === 'passed' ?
            'Test runner exited successfully and reported passing tests' :
            'Command exited successfully, but no executed test cases could be verified from its output' :
            'Test runner exited unsuccessfully; check logs and dependencies';
        const result: TestExecution = {
          project, status, exitCode, durationMs: Date.now() - started,
          observedPassed: observed.passed, observedFailed: observed.failed,
          outputSnippet: combined.trim().slice(-8000), reason
        };
        emit({ phase: 'finish', project, command: commandText, result });
        resolve(result);
      });
      // execFile runs without a shell and buffers for the summary. Its pipes
      // also provide real-time output before the callback is invoked.
      let sentBytes = 0;
      let limited = false;
      for (const stream of ['stdout', 'stderr'] as const) {
        child[stream]?.on('data', (data: Buffer | string) => {
          if (!onProgress) return;
          const chunk = String(data);
          const room = Math.max(0, 256 * 1024 - sentBytes);
          if (room > 0) {
            const allowed = chunk.slice(0, room);
            sentBytes += allowed.length;
            emit({ phase: 'output', project, command: commandText, stream, chunk: allowed });
          } else if (!limited) {
            limited = true;
            emit({ phase: 'output', project, command: commandText, stream,
              chunk: '\n[超过 256KB 的实时日志未继续显示；测试仍在运行]\n' });
          }
        });
      }
    });
    executions.push(result);
  }
  const configuredButUnavailable = detection.projects.some(p => p.readiness !== 'ready');
  const status = executions.some(x => x.status === 'failed') ? 'failed' :
    executions.every(x => x.status === 'passed') && !configuredButUnavailable &&
      !detection.truncated ? 'passed' : 'partial';
  return { status, approved: true, projects: detection.projects, executions, warnings };
}
