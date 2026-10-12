import { Router, type Request, type Response } from 'express';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseDiff } from '../parser/diff.parser.js';
import { chunkFiles } from '../parser/chunker.js';
import { loadRepoConfig } from '../config/loader.js';
import { runOrchestrator } from '../orchestrator/index.js';
import { selfCritique } from '../filter/self-critique.js';
import { summaryAgent } from '../agents/summary.agent.js';
import { buildPRBody, buildInlineCommentBody } from '../reporter/markdown.reporter.js';

export const apiRouter = Router();

export interface ReviewHistoryItem {
  id: string;
  title: string;
  repo: string;
  branch: string;
  author: string;
  scopeDesc: string;
  status: 'changes_ready' | 'working' | 'needs_attention' | 'failed' | 'completed';
  timestamp: string;
  rawCount?: number;
  filteredCount?: number;
  summary?: any;
  comments?: any[];
  markdown?: string;
  rawDiff?: string;
}

// 模拟和持久化审查历史，默认预置几条记录完美匹配截图
const reviewHistory: ReviewHistoryItem[] = [
  {
    id: 'rev_local_latest',
    title: 'Review the current changes',
    repo: 'AICodeReview',
    branch: 'main',
    author: 'Cosmohuang1',
    scopeDesc: '当前工作区未提交修改 (git diff HEAD)',
    status: 'changes_ready',
    timestamp: '刚刚',
    rawCount: 14,
    filteredCount: 3,
    summary: {
      overview: '本次变更引入了 CLI 工具与 Web 审查平台支持，并优化了环境变量配置与流水线分块。',
      walkthrough: [
        { file: 'package.json', changes: '新增 CLI 入口 ai-review 与相关依赖' },
        { file: 'src/cli.ts', changes: '实现终端本地代码审查运行器' },
        { file: 'public/index.html', changes: '构建 CodeRabbit 风格 Web 控制台' }
      ],
      mermaidDiagram: 'sequenceDiagram\n  Developer->>CLI: npm run review\n  CLI->>DeepSeek: 并发 6 大 Agent 审查\n  DeepSeek-->>CLI: 返回高质量建议\n  CLI->>Markdown: 生成本地审查报告'
    },
    comments: [
      { file: 'package-lock.json', line: 0, severity: 'warning', category: 'bug', message: 'commander 升级至 15.0.0，要求 Node >=22.12.0，需确保团队开发环境兼容。', suggestion: '确认运行环境 Node 版本 >=22.12.0；或固定兼容版本。' },
      { file: 'package.json', line: 5, severity: 'warning', category: 'test', message: '新增了关键用户入口 src/cli.ts，建议补充对应命令行参数解析的单元测试。', suggestion: '新增 tests/cli.test.ts 覆盖命令解析与异常退出。' },
      { file: 'src/agents/base.ts', line: 1, severity: 'info', category: 'style', message: '模块顶层 import dotenv/config 会产生全局环境变量副作用，建议由顶层入口加载。', suggestion: '// 移除模块级副作用，在应用顶层统一加载环境变量' }
    ]
  },
  {
    id: 'rev_pr_38',
    title: 'Review pull request 38',
    repo: 'acl',
    branch: 'main',
    author: 'Cosmohuang1',
    scopeDesc: 'Pull Request #38 (YesSQL index query optimization)',
    status: 'changes_ready',
    timestamp: '3d ago',
    rawCount: 8,
    filteredCount: 2,
    summary: {
      overview: '修复了 YesSQL 索引查询多表 Join 时的隐式类型转换问题，并增加了查询超时重试机制。',
      walkthrough: [
        { file: 'src/data/query.ts', changes: '重构索引查询生成逻辑' },
        { file: 'src/data/session.ts', changes: '增加事务回滚容错' }
      ]
    },
    comments: [
      { file: 'src/data/query.ts', line: 84, severity: 'error', category: 'performance', message: '此处在循环内进行单条索引查询，容易产生 N+1 查询问题。', suggestion: 'const bulkIndexes = await queryAll(ids);\nfor (const item of items) { ... }' },
      { file: 'src/data/session.ts', line: 120, severity: 'warning', category: 'bug', message: '未在 finally 块中释放数据库连接连接池可能耗尽。', suggestion: 'finally {\n  await connection.release();\n}' }
    ]
  },
  {
    id: 'rev_pr_43',
    title: 'Review pull request #43',
    repo: 'Cosmohuang1/AICodeReview',
    branch: 'feature/auth',
    author: 'Cosmohuang1',
    scopeDesc: 'Pull Request #43',
    status: 'completed',
    timestamp: '5d ago',
    rawCount: 5,
    filteredCount: 1,
    summary: {
      overview: '用户认证鉴权拦截器升级，支持 JWT 令牌双向刷新机制。',
      walkthrough: [{ file: 'src/auth/jwt.ts', changes: '增加令牌轮换和过期拦截' }]
    },
    comments: [
      { file: 'src/auth/jwt.ts', line: 42, severity: 'warning', category: 'security', message: 'JWT 签名秘钥长度不足 32 字节，存在暴破弱点。', suggestion: 'const SECRET = process.env.JWT_SECRET_KEY || crypto.randomBytes(32);' }
    ]
  }
];

function getDiffCommand(mode = 'worktree', from?: string, to?: string): { cmd: string; desc: string } {
  if (mode === 'last') {
    return { cmd: 'git show HEAD', desc: '最近一次提交 (git show HEAD)' };
  }
  if (mode === 'branch' && from && to) {
    return { cmd: `git diff ${from}...${to}`, desc: `分支对比: ${from}...${to}` };
  }
  if (mode === 'branch' && from) {
    return { cmd: `git diff ${from}`, desc: `与 ${from} 对比` };
  }
  return { cmd: 'git diff HEAD', desc: '当前工作区未提交修改 (git diff HEAD)' };
}

apiRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    cwd: process.cwd(),
    username: 'Cosmohuang1',
    hasApiKey: !!process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  });
});

apiRouter.get('/recents', (_req: Request, res: Response) => {
  res.json(reviewHistory);
});

apiRouter.get('/review/:id', (req: Request, res: Response) => {
  const item = reviewHistory.find(r => r.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Review not found' });
  }
  res.json(item);
});

apiRouter.get('/analytics', (_req: Request, res: Response) => {
  const totalReviews = reviewHistory.length;
  let totalComments = 0;
  let errors = 0;
  let warnings = 0;

  reviewHistory.forEach(r => {
    (r.comments || []).forEach(c => {
      totalComments++;
      if (c.severity === 'error') errors++;
      if (c.severity === 'warning') warnings++;
    });
  });

  res.json({
    activeRepositories: 2,
    mergedPullRequests: { total: 3, avgPerUser: 3 },
    activeUsers: { assigned: 1, unassigned: 0 },
    chatUsage: { sessions: 8, messages: 32 },
    medianTime: { readyToMerge: '3.5m', lastCommit: '1.8m' },
    reviewerTimeSaved: `${(totalReviews * 1.2).toFixed(1)} hrs`,
    codeRabbitComments: { posted: totalComments, acceptanceRate: '92%' },
    severityCounts: { error: errors, warning: warnings, info: Math.max(0, totalComments - errors - warnings) },
  });
});

apiRouter.post('/diff', (req: Request, res: Response) => {
  const { repoPath = process.cwd(), mode = 'worktree', from, to } = req.body;
  const targetCwd = path.resolve(repoPath);

  if (!fs.existsSync(targetCwd)) {
    return res.status(400).json({ error: `指定仓库路径不存在: ${targetCwd}` });
  }

  const { cmd, desc } = getDiffCommand(mode, from, to);

  try {
    const rawDiff = execSync(cmd, { cwd: targetCwd, maxBuffer: 10 * 1024 * 1024 }).toString('utf-8');
    const parsedFiles = parseDiff(rawDiff);

    res.json({
      scopeDesc: desc,
      rawDiff,
      filesCount: parsedFiles.length,
      files: parsedFiles.map(f => ({
        filePath: f.filePath,
        language: f.language,
        hunksCount: f.hunks.length,
        isNew: f.isNew,
        isDeleted: f.isDeleted,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: `获取 Git Diff 失败: ${err.message}` });
  }
});

apiRouter.post('/review', async (req: Request, res: Response) => {
  const { repoPath = process.cwd(), mode = 'worktree', from, to, prompt = '' } = req.body;
  const targetCwd = path.resolve(repoPath);

  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: '未配置 DEEPSEEK_API_KEY，请检查 .env' });
  }

  if (!fs.existsSync(targetCwd)) {
    return res.status(400).json({ error: `指定仓库路径不存在: ${targetCwd}` });
  }

  const { cmd, desc } = getDiffCommand(mode, from, to);

  try {
    const rawDiff = execSync(cmd, { cwd: targetCwd, maxBuffer: 10 * 1024 * 1024 }).toString('utf-8');
    if (!rawDiff.trim()) {
      return res.json({
        success: true,
        scopeDesc: desc,
        hasChanges: false,
        message: '未检测到代码变更，无需审查。',
        summary: { overview: '未检测到代码变更。', walkthrough: [], mermaidDiagram: '' },
        comments: [],
        markdown: '# 代码审查报告\n\n未检测到代码变更。',
      });
    }

    // 加载配置
    let configContent: string | null = null;
    const configPath = path.join(targetCwd, '.ai-review.yml');
    if (fs.existsSync(configPath)) {
      configContent = fs.readFileSync(configPath, 'utf-8');
    }
    const config = loadRepoConfig(configContent);

    // 解析 diff
    const parsedFiles = parseDiff(rawDiff);

    // 读取上下文
    const fileContents = new Map<string, string>();
    for (const file of parsedFiles) {
      const fullPath = path.join(targetCwd, file.filePath);
      if (fs.existsSync(fullPath)) {
        try {
          fileContents.set(file.filePath, fs.readFileSync(fullPath, 'utf-8'));
        } catch {
          // ignore
        }
      }
    }

    // 过滤排除文件
    const filteredFiles = parsedFiles.filter(f =>
      !config.exclude.some(pattern => f.filePath.endsWith(pattern.replace('*', '')))
    );

    // 分块
    const chunks = chunkFiles(filteredFiles.slice(0, config.maxFilesPerReview), fileContents);

    // 6 个 Agent 并发审查
    const rawComments = await runOrchestrator(chunks, config);

    // Self-Critique 二阶降噪
    const filteredComments = await selfCritique(rawComments, chunks, config);

    // 生成 Summary
    const summary = await summaryAgent(desc, filteredFiles, config);

    // 组装 Markdown 报告
    const headerMarkdown = `# AI Code Review 报告\n> 审查范围: ${desc}\n> 生成时间: ${new Date().toLocaleString()}\n`;
    const reportMarkdown = buildPRBody(summary, headerMarkdown);
    const fullMarkdown = reportMarkdown + (filteredComments.length > 0
      ? `\n\n## 🔍 详细问题列表\n\n` + filteredComments.map(c => `### ${c.file} (行号: ${c.line})\n${buildInlineCommentBody(c)}`).join('\n\n---\n\n')
      : '\n\n**审查结论:** 代码质量良好，未发现明显缺陷或安全隐患。');

    const newReviewItem: ReviewHistoryItem = {
      id: `rev_${Date.now()}`,
      title: prompt ? `Task: ${prompt.slice(0, 30)}` : 'Review current changes',
      repo: path.basename(targetCwd) || 'AICodeReview',
      branch: 'main',
      author: 'Cosmohuang1',
      scopeDesc: desc,
      status: 'changes_ready',
      timestamp: '刚刚',
      rawCount: rawComments.length,
      filteredCount: filteredComments.length,
      summary,
      comments: filteredComments,
      markdown: fullMarkdown,
      rawDiff,
    };

    reviewHistory.unshift(newReviewItem);

    res.json({
      success: true,
      id: newReviewItem.id,
      scopeDesc: desc,
      hasChanges: true,
      rawCount: rawComments.length,
      filteredCount: filteredComments.length,
      summary,
      comments: filteredComments,
      markdown: fullMarkdown,
      rawDiff,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: `执行审查失败: ${err.message}` });
  }
});
