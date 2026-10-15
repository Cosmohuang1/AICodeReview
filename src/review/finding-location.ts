import path from 'node:path';

/** A review finding always keeps the full repo-relative path and new-side line. */
export interface FindingLocation {
  file: string;
  line: number;
  label: string;
  /** Only available when the inspected content exists in a committed Git revision. */
  sourceUrl: string | null;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

/**
 * Accept only well-formed GitHub origin remotes. Do not create "github.com/local"
 * links or use a user-provided URL directly in the browser UI.
 */
export function parseGitHubRemote(remote: string | null | undefined): GitHubRepository | null {
  if (!remote) return null;
  const match = remote.trim().match(
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i
  );
  if (!match || match[1] === '.' || match[1] === '..' ||
    match[2] === '.' || match[2] === '..') return null;
  return { owner: match[1], repo: match[2] };
}

/** A working-tree diff can contain edits that GitHub cannot yet display. */
export function committedDiffTarget(mode: string, from?: string, to?: string,
  usedLastFallback = false): string | null {
  if (usedLastFallback || mode === 'last') return 'HEAD';
  if (mode === 'branch' && from && to) return to;
  return null;
}

export function createFindingLocation(
  file: string,
  line: number,
  options: {
    remote: string | null | undefined;
    commitSha: string | null | undefined;
    deleted?: boolean;
  }
): FindingLocation {
  const normalized = typeof file === 'string' ? file.replace(/\\/g, '/') : '';
  const locationValid = normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-zA-Z]:\//.test(normalized) &&
    !normalized.includes('\0') &&
    !/[\x00-\x1f]/.test(normalized) &&
    normalized.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
  const lineValid = Number.isSafeInteger(line) && line > 0;
  const label = normalized && lineValid
    ? path.posix.basename(normalized) + ':' + line
    : (normalized ? path.posix.basename(normalized) + ':?' : '位置未确定');

  let sourceUrl: string | null = null;
  const github = parseGitHubRemote(options.remote);
  if (github && locationValid && lineValid && !options.deleted &&
    typeof options.commitSha === 'string' && /^[a-f0-9]{40}$/i.test(options.commitSha)) {
    const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
    sourceUrl = 'https://github.com/' + github.owner + '/' + github.repo +
      '/blob/' + options.commitSha + '/' + encodedPath + '#L' + line;
  }
  return { file: normalized, line, label, sourceUrl };
}
