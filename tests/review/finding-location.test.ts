import { describe, expect, it } from 'vitest';
import {
  committedDiffTarget, createFindingLocation, parseGitHubRemote
} from '../../src/review/finding-location.js';

const sha = 'a'.repeat(40);

describe('precise source links for review findings', () => {
  it('parses HTTPS, git SSH and ssh:// remotes without confusing .git suffix', () => {
    expect(parseGitHubRemote('https://github.com/backgaymanl-glitch/acl.git'))
      .toEqual({ owner: 'backgaymanl-glitch', repo: 'acl' });
    expect(parseGitHubRemote('git@github.com:acme/my-repo.git'))
      .toEqual({ owner: 'acme', repo: 'my-repo' });
    expect(parseGitHubRemote('ssh://git@github.com/acme/dotted.repo.git'))
      .toEqual({ owner: 'acme', repo: 'dotted.repo' });
    expect(parseGitHubRemote('https://notgithub.com/acme/repo')).toBeNull();
    expect(parseGitHubRemote('https://github.com/owner/repo/tree/main')).toBeNull();
    expect(parseGitHubRemote('https://evil@github.com/owner/repo')).toBeNull();
  });

  it('builds a permanent GitHub link to the exact committed new-side line', () => {
    expect(createFindingLocation('src/components/PageListView.vue', 1613, {
      remote: 'https://github.com/backgaymanl-glitch/acl.git', commitSha: sha
    })).toEqual({
      file: 'src/components/PageListView.vue', line: 1613,
      label: 'PageListView.vue:1613',
      sourceUrl: 'https://github.com/backgaymanl-glitch/acl/blob/' + sha +
        '/src/components/PageListView.vue#L1613'
    });
  });

  it('percent-encodes file names without changing their path segments', () => {
    expect(createFindingLocation('src/my folder/file #1.cs', 25, {
      remote: 'git@github.com:acme/demo.git', commitSha: sha
    }).sourceUrl).toContain('/src/my%20folder/file%20%231.cs#L25');
  });

  it('does not fabricate committed links for uncommitted, deleted or unsafe files', () => {
    for (const spec of [
      { file: 'src/app.js', line: 4, sha: null },
      { file: 'src/app.js', line: 4, sha, deleted: true },
      { file: '../secret.js', line: 4, sha },
      { file: '/etc/hosts', line: 4, sha },
      { file: 'C:\\Windows\\System32\\secrets.cs', line: 4, sha },
      { file: 'src/../../secret.js', line: 4, sha },
      { file: 'src/app.js', line: 0, sha },
      { file: 'src/app.js', line: 4.5, sha }
    ]) {
      expect(createFindingLocation(spec.file, spec.line, {
        remote: 'https://github.com/acme/demo',
        commitSha: spec.sha, deleted: spec.deleted
      }).sourceUrl).toBeNull();
    }
    expect(createFindingLocation('src/app.js', 4, {
      remote: 'https://example.com/acme/demo', commitSha: sha
    }).sourceUrl).toBeNull();
  });

  it('links only committed diff targets, never an arbitrary current worktree', () => {
    expect(committedDiffTarget('last')).toBe('HEAD');
    expect(committedDiffTarget('worktree', undefined, undefined, true)).toBe('HEAD');
    expect(committedDiffTarget('branch', 'main', 'feature/fix')).toBe('feature/fix');
    expect(committedDiffTarget('branch', 'main')).toBeNull();
    expect(committedDiffTarget('worktree')).toBeNull();
    expect(committedDiffTarget('staged')).toBeNull();
  });
});
