import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { GitService } from '../../src/services/git.service.js';

describe('GitService', () => {
  let tempRepoDir: string;

  beforeEach(() => {
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-service-test-'));
    // 初始化临时 Git 仓库
    execSync('git init -b main', { cwd: tempRepoDir });
    execSync('git config user.name "TestUser"', { cwd: tempRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: tempRepoDir });

    // 提交一个初始文件
    fs.writeFileSync(path.join(tempRepoDir, 'initial.txt'), 'hello world\nline 2\n');
    execSync('git add initial.txt', { cwd: tempRepoDir });
    execSync('git commit -m "initial commit"', { cwd: tempRepoDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('正确获取工作区基本信息与当前分支', () => {
    const gitService = new GitService();
    const status = gitService.getWorkspaceStatus(tempRepoDir);

    expect(status.currentBranch).toBe('main');
    expect(status.hasChanges).toBe(false);
    expect(status.changedFiles.length).toBe(0);
    expect(status.lastCommit.message).toBe('initial commit');
    expect(status.lastCommit.author).toBe('TestUser');
    expect(status.lastCommit.hash.length).toBeGreaterThan(0);
  });

  it('正确检测修改文件及增删统计 (modified)', () => {
    // 修改文件
    fs.appendFileSync(path.join(tempRepoDir, 'initial.txt'), 'line 3\nline 4\n');

    const gitService = new GitService();
    const status = gitService.getWorkspaceStatus(tempRepoDir);

    expect(status.hasChanges).toBe(true);
    expect(status.changedFiles.length).toBe(1);
    expect(status.changedFiles[0].path).toBe('initial.txt');
    expect(status.changedFiles[0].status).toBe('modified');
    expect(status.changedFiles[0].additions).toBe(2);
    expect(status.changedFiles[0].deletions).toBe(0);
    expect(status.totalAdditions).toBe(2);
  });

  it('正确检测未跟踪新文件 (untracked)', () => {
    fs.writeFileSync(path.join(tempRepoDir, 'new-file.ts'), 'export const a = 1;\nexport const b = 2;\n');

    const gitService = new GitService();
    const status = gitService.getWorkspaceStatus(tempRepoDir);

    expect(status.hasChanges).toBe(true);
    const untracked = status.changedFiles.find(f => f.path === 'new-file.ts');
    expect(untracked).toBeDefined();
    expect(untracked?.status).toBe('untracked');
    expect(untracked?.additions).toBe(2);
  });

  it('获取真实的 Unified Diff 内容', () => {
    fs.appendFileSync(path.join(tempRepoDir, 'initial.txt'), 'more lines\n');

    const gitService = new GitService();
    const diff = gitService.getUnifiedDiff(tempRepoDir);

    expect(diff).toContain('--- a/initial.txt');
    expect(diff).toContain('+++ b/initial.txt');
    expect(diff).toContain('+more lines');
  });

  it('支持创建分支与真实 Commit', () => {
    fs.writeFileSync(path.join(tempRepoDir, 'feature.js'), 'console.log("feat");\n');

    const gitService = new GitService();
    const branchName = 'coderabbit/task-test-123';
    gitService.createBranch(tempRepoDir, branchName);

    const commitHash = gitService.commitAll(tempRepoDir, 'feat: add feature.js');
    expect(commitHash.length).toBeGreaterThan(0);

    const statusAfter = gitService.getWorkspaceStatus(tempRepoDir);
    expect(statusAfter.currentBranch).toBe(branchName);

    // 测试带引号、特殊字符与换行符的安全 commit (防 Shell 注入)
    fs.appendFileSync(path.join(tempRepoDir, 'feature.js'), '// change 2\n');
    const complexMsg = 'feat: "quotes" & `backticks` and \\slashes\n\n- bullet point 1';
    const secondHash = gitService.commitAll(tempRepoDir, complexMsg);
    expect(secondHash.length).toBeGreaterThan(0);
    expect(statusAfter.hasChanges).toBe(false);
    expect(statusAfter.lastCommit.message).toBe('feat: add feature.js');
  });

  it('支持列出本地分支与当前高亮分支 (listBranches)', () => {
    const gitService = new GitService();
    // 初始只有 main 分支
    const initialBranches = gitService.listBranches(tempRepoDir);
    expect(initialBranches.current).toBe('main');
    expect(initialBranches.branches).toContain('main');

    // 新建一个分支 feature-demo
    gitService.createBranch(tempRepoDir, 'feature-demo');
    const updatedBranches = gitService.listBranches(tempRepoDir);
    expect(updatedBranches.current).toBe('feature-demo');
    expect(updatedBranches.branches).toContain('main');
    expect(updatedBranches.branches).toContain('feature-demo');
  });

  it('支持安全切换已存在的分支与新建分支 (checkoutBranch)', () => {
    const gitService = new GitService();
    // 创建一个分支 develop
    gitService.createBranch(tempRepoDir, 'develop');
    expect(gitService.listBranches(tempRepoDir).current).toBe('develop');

    // 切换回 main
    const checkoutResult = gitService.checkoutBranch(tempRepoDir, 'main');
    expect(checkoutResult.current).toBe('main');
    expect(gitService.listBranches(tempRepoDir).current).toBe('main');

    // createIfMissing 模式创建并检出新分支
    const newBranchResult = gitService.checkoutBranch(tempRepoDir, 'release/v1.0', true);
    expect(newBranchResult.current).toBe('release/v1.0');
    expect(gitService.listBranches(tempRepoDir).current).toBe('release/v1.0');
  });

  it('切换不存在的分支时抛出明确异常', () => {
    const gitService = new GitService();
    expect(() => {
      gitService.checkoutBranch(tempRepoDir, 'non-existent-branch-999');
    }).toThrow();
  });
});
