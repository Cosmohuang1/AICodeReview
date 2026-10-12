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
    hasApiKey: !!process.env.DEEPSEEK_API_KEY,
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
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
  const { repoPath = process.cwd(), mode = 'worktree', from, to } = req.body;
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

    res.json({
      success: true,
      scopeDesc: desc,
      hasChanges: true,
      rawCount: rawComments.length,
      filteredCount: filteredComments.length,
      summary,
      comments: filteredComments,
      markdown: fullMarkdown,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: `执行审查失败: ${err.message}` });
  }
});
