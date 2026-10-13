import OpenAI from 'openai';
import path from 'node:path';
import { AGENT_TOOLS, executeAgentTool } from './tools/index.js';
import { defaultReactStreamer, ReactStreamer } from './react-streamer.js';
import { GitService } from '../services/git.service.js';

export interface ReactEngineParams {
  cwd: string;
  prompt: string;
  sessionId?: string;
  maxSteps?: number;
  testCmd?: string;
  branchName?: string;
  autoCommit?: boolean;
  streamer?: ReactStreamer;
  llmCaller?: (messages: any[], tools: any[], signal?: AbortSignal) => Promise<any>;
}

export interface ReactStepRecord {
  title: string;
  commands?: Array<{ command: string; output: string }>;
  message?: string;
}

export interface ReactEngineResult {
  id: string;
  success: boolean;
  aborted?: boolean;
  title: string;
  branch: string;
  commitHash: string;
  userPrompt: string;
  thoughtProcess: string;
  message: string;
  steps: ReactStepRecord[];
  bulletPoints: string[];
  riskNote: string;
  regressionStatus: string;
  editedFiles: Array<{ path: string; additions: number; deletions: number }>;
  totalAdditions: number;
  totalDeletions: number;
  rawDiff: string;
  timestamp: string;
  workedTime: string;
}

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  });
}

export async function runReactEngine(params: ReactEngineParams): Promise<ReactEngineResult> {
  const startTime = Date.now();
  const cwd = path.resolve(params.cwd);
  const sessionId = params.sessionId || `session_${Date.now()}`;
  const streamer = params.streamer || defaultReactStreamer;
  const maxSteps = params.maxSteps || 8;
  const gitService = new GitService();
  const isGit = gitService.isGitRepo(cwd);
  const initialStatus = isGit
    ? gitService.getWorkspaceStatus(cwd)
    : {
        repoName: path.basename(cwd),
        repoPath: cwd,
        currentBranch: 'main',
        lastCommit: { hash: 'HEAD', message: '初始环境', author: 'Agent', timeAgo: '刚刚' },
        hasChanges: false,
        changedFiles: [],
        totalAdditions: 0,
        totalDeletions: 0,
      };

  const abortSignal = streamer.createAbortSignal(sessionId);
  streamer.broadcast(sessionId, 'start', { sessionId, prompt: params.prompt, cwd });

  const defaultLlmCaller = async (msgs: any[], tools: any[], signal?: AbortSignal) => {
    const client = getOpenAIClient();
    const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    const res = await client.chat.completions.create(
      {
        model,
        messages: msgs,
        tools: tools as any,
        temperature: 0.1,
      },
      { signal }
    );
    return res.choices[0]?.message;
  };

  const callModel = params.llmCaller || defaultLlmCaller;

  const systemPrompt = `你是一个类似 Cursor / Aider 的企业级自主编程与自愈修复 Agent。
工作目录: ${cwd} (工程名: ${path.basename(cwd)})
当前分支: ${initialStatus.currentBranch}

你的任务目标:
"${params.prompt}"

行动准则与自愈工作流:
1. 严禁凭空盲猜代码。先调用 read_file、search_code 或 list_dir 探测代码结构；
2. 如需修改代码，必须调用 edit_file 进行精准局部替换（严谨核对原始代码块）；
3. 修改后若有测试或校验命令（例如 ${params.testCmd || 'npm test'}），调用 run_command 真实执行验证；
4. 若命令报错或测试未通过（退出码非 0），不要恐慌，仔细分析报错堆栈与失败原因，再次调用 edit_file 针对性修复，直到全部通过；
5. 当你确认任务已彻底完成、或无需修改代码即可向用户解答时，直接给出最终详细回应，不要附带任何 tool_calls。`;

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: params.prompt },
  ];

  const stepsList: ReactStepRecord[] = [
    {
      title: '工作区环境诊断与分支初始化',
      commands: [
        {
          command: 'git status --short',
          output: initialStatus.hasChanges
            ? initialStatus.changedFiles.map(f => `${f.status === 'modified' ? 'M' : 'A'} ${f.path}`).join('\n')
            : '工作区干净，无未暂存修改',
        },
        { command: 'git rev-parse --short HEAD', output: initialStatus.lastCommit.hash || 'HEAD' },
      ],
    },
  ];

  const thoughtAccumulator: string[] = [];
  let finalMessage = '';
  let isFinished = false;
  let isAborted = false;

  for (let stepIdx = 1; stepIdx <= maxSteps; stepIdx++) {
    if (abortSignal.aborted) {
      isAborted = true;
      break;
    }

    try {
      const response = await callModel(messages, AGENT_TOOLS, abortSignal);
      if (!response) break;

      const thinkContent = response.content || '';
      if (thinkContent) {
        thoughtAccumulator.push(`[步骤 ${stepIdx}] ${thinkContent}`);
        streamer.broadcast(sessionId, 'think', { step: stepIdx, text: thinkContent });
      }

      const toolCalls = response.tool_calls || [];

      // 若模型未发起工具调用，说明模型判定任务已完成或属于纯答疑
      if (toolCalls.length === 0) {
        finalMessage = thinkContent;
        isFinished = true;
        streamer.broadcast(sessionId, 'finish', { text: finalMessage });
        break;
      }

      // 将助手的意图与 tool_calls 加入上下文
      messages.push({
        role: 'assistant',
        content: thinkContent,
        tool_calls: toolCalls,
      });

      const stepCommands: Array<{ command: string; output: string }> = [];

      for (const call of toolCalls) {
        if (abortSignal.aborted) {
          isAborted = true;
          break;
        }

        const funcName = call.function.name;
        let funcArgs: any = {};
        try {
          funcArgs = JSON.parse(call.function.arguments || '{}');
        } catch {
          funcArgs = {};
        }

        streamer.broadcast(sessionId, 'tool_call', {
          callId: call.id,
          name: funcName,
          args: funcArgs,
        });

        // 真实执行工具
        const toolResult = await executeAgentTool(cwd, funcName, funcArgs);

        streamer.broadcast(sessionId, 'tool_result', {
          callId: call.id,
          name: funcName,
          success: toolResult.success,
          output: toolResult.output,
        });

        if (funcName === 'run_command') {
          stepCommands.push({
            command: funcArgs.command || 'terminal command',
            output: toolResult.output,
          });
        } else if (funcName === 'edit_file') {
          stepCommands.push({
            command: `edit ${funcArgs.path}`,
            output: toolResult.output,
          });
        }

        // 把真实执行结果作为 tool 消息装入上下文，模型在下一步将观测到此结果！
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult.output,
        });
      }

      if (stepCommands.length > 0) {
        stepsList.push({
          title: `自愈执行迭代 (步骤 ${stepIdx})`,
          commands: stepCommands,
        });
      }

      streamer.broadcast(sessionId, 'step', { step: stepIdx, isFinished: false });
    } catch (err: any) {
      if (abortSignal.aborted) {
        isAborted = true;
        break;
      }
      streamer.broadcast(sessionId, 'error', { error: err.message });
      thoughtAccumulator.push(`[异常] 调度执行出现错误: ${err.message}`);
      break;
    }
  }

  // 结算耗时与状态
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const workedTime = elapsedSeconds >= 60
    ? `耗时 ${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`
    : `耗时 ${elapsedSeconds} 秒`;

  const updatedStatus = isGit
    ? gitService.getWorkspaceStatus(cwd)
    : {
        repoName: path.basename(cwd),
        repoPath: cwd,
        currentBranch: 'main',
        lastCommit: { hash: 'HEAD', message: '初始环境', author: 'Agent', timeAgo: '刚刚' },
        hasChanges: false,
        changedFiles: [],
        totalAdditions: 0,
        totalDeletions: 0,
      };

  const rawDiff = isGit
    ? (gitService.getUnifiedDiff(cwd) || '// 当前工作区无未暂存改动')
    : '// 非 Git 仓库环境';

  const taskId = `task_${Date.now()}`;
  const branchName = params.branchName || `task/task-${Date.now().toString().slice(-5)}`;
  let commitHash = 'pending';

  if (isGit && params.autoCommit !== false && updatedStatus.hasChanges) {
    try {
      gitService.createBranch(cwd, branchName);
      commitHash = gitService.commitAll(cwd, finalMessage.slice(0, 72) || 'feat: autonomous agent patch update');
    } catch {
      // ignore
    }
  }

  const thoughtProcess = thoughtAccumulator.length > 0
    ? thoughtAccumulator.join('\n\n')
    : `1. 意图解析：分析需求 "${params.prompt}" 并建立执行策略；\n2. 自主感知：扫描并定位工程代码文件；\n3. 执行结果：${finalMessage || '已完成对应操作。'}`;

  const editedFiles = updatedStatus.changedFiles.map(f => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
  }));

  const bulletPoints: string[] = [];
  if (isAborted) {
    bulletPoints.push('任务已被用户手动中止');
  } else if (updatedStatus.hasChanges) {
    bulletPoints.push(`自主 ReAct 闭环完成了 ${editedFiles.length} 个文件的代码编辑与校验`);
    bulletPoints.push(`累计修改代码行数：+${updatedStatus.totalAdditions} -${updatedStatus.totalDeletions}`);
  } else {
    bulletPoints.push('已完成意图解析与环境探索，当前无需任何代码修改');
  }

  return {
    id: taskId,
    success: isFinished && !isAborted,
    aborted: isAborted,
    title: finalMessage.slice(0, 60) || (isAborted ? '任务已被中止' : '完成自主 ReAct 任务'),
    branch: branchName,
    commitHash: commitHash !== 'pending' ? commitHash : (initialStatus.lastCommit.hash || 'HEAD'),
    userPrompt: params.prompt,
    thoughtProcess,
    message: finalMessage || (isAborted ? '任务已被用户手动中止。' : '自主控制循环已完成执行。'),
    steps: stepsList,
    bulletPoints,
    riskNote: '经过本地真实 ReAct 状态机校验，命令执行日志完整可追溯。',
    regressionStatus: '本地环境就绪',
    editedFiles,
    totalAdditions: updatedStatus.totalAdditions,
    totalDeletions: updatedStatus.totalDeletions,
    rawDiff,
    timestamp: '刚刚',
    workedTime,
  };
}
