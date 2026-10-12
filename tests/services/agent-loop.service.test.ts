import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { AgentLoopService } from '../../src/services/agent-loop.service.js';
import * as baseAgent from '../../src/agents/base.js';

describe('AgentLoopService', () => {
  let tempRepoDir: string;

  beforeEach(() => {
    tempRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-test-'));
    execSync('git init -b main', { cwd: tempRepoDir });
    execSync('git config user.name "AgentTest"', { cwd: tempRepoDir });
    execSync('git config user.email "agent@example.com"', { cwd: tempRepoDir });

    fs.writeFileSync(path.join(tempRepoDir, 'main.js'), 'console.log("hello");\n');
    execSync('git add main.js', { cwd: tempRepoDir });
    execSync('git commit -m "initial"', { cwd: tempRepoDir });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tempRepoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('端到端执行代码修改、跑测与自动分支 Commit', async () => {
    // Mock callDeepSeek 返回结构化 JSON
    vi.spyOn(baseAgent, 'callDeepSeek').mockResolvedValue(`
\`\`\`json
{
  "summary": "重构 main.js 并增加工具函数",
  "bulletPoints": ["重构 main.js", "新增 utils.js"],
  "riskNote": "已完成本地单元测试回归",
  "fileChanges": [
    { "path": "main.js", "content": "console.log('updated');\\n" },
    { "path": "utils.js", "content": "export const add = (a, b) => a + b;\\n" }
  ]
}
\`\`\`
`);

    const loopService = new AgentLoopService();
    const result = await loopService.executeTask({
      cwd: tempRepoDir,
      prompt: '重构 main.js 并增加 utils.js',
      testCmd: 'node -e "console.log(\'10 passed\'); process.exit(0)"',
      branchName: 'coderabbit/task-autofix-01',
      autoCommit: true,
      runTests: true
    });

    expect(result.id).toBeDefined();
    expect(result.branch).toBe('coderabbit/task-autofix-01');
    expect(result.commitHash.length).toBeGreaterThan(0);
    expect(result.editedFiles.length).toBe(2);
    expect(result.regressionStatus).toContain('通过');

    // 验证文件是否真正写入磁盘！
    expect(fs.readFileSync(path.join(tempRepoDir, 'main.js'), 'utf-8')).toBe("console.log('updated');\n");
    expect(fs.readFileSync(path.join(tempRepoDir, 'utils.js'), 'utf-8')).toBe("export const add = (a, b) => a + b;\n");

    // 验证 Git 分支与 Commit 是否真实存在！
    const currentBranch = execSync('git branch --show-current', { cwd: tempRepoDir }).toString().trim();
    expect(currentBranch).toBe('coderabbit/task-autofix-01');
    const log = execSync('git log -1 --format="%s"', { cwd: tempRepoDir }).toString().trim();
    expect(log).toContain('重构 main.js 并增加工具函数');
  });
});
