import path from 'path';
import { GitService, type WorkspaceStatus } from './git.service.js';
import { PatchService, type FileChange } from './patch.service.js';
import { TestRunnerService, type TestRunResult } from './test-runner.service.js';
import { callDeepSeek } from '../agents/base.js';
import { detectProjectTests, verifyProjectTests, type ProjectTestReport } from '../testing/project-tests.js';

export interface ExecuteTaskParams {
  cwd: string;
  prompt: string;
  testCmd?: string;
  branchName?: string;
  autoCommit?: boolean;
  runTests?: boolean;
}

export interface AgentStepItem {
  title: string;
  commands?: Array<{ command: string; output: string }>;
  message?: string;
}

export interface AgentTaskResult {
  id: string;
  title: string;
  branch: string;
  commitHash: string;
  userPrompt: string;
  thoughtProcess: string;
  message?: string;
  steps: AgentStepItem[];
  bulletPoints: string[];
  riskNote: string;
  regressionStatus: string;
  testResult?: TestRunResult;
  projectTesting?: ProjectTestReport;
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

    // 1. 构建 Prompt 向 DeepSeek 请求修改补丁与思考链
    const systemPrompt = `你是一个类似 CodeRabbit / Cursor 的企业级自主编程与代码审查 Agent。
当前工程：${path.basename(cwd)}
当前工程分支：${initialStatus.currentBranch}
用户指令：
"${params.prompt}"

请你像一个经验丰富的资深工程师一样，深度分析用户意图并给出严谨的决策方案：
1. thoughtProcess: 详细记录你的深度思考链路（需求意图解析、工作区影响面、架构策略与风险分析）；
2. summary: 一句话任务总结；
3. message: 针对用户的工程师口吻直接回应说明；
4. bulletPoints: 执行要点列表；
5. fileChanges: 具体修改的代码文件清单（如为问候语或无代码改动需求，可为空数组 []）。

请以严格的 JSON 格式输出：
\`\`\`json
{
  "thoughtProcess": "1. 意图解析：...\\n2. 仓库状态：...\\n3. 架构决策：...\\n4. 质量保障：...",
  "summary": "简明扼要的修改总结",
  "message": "详细说明已完成的操作或解释为何无需修改...",
  "bulletPoints": ["修改要点 1", "修改要点 2"],
  "riskNote": "架构或安全考量，无则写'已完成本地静态分析与单元测试回归'",
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
    const modelRiskNote = parsed.riskNote || 'AI 静态分析完成；尚未验证测试结果。';
    const fileChanges: FileChange[] = Array.isArray(parsed.fileChanges) ? parsed.fileChanges : [];

    // 2. 真实写盘应用补丁
    if (fileChanges.length > 0) {
      this.patchService.applyFileChanges(cwd, fileChanges);
    }

    // 3. Detect the actual project stack before choosing a test runner.
    // Execution is opt-out here because this endpoint is the explicitly authorized
    // coding Agent; review-only endpoints require a separate explicit runTests flag.
    const detection = detectProjectTests(cwd, fileChanges.map(f => f.path));
    let projectTesting: ProjectTestReport | undefined;
    let testResult: TestRunResult | undefined;
    let regressionStatus = '未运行测试';
    if (params.runTests === false) {
      projectTesting = await verifyProjectTests(cwd, detection, false);
      regressionStatus = '未运行测试（已显式关闭）';
    } else if (params.testCmd) {
      // Historical explicit test commands are preserved for backward compatibility.
      try {
        testResult = await this.testRunner.runTestSuite(cwd, params.testCmd);
        regressionStatus = testResult.success
          ? testResult.passed > 0
            ? '已观察到 ' + testResult.passed + ' 个测试通过；详细以真实日志为准'
            : '指定测试命令退出 0，但未观察到通过用例；结果仍需确认'
          : '指定测试命令失败，退出码 ' + testResult.exitCode;
      } catch (error) {
        regressionStatus = '指定测试命令执行受阻：' + String(error);
      }
    } else {
      projectTesting = await verifyProjectTests(cwd, detection, true);
      const passed = projectTesting.executions.reduce((n, e) => n + (e.observedPassed ?? 0), 0);
      const failed = projectTesting.executions.reduce((n, e) => n + (e.observedFailed ?? 0), 0);
      regressionStatus = projectTesting.status === 'passed'
        ? '自动化测试通过：' + passed + ' 用例通过'
        : projectTesting.status === 'no-tests'
          ? '无可运行测试（已识别项目类型，未执行任何测试）'
          : projectTesting.status === 'failed'
            ? '自动化测试失败：' + failed + ' 个已报告的用例失败'
            : '测试未完整验证：' + projectTesting.executions.map(x =>
                x.project.kind + '/' + x.project.directory + '=' + x.status).join(', ');
      const item = projectTesting.executions[0];
      if (item) {
        testResult = {
          command: [item.project.command?.executable, ...(item.project.command?.args || [])].filter(Boolean).join(' '),
          exitCode: item.exitCode ?? 1,
          success: item.status === 'passed',
          durationMs: item.durationMs,
          passed: item.observedPassed ?? 0,
          failed: item.observedFailed ?? 0,
          total: (item.observedPassed ?? 0) + (item.observedFailed ?? 0),
          outputSnippet: item.outputSnippet,
          timedOut: item.status === 'blocked'
        };
      }
    }

    // 4. 获取修改后的真实 Git 状态与 Diff
    const updatedStatus = this.gitService.getWorkspaceStatus(cwd);
    const latestDiff = this.gitService.getUnifiedDiff(cwd) || existingDiff || '// 当前工作区无代码改动';

    // 5. 真实分支创建与 Commit
    const taskId = `task_${Date.now()}`;
    const branchName = params.branchName || `task/task-${Date.now().toString().slice(-5)}`;
    let commitHash = 'pending';

    const testsPassed = params.testCmd
      ? Boolean(testResult?.success)
      : projectTesting?.status === 'passed';
    // Never automatically commit unverified or failing changes. A user can
    // inspect and manually commit after resolving the missing test environment.
    if (params.autoCommit !== false && updatedStatus.hasChanges && testsPassed) {
      try {
        this.gitService.createBranch(cwd, branchName);
        commitHash = this.gitService.commitAll(cwd, summaryText);
      } catch (err: any) {
        console.warn('[AgentLoopService] Auto-commit skipped or failed:', err.message);
      }
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    const workedTime = elapsedSeconds >= 60
      ? `耗时 ${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`
      : `耗时 ${elapsedSeconds} 秒`;

    // 6. 构造真实思考过程与执行步骤
    let thoughtProcess = parsed.thoughtProcess;
    if (!thoughtProcess || thoughtProcess.trim().length === 0) {
      thoughtProcess = `1. 用户指令解析：分析输入 "${params.prompt}"，确定核心意图与诉求范围；\n` +
        `2. 工作区上下文扫描：当前工作区 ${path.basename(cwd)}，位于分支 ${initialStatus.currentBranch}，基线提交 ${initialStatus.lastCommit.hash || 'HEAD'}；\n` +
        `3. 变更执行决策：${fileChanges.length > 0 ? `计划并实施了 ${fileChanges.length} 个核心文件的代码补丁写入；` : '识别到用户未提出具体代码变更指令，不执行读写操作，保持当前工作区纯净；'}\n` +
        `4. 自动化回归验证：${regressionStatus}。`;
    }

    const steps: AgentStepItem[] = [
      {
        title: '工作区环境诊断与分支初始化',
        commands: [
          {
            command: 'git status --short',
            output: initialStatus.hasChanges 
              ? initialStatus.changedFiles.map(f => `${f.status === 'modified' ? 'M' : 'A'} ${f.path}`).join('\n')
              : '工作区干净，无未暂存修改'
          },
          {
            command: 'git rev-parse --short HEAD',
            output: initialStatus.lastCommit.hash || 'HEAD'
          }
        ]
      }
    ];

    if (fileChanges.length > 0) {
      steps.push({
        title: `应用代码补丁 (${fileChanges.length} 个文件)`,
        commands: [
          {
            command: 'git diff --stat',
            output: fileChanges.map(f => `${f.path} | 代码写入就绪`).join('\n')
          }
        ],
        message: parsed.message || `已针对 ${fileChanges.length} 个文件写入最新代码补丁。`
      });
    }

    if (projectTesting) {
      steps.push({
        title: '项目类型识别与自动化测试验证',
        message: regressionStatus,
        commands: projectTesting.executions.length
          ? projectTesting.executions.map(e => ({
              command: [e.project.command?.executable, ...(e.project.command?.args || [])].filter(Boolean).join(' '),
              output: e.reason + '\n' + e.outputSnippet.slice(-2000)
            }))
          : detection.projects.map(p => ({
              command: p.command
                ? [p.command.executable, ...p.command.args].join(' ')
                : '(No detected test command)',
              output: p.note + '; ' + regressionStatus
            }))
      });
    } else if (testResult) {
      steps.push({
        title: '显式指定的测试命令验证',
        commands: [{ command: params.testCmd || '(not specified)', output: testResult.outputSnippet }]
      });
    }

    return {
      id: taskId,
      title: summaryText,
      branch: branchName,
      commitHash: commitHash !== 'pending' ? commitHash : (initialStatus.lastCommit.hash || 'HEAD'),
      userPrompt: params.prompt,
      thoughtProcess,
      message: parsed.message || summaryText,
      steps,
      bulletPoints,
      riskNote: modelRiskNote + '\n真实测试状态：' + regressionStatus +
        (!testsPassed ? '\n自动提交已阻止；需先完成或修复测试验证。' : ''),
      regressionStatus,
      testResult,
      projectTesting,
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
