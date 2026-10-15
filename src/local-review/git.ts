import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type Scope = 'working' | 'staged' | 'last' | 'branch';

export interface LocalChanges {
  scope: Scope;
  revision: string | null;
  files: string[];
  diff: string;
  warnings: string[];
}

const DIFF_LIMIT = 10 * 1024 * 1024;

function git(cwd: string, args: string[], allowOne = false): string {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', maxBuffer: DIFF_LIMIT + 4096,
      timeout: 20000, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (cause) {
    const error = cause as { status?: number; stdout?: string; stderr?: string; message: string };
    if (allowOne && error.status === 1) return error.stdout || '';
    throw new Error('Git failed: ' + (error.stderr || error.message).slice(0, 400));
  }
}

export function collectLocalChanges(options: {
  cwd: string; scope?: Scope; base?: string; includeUntracked?: boolean;
}): LocalChanges {
  const cwd = path.resolve(options.cwd);
  const scope = options.base ? 'branch' : (options.scope || 'working');
  if (!['working', 'staged', 'last', 'branch'].includes(scope)) throw new Error('Unknown git scope');
  git(cwd, ['rev-parse', '--show-toplevel']);
  const warnings: string[] = [];
  let revision: string | null = null;
  try { revision = git(cwd, ['rev-parse', 'HEAD']).trim(); } catch { /* unborn repository */ }
  let args: string[];
  let names: string[];
  if (scope === 'branch') {
    const ref = options.base;
    if (!ref || ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) throw new Error('Invalid base ref');
    const baseSHA = git(cwd, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
    args = ['diff', '--no-ext-diff', '--find-renames', baseSHA + '...HEAD'];
    names = ['diff', '--name-only', '-z', baseSHA + '...HEAD'];
  } else if (scope === 'last') {
    if (!revision) throw new Error('No HEAD commit to review');
    args = ['show', '--format=', '--no-ext-diff', 'HEAD'];
    names = ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'];
  } else if (scope === 'staged' || !revision) {
    args = ['diff', '--cached', '--no-ext-diff'];
    names = ['diff', '--cached', '--name-only', '-z'];
    if (!revision && scope !== 'staged') warnings.push('No HEAD: only staged files are included');
  } else {
    args = ['diff', '--no-ext-diff', '--find-renames', 'HEAD'];
    names = ['diff', '--name-only', '-z', 'HEAD'];
  }
  let diff = git(cwd, args);
  const files = new Set(git(cwd, names).split('\0').filter(Boolean));
  if (options.includeUntracked && scope === 'working') {
    const unknown = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    for (const filename of unknown) {
      const resolved = path.resolve(cwd, filename);
      if (!resolved.startsWith(cwd + path.sep)) { warnings.push('Unsafe file skipped: ' + filename); continue; }
      try {
        const stat = lstatSync(resolved);
        if (!stat.isFile() || stat.size > 256 * 1024 || readFileSync(resolved).includes(0)) {
          warnings.push('Binary/nonregular/oversized file skipped: ' + filename);
          continue;
        }
        const fragment = git(cwd, ['diff', '--no-ext-diff', '--no-index', '--', '/dev/null', filename], true);
        if (diff.length + fragment.length > DIFF_LIMIT) {
          warnings.push('Diff limit reached: ' + filename);
          continue;
        }
        diff += (diff && !diff.endsWith('\n') ? '\n' : '') + fragment;
        files.add(filename);
      } catch { warnings.push('Unreadable untracked file: ' + filename); }
    }
  }
  if (Buffer.byteLength(diff) > DIFF_LIMIT) throw new Error('Diff exceeds 10 MB');
  return { scope, revision, diff, files: [...files], warnings };
}
