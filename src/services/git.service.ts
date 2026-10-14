import { execSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export interface FileChangeItem {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  additions: number;
  deletions: number;
}

export interface WorkspaceStatus {
  repoName: string;
  repoPath: string;
  currentBranch: string;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    timeAgo: string;
  };
  hasChanges: boolean;
  changedFiles: FileChangeItem[];
  totalAdditions: number;
  totalDeletions: number;
}

export class GitService {
  /**
   * 检查是否为有效 Git 仓库
   */
  isGitRepo(repoPath: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取工作区真实状态与改动统计
   */
  getWorkspaceStatus(repoPath: string): WorkspaceStatus {
    const resolvedPath = path.resolve(repoPath);
    if (!this.isGitRepo(resolvedPath)) {
      throw new Error(`目录不是有效的 Git 仓库: ${resolvedPath}`);
    }

    const repoName = path.basename(resolvedPath);

    // 1. 获取当前分支
    let currentBranch = 'main';
    try {
      currentBranch = execSync('git branch --show-current', { cwd: resolvedPath }).toString().trim();
      if (!currentBranch) {
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: resolvedPath }).toString().trim();
      }
    } catch {
      currentBranch = 'HEAD';
    }

    // 2. 获取最新 commit 信息
    let lastCommit = { hash: '', message: '', author: '', timeAgo: '' };
    try {
      const commitLog = execSync('git log -1 --format="%h|%s|%an|%cr"', { cwd: resolvedPath }).toString().trim();
      if (commitLog) {
        const [hash, message, author, timeAgo] = commitLog.split('|');
        lastCommit = {
          hash: hash || '',
          message: message || '',
          author: author || '',
          timeAgo: timeAgo || 'recently'
        };
      }
    } catch {
      // 仓库可能尚无提交
    }

    // 3. 统计已跟踪文件的修改增删 (git diff --numstat 和 git diff --cached --numstat)
    const numstatMap = new Map<string, { additions: number; deletions: number }>();

    try {
      // 工作区未暂存
      const unstagedStat = execSync('git diff --numstat', { cwd: resolvedPath }).toString().trim();
      if (unstagedStat) {
        for (const line of unstagedStat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const adds = parseInt(parts[0], 10) || 0;
            const dels = parseInt(parts[1], 10) || 0;
            const filePath = parts[2].trim();
            const existing = numstatMap.get(filePath) || { additions: 0, deletions: 0 };
            numstatMap.set(filePath, { additions: existing.additions + adds, deletions: existing.deletions + dels });
          }
        }
      }

      // 暂存区改动
      const stagedStat = execSync('git diff --cached --numstat', { cwd: resolvedPath }).toString().trim();
      if (stagedStat) {
        for (const line of stagedStat.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const adds = parseInt(parts[0], 10) || 0;
            const dels = parseInt(parts[1], 10) || 0;
            const filePath = parts[2].trim();
            const existing = numstatMap.get(filePath) || { additions: 0, deletions: 0 };
            numstatMap.set(filePath, { additions: existing.additions + adds, deletions: existing.deletions + dels });
          }
        }
      }
    } catch {
      // ignore
    }

    // 4. 解析 git status --porcelain
    const changedFiles: FileChangeItem[] = [];
    try {
      const statusOut = execSync('git status --porcelain', { cwd: resolvedPath }).toString();
      if (statusOut) {
        const lines = statusOut.split('\n').filter(l => l.trim().length > 0);
        for (const line of lines) {
          const code = line.slice(0, 2);
          const rawFile = line.slice(3).trim();
          // 处理重命名 arrow (e.g. old -> new)
          const filePath = rawFile.includes(' -> ') ? rawFile.split(' -> ')[1] : rawFile;

          let statusType: FileChangeItem['status'] = 'modified';
          if (code.includes('?') || code.includes('A')) {
            statusType = code.includes('?') ? 'untracked' : 'added';
          } else if (code.includes('D')) {
            statusType = 'deleted';
          }

          let additions = 0;
          let deletions = 0;

          if (numstatMap.has(filePath)) {
            const stat = numstatMap.get(filePath)!;
            additions = stat.additions;
            deletions = stat.deletions;
          } else if (statusType === 'untracked') {
            // 未跟踪文件：统计其实际行数
            try {
              const fullPath = path.join(resolvedPath, filePath);
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                const content = fs.readFileSync(fullPath, 'utf-8').trim();
                additions = content ? content.split('\n').length : 0;
              }
            } catch {
              additions = 1;
            }
          }

          changedFiles.push({
            path: filePath,
            status: statusType,
            additions,
            deletions
          });
        }
      }
    } catch {
      // ignore
    }

    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const item of changedFiles) {
      totalAdditions += item.additions;
      totalDeletions += item.deletions;
    }

    return {
      repoName,
      repoPath: resolvedPath,
      currentBranch,
      lastCommit,
      hasChanges: changedFiles.length > 0,
      changedFiles,
      totalAdditions,
      totalDeletions
    };
  }

  /**
   * 获取 Unified Diff
   */
  getUnifiedDiff(repoPath: string, mode: 'worktree' | 'staged' | 'last' = 'worktree'): string {
    const resolvedPath = path.resolve(repoPath);
    let cmd = 'git diff HEAD';
    if (mode === 'staged') {
      cmd = 'git diff --cached';
    } else if (mode === 'last') {
      cmd = 'git show HEAD';
    } else {
      // worktree diff 包括暂存区与未暂存区
      try {
        const headDiff = execSync('git diff HEAD', { cwd: resolvedPath, maxBuffer: 10 * 1024 * 1024 }).toString();
        if (headDiff.trim()) return headDiff;
      } catch {
        // 如果无 HEAD（全新仓库），则使用 git diff
      }
      cmd = 'git diff';
    }

    try {
      return execSync(cmd, { cwd: resolvedPath, maxBuffer: 10 * 1024 * 1024 }).toString();
    } catch {
      return '';
    }
  }

  /**
   * 列出所有本地分支与当前分支
   */
  listBranches(repoPath: string): { current: string; branches: string[] } {
    const resolvedPath = path.resolve(repoPath);
    if (!this.isGitRepo(resolvedPath)) {
      throw new Error(`目录不是有效的 Git 仓库: ${resolvedPath}`);
    }

    try {
      const output = execSync('git branch --format="%(refname:short)|%(HEAD)"', {
        cwd: resolvedPath,
        encoding: 'utf-8',
      }).trim();

      let current = '';
      const branches: string[] = [];

      if (output) {
        for (const line of output.split('\n')) {
          const [branch, headMarker] = line.trim().split('|');
          if (branch) {
            branches.push(branch);
            if (headMarker === '*' || headMarker === '+') {
              current = branch;
            }
          }
        }
      }

      if (!current) {
        try {
          current = execSync('git branch --show-current', { cwd: resolvedPath }).toString().trim();
        } catch {
          current = branches[0] || 'main';
        }
      }

      return {
        current: current || 'main',
        branches: Array.from(new Set(branches)),
      };
    } catch (err: any) {
      throw new Error(`获取分支列表失败: ${err.message}`);
    }
  }

  /**
   * 切换到目标分支 (若 createIfMissing 为 true 且分支不存在则创建)
   */
  checkoutBranch(repoPath: string, branchName: string, createIfMissing: boolean = false): { current: string } {
    const resolvedPath = path.resolve(repoPath);
    if (!this.isGitRepo(resolvedPath)) {
      throw new Error(`目录不是有效的 Git 仓库: ${resolvedPath}`);
    }

    const trimmedBranch = branchName.trim();
    if (!trimmedBranch) {
      throw new Error('分支名称不能为空');
    }

    if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(trimmedBranch)) {
      throw new Error(`分支名称包含非法字符: ${trimmedBranch}`);
    }

    try {
      if (createIfMissing) {
        const { branches } = this.listBranches(resolvedPath);
        if (branches.includes(trimmedBranch)) {
          execSync(`git checkout "${trimmedBranch}"`, { cwd: resolvedPath, stdio: 'pipe' });
        } else {
          execSync(`git checkout -b "${trimmedBranch}"`, { cwd: resolvedPath, stdio: 'pipe' });
        }
      } else {
        execSync(`git checkout "${trimmedBranch}"`, { cwd: resolvedPath, stdio: 'pipe' });
      }

      const current = execSync('git branch --show-current', { cwd: resolvedPath }).toString().trim() || trimmedBranch;
      return { current };
    } catch (err: any) {
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      throw new Error(`切换分支失败 [${trimmedBranch}]: ${stderr.trim()}`);
    }
  }

  /**
   * 创建并切换到新分支
   */
  createBranch(repoPath: string, branchName: string): void {
    const resolvedPath = path.resolve(repoPath);
    execFileSync('git', ['checkout', '-b', branchName], { cwd: resolvedPath, stdio: 'ignore' });
  }

  /**
   * 暂存并提交所有更改
   */
  commitAll(repoPath: string, message: string): string {
    const resolvedPath = path.resolve(repoPath);
    execFileSync('git', ['add', '-A'], { cwd: resolvedPath });
    execFileSync('git', ['commit', '-m', message], { cwd: resolvedPath });
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: resolvedPath, encoding: 'utf-8' }).trim();
  }
}
