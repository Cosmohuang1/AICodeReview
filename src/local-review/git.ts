import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { GitChangeSet, GitScope } from './types.js';

const MAX_DIFF = 10 * 1024 * 1024;
const MAX_UNTRACKED = 256 * 1024;

function git(cwd: string, args: string[], allowExitOne = false): string {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', maxBuffer: MAX_DIFF + 1024,
      timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string; message: string };
    if (allowExitOne && e.status === 1) return e.stdout ?? '';
    throw new Error('git ' + args[0] + ' failed: ' + (e.stderr || e.message).slice(0, 800));
  }
}

function checkedRef(cwd: string, ref: string): string {
  if (!ref || ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) {
    throw new Error('Invalid Git reference');
  }
  return git(cwd, ['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
}

function safeFile(cwd: string, filename: string): string | null {
  const root = resolve(cwd);
  const full = resolve(root, filename);
  if (full === root || !full.startsWith(root + sep)) return null;
  if (relative(root, full).startsWith('..')) return null;
  return full;
}

/** Collect Git changes with argv, never via an interpolated shell command. */
export function collectGitChanges(options: {
  cwd: string;
  scope?: GitScope;
  base?: string;
  includeUntracked?: boolean;
}): GitChangeSet {
  const cwd = resolve(options.cwd);
  const scope = options.scope ?? 'working';
  if (!['working', 'staged', 'last', 'branch'].includes(scope)) throw new Error('Invalid scope');
  git(cwd, ['rev-parse', '--show-toplevel']);
  let head = '';
  try { head = git(cwd, ['rev-parse', 'HEAD']).trim(); } catch { /* new repo */ }
  const warnings: string[] = [];
  let args: string[];
  let nameArgs: string[];
  let base: string | undefined;

  if (scope === 'branch') {
    if (!options.base) throw new Error('--base is required for branch mode');
    base = checkedRef(cwd, options.base);
    args = ['diff', '--no-ext-diff', '--find-renames', base + '...HEAD'];
    nameArgs = ['diff', '--name-only', '-z', base + '...HEAD'];
  } else if (scope === 'last') {
    if (!head) throw new Error('No HEAD commit');
    args = ['show', '--format=', '--no-ext-diff', '--find-renames', 'HEAD'];
    nameArgs = ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD'];
  } else if (scope === 'staged') {
    args = ['diff', '--cached', '--no-ext-diff', '--find-renames'];
    nameArgs = ['diff', '--cached', '--name-only', '-z'];
  } else if (head) {
    args = ['diff', '--no-ext-diff', '--find-renames', 'HEAD'];
    nameArgs = ['diff', '--name-only', '-z', 'HEAD'];
  } else {
    args = ['diff', '--cached', '--no-ext-diff'];
    nameArgs = ['diff', '--cached', '--name-only', '-z'];
    warnings.push('Repository has no HEAD; stage files before reviewing.');
  }

  let rawDiff = git(cwd, args);
  const files = new Set(git(cwd, nameArgs).split('\0').filter(Boolean));

  if (options.includeUntracked && scope === 'working') {
    const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    for (const filename of untracked) {
      const full = safeFile(cwd, filename);
      if (!full) { warnings.push('Unsafe path skipped: ' + filename); continue; }
      try {
        const stat = lstatSync(full);
        if (!stat.isFile() || stat.size > MAX_UNTRACKED) {
          warnings.push('Oversized or non-regular untracked file skipped: ' + filename);
          continue;
        }
        if (readFileSync(full).includes(0)) {
          warnings.push('Binary untracked file skipped: ' + filename);
          continue;
        }
        const extra = git(cwd, ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', filename], true);
        if (rawDiff.length + extra.length > MAX_DIFF) {
          warnings.push('Diff budget exceeded; skipped: ' + filename);
          continue;
        }
        rawDiff += (rawDiff.endsWith('\n') || !rawDiff ? '' : '\n') + extra;
        files.add(filename);
      } catch (err) {
        warnings.push('Could not read untracked file ' + filename + ': ' + String(err).slice(0, 120));
      }
    }
  }
  if (rawDiff.length > MAX_DIFF) throw new Error('Diff exceeds 10 MB safety limit');
  return { scope, head, base, rawDiff, files: [...files], warnings };
}
