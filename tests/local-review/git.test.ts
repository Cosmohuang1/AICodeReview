import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectLocalChanges } from '../../src/local-review/git.js';

const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-git-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'index.ts'), 'export const n = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  return { dir, git };
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('collectLocalChanges', () => {
  it('captures tracked changes without a shell', () => {
    const { dir } = fixture();
    writeFileSync(path.join(dir, 'index.ts'), 'export const n = 2;\n');
    const result = collectLocalChanges({ cwd: dir });
    expect(result.diff).toContain('+export const n = 2;');
    expect(result.files).toEqual(['index.ts']);
  });
  it('captures untracked files when explicitly requested', () => {
    const { dir } = fixture();
    writeFileSync(path.join(dir, 'new.ts'), 'export const added = true;\n');
    const result = collectLocalChanges({ cwd: dir, includeUntracked: true });
    expect(result.files).toContain('new.ts');
    expect(result.diff).toContain('export const added = true;');
  });
  it('rejects shell-shaped ref arguments', () => {
    const { dir } = fixture();
    expect(() => collectLocalChanges({ cwd: dir, base: '--upload-pack=bad' })).toThrow();
  });
});
