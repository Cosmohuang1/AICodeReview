import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectGitChanges } from '../../src/local-review/git.js';

const folders: string[] = [];
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function repository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ai-review-git-'));
  folders.push(cwd);
  git(cwd, 'init');
  git(cwd, 'config', 'user.email', 'test@example.invalid');
  git(cwd, 'config', 'user.name', 'Reviewer');
  writeFileSync(join(cwd, 'file.ts'), 'export const value = 1;\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'init');
  return cwd;
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe('local Git change collector', () => {
  it('separates working and staged changes', () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'file.ts'), 'export const value = 2;\n');
    expect(collectGitChanges({ cwd, scope: 'working' }).files).toEqual(['file.ts']);
    expect(collectGitChanges({ cwd, scope: 'staged' }).files).toEqual([]);
    git(cwd, 'add', 'file.ts');
    expect(collectGitChanges({ cwd, scope: 'staged' }).rawDiff).toContain('+export const value = 2;');
  });

  it('includes untracked text only with explicit opt-in', () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'new.ts'), 'export const fresh = true;\n');
    expect(collectGitChanges({ cwd }).files).not.toContain('new.ts');
    const result = collectGitChanges({ cwd, includeUntracked: true });
    expect(result.files).toContain('new.ts');
    expect(result.rawDiff).toContain('fresh = true');
  });

  it('rejects option-looking refs', () => {
    const cwd = repository();
    expect(() => collectGitChanges({ cwd, scope: 'branch', base: '--output=/tmp/x' })).toThrow();
  });

  it('supports reviewing the last commit', () => {
    const cwd = repository();
    writeFileSync(join(cwd, 'file.ts'), 'export const value = 3;\n');
    git(cwd, 'add', 'file.ts');
    git(cwd, 'commit', '-m', 'change');
    const result = collectGitChanges({ cwd, scope: 'last' });
    expect(result.rawDiff).toContain('+export const value = 3;');
    expect(result.files).toContain('file.ts');
  });
});
