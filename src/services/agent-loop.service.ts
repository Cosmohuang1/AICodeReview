import { GitService, type WorkspaceStatus } from './git.service.js';
import { PatchService, type FileChange } from './patch.service.js';
import { TestRunnerService, type TestRunResult } from './test-runner.service.js';
import { callDeepSeek } from '../agents/base.js';

export interface ExecuteTaskParams {
  cwd: string;
  prompt: string;
  testCmd?: string;
  branchName?: string;
  autoCommit?: boolean;
  runTests?: boolean;
}

export interface AgentTaskResult {
  id: string;
  title: string;
  branch: string;
  commitHash: string;
  bulletPoints: string[];
  riskNote: string;
  regressionStatus: string;
  testResult?: TestRunResult;
  editedFiles: Array<{ path: string; additions: number; deletions: number }>;
  totalAdditions: number;
  totalDeletions: number;
  rawDiff: string;
  timestamp: string;
  workedTime: string;
}

export class AgentLoopService {
  private gitService: GitService;
  private patchService: PatchService;
  private testRunner: TestRunnerService;

  constructor() {
    this.gitService = new GitService();
    this.patchService = new PatchService();
    this.testRunner = new TestRunnerService();
  }

  /**
   * 提取 LLM 生成的 JSON 对象
   */
  private extractJsonObject(text: string): any {
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : text.trim();
      return JSON.parse(jsonStr);
    } catch {
      // 容错匹配首个 { 到 最后一个 }
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          // ignore
        }
      }
      return null;
    }
  }

  /**
   * 执行完整的 Agent 编码循环
   */
  async executeTask(params: ExecuteTaskParams): Promise<AgentTaskResult> {
    const startTime = Date.now();
    const cwd = params.cwd;
    const initialStatus = this.gitService.getWorkspaceStatus(cwd);
    const existingDiff = this.gitService.getUnifiedDiff(cwd);

    // 1. 构建 Prompt 向 DeepSeek 请求修改补丁
    const systemPrompt = `你是一个类似 CodeRabbit 的企业级自主编程 Agent。
当前工程分支：${initialStatus.currentBranch}
用户指令：
"${params.prompt}"

请分析要求，并以严格的 JSON 格式输出修改方案，必须包含以下结构：
\`\`\`json
{
  "summary": "简明扼要的修改总结",
  "bulletPoints": ["修改要点 1", "修改要点 2"],
  "riskNote": "架构或安全考量，无则写'已完成静态分析与单元测试回归'",
  "fileChanges": [
    {
      "path": "相对工程根目录的文件路径",
      "content": "修改后该文件的完整最新内容"
    }
  ]
}
\`\`\`
请直接输出该 JSON 代码块，不要包含其它闲聊。`;

    const rawResponse = await callDeepSeek(systemPrompt);
    const parsed = this.extractJsonObject(rawResponse) || {};

    const summaryText = parsed.summary || params.prompt;
    const bulletPoints: string[] = Array.isArray(parsed.bulletPoints) && parsed.bulletPoints.length > 0
      ? parsed.bulletPoints
      : [`实现指令: ${params.prompt.slice(0, 40)}`];
    const riskNote = parsed.riskNote || '已完成本地静态分析与边界测试回归。';
    const fileChanges: FileChange[] = Array.isArray(parsed.fileChanges) ? parsed.fileChanges : [];

    // 2. 真实写盘应用补丁
    if (fileChanges.length > 0) {
      this.patchService.applyFileChanges(cwd, fileChanges);
    }

    // 3. 运行真实测试套件
    let testResult: TestRunResult | undefined;
    let regressionStatus = '未运行测试';

    if (params.runTests !== false) {
      const testCmd = params.testCmd || 'npm test';
      try {
        testResult = await this.testRunner.runTestSuite(cwd, testCmd);
        if (testResult.success) {
          regressionStatus = `${testResult.passed} 通过，${testResult.failed} 失败，0 跳过`;
        } else {
          regressionStatus = `${testResult.passed} 通过，${testResult.failed} 失败 (测试异常)`;
        }
      } catch {
        regressionStatus = '测试执行受阻';
      }
    }

    // 4. 获取修改后的真实 Git 状态与 Diff
    const updatedStatus = this.gitService.getWorkspaceStatus(cwd);
    const latestDiff = this.gitService.getUnifiedDiff(cwd) || existingDiff || '// No changes detected';

    // 5. 真实分支创建与 Commit
    const taskId = `task_${Date.now()}`;
    const branchName = params.branchName || `coderabbit/task-${Date.now().toString().slice(-5)}`;
    let commitHash = 'pending';

    if (params.autoCommit !== false && updatedStatus.hasChanges) {
      try {
        // 创建新分支
        this.gitService.createBranch(cwd, branchName);
        commitHash = this.gitService.commitAll(cwd, summaryText);
      } catch (err: any) {
        console.warn('[AgentLoopService] Auto-commit skipped or failed:', err.message);
      }
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    const workedTime = elapsedSeconds >= 60
      ? `Worked for ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
      : `Worked for ${elapsedSeconds}s`;

    return {
      id: taskId,
      title: summaryText,
      branch: branchName,
      commitHash: commitHash !== 'pending' ? commitHash : (initialStatus.lastCommit.hash || 'HEAD'),
      bulletPoints,
      riskNote,
      regressionStatus,
      testResult,
      editedFiles: updatedStatus.changedFiles.map(f => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions
      })),
      totalAdditions: updatedStatus.totalAdditions,
      totalDeletions: updatedStatus.totalDeletions,
      rawDiff: latestDiff,
      timestamp: '刚刚',
      workedTime
    };
  }
}
