#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseDiff } from './parser/diff.parser.js';
import { chunkFiles } from './parser/chunker.js';
import { loadRepoConfig } from './config/loader.js';
import { runOrchestrator } from './orchestrator/index.js';
import { selfCritique } from './filter/self-critique.js';
import { summaryAgent } from './agents/summary.agent.js';
import { buildPRBody, buildInlineCommentBody } from './reporter/markdown.reporter.js';
import type { CodeChunk, ReviewComment } from './agents/types.js';

const program = new Command();

program
  .name('ai-review')
  .description('对标 CodeRabbit 的本地与企业级 AI 代码审查工具 (DeepSeek 驱动)')
  .version('0.1.0');

program
  .command('diff', { isDefault: true })
  .description('审查本地 Git 修改 (支持未提交变更、分支对比或特定 commit)')
  .option('-f, --from <commit/branch>', '起始 commit 或分支 (例如: main, HEAD~1)')
  .option('-t, --to <commit/branch>', '目标 commit 或分支 (默认: 工作区未提交变更)')
  .option('-o, --output <file>', '输出 Markdown 报告路径', 'review-report.md')
  .option('-c, --config <file>', '自定义配置文件路径', '.ai-review.yml')
  .option('--last', '审查最近一次 commit (git show HEAD)')
  .action(async (options) => {
    try {
      console.log(chalk.bold.cyan('\n🔍 [ai-review] 正在准备分析本地 Git 变更...'));

      if (!process.env.DEEPSEEK_API_KEY) {
        console.error(chalk.red('\n❌ 未检测到 DEEPSEEK_API_KEY，请在 .env 文件中设置。'));
        process.exit(1);
      }

      // 1. 获取 Git Diff
      let diffCmd = 'git diff HEAD';
      let scopeDesc = '当前工作区未提交修改 (git diff HEAD)';

      if (options.last) {
        diffCmd = 'git show HEAD';
        scopeDesc = '最近一次 commit (git show HEAD)';
      } else if (options.from && options.to) {
        diffCmd = `git diff ${options.from}...${options.to}`;
        scopeDesc = `分支/版本对比: ${options.from} ... ${options.to}`;
      } else if (options.from) {
        diffCmd = `git diff ${options.from}`;
        scopeDesc = `与 ${options.from} 对比 (git diff ${options.from})`;
      }

      let rawDiff = '';
      try {
        rawDiff = execSync(diffCmd, { maxBuffer: 10 * 1024 * 1024 }).toString('utf-8');
      } catch (err: any) {
        console.error(chalk.red(`\n❌ 执行 git diff 失败: ${err.message}`));
        process.exit(1);
      }

      if (!rawDiff.trim()) {
        console.log(chalk.yellow(`\nℹ️ [${scopeDesc}] 未检测到任何代码变更，无需审查。`));
        return;
      }

      // 2. 加载仓库配置
      let configContent: string | null = null;
      const configPath = path.resolve(process.cwd(), options.config);
      if (fs.existsSync(configPath)) {
        configContent = fs.readFileSync(configPath, 'utf-8');
        console.log(chalk.gray(`⚙️  已加载配置文件: ${options.config}`));
      }
      const config = loadRepoConfig(configContent);

      // 3. 解析 Diff
      const parsedFiles = parseDiff(rawDiff);
      console.log(chalk.gray(`📁 变更文件数: ${parsedFiles.length} 个`));

      // 4. 读取被修改文件的完整内容作为上下文
      const fileContents = new Map<string, string>();
      for (const file of parsedFiles) {
        const fullPath = path.resolve(process.cwd(), file.filePath);
        if (fs.existsSync(fullPath)) {
          try {
            fileContents.set(file.filePath, fs.readFileSync(fullPath, 'utf-8'));
          } catch {
            // ignore
          }
        }
      }

      // 5. 过滤排除文件
      const filteredFiles = parsedFiles.filter(f =>
        !config.exclude.some(pattern => f.filePath.endsWith(pattern.replace('*', '')))
      );

      // 6. AST/行号切块
      const chunks = chunkFiles(filteredFiles.slice(0, config.maxFilesPerReview), fileContents);
      console.log(chalk.blue(`🧩 生成代码语法块: ${chunks.length} 个`));

      // 7. 并发调用 6 大专项 Agent
      console.log(chalk.cyan('🤖 正在并发执行六大专项 Agent 审查 (Bug, Security, Perf, Style, Test, Custom)...'));
      const rawComments = await runOrchestrator(chunks, config);
      console.log(chalk.gray(`📊 初筛发现潜在建议: ${rawComments.length} 条`));

      // 8. Self-Critique 二阶反思过滤（消灭误报）
      console.log(chalk.cyan('🛡️  正在执行 Self-Critique 二阶反思降噪过滤器...'));
      const filteredComments = await selfCritique(rawComments, chunks, config);
      console.log(chalk.green(`✨ 过滤后高信噪比建议: ${filteredComments.length} 条`));

      // 9. 生成 PR 概述和架构图
      console.log(chalk.cyan('📝 正在生成变更摘要与 Mermaid 图...'));
      const summary = await summaryAgent(scopeDesc, filteredFiles, config);

      // 10. 控制台终端美化输出
      console.log(chalk.bold.magenta('\n=================== 📋 变更摘要 ==================='));
      console.log(chalk.white(summary.overview));
      if (summary.walkthrough.length > 0) {
        console.log(chalk.bold.yellow('\n文件变更列表:'));
        for (const item of summary.walkthrough) {
          console.log(`  • ${chalk.bold(item.file)}: ${item.changes}`);
        }
      }

      if (filteredComments.length > 0) {
        console.log(chalk.bold.red(`\n=================== 🔍 详细审查建议 (${filteredComments.length}) ===================`));
        for (const c of filteredComments) {
          const badge = c.severity === 'error' ? chalk.bgRed.white(' ERROR ') :
                        c.severity === 'warning' ? chalk.bgYellow.black(' WARN ') :
                        chalk.bgBlue.white(' INFO ');
          console.log(`\n${badge} [${c.category.toUpperCase()}] ${chalk.bold.underline(c.file)} (Line: ${c.line})`);
          console.log(chalk.white(`  说明: ${c.message}`));
          if (c.suggestion) {
            console.log(chalk.green(`  建议修复:\n${c.suggestion.split('\n').map(l => '    ' + l).join('\n')}`));
          }
        }
      } else {
        console.log(chalk.bold.green('\n🎉 太棒了！本次审查未发现任何代码缺陷或安全隐患！'));
      }

      // 11. 导出 Markdown 报告
      const reportMarkdown = buildPRBody(summary, `# 本地代码审查报告\n> 审查范围: ${scopeDesc}\n> 生成时间: ${new Date().toLocaleString()}\n`);
      const fullReport = reportMarkdown + (filteredComments.length > 0
        ? `\n\n## 🔍 详细问题列表\n\n` + filteredComments.map(c => `### ${c.file} (行号: ${c.line})\n${buildInlineCommentBody(c)}`).join('\n\n---\n\n')
        : '\n\n**审查结论:** 代码质量良好，未发现问题。');

      const outputPath = path.resolve(process.cwd(), options.output);
      fs.writeFileSync(outputPath, fullReport, 'utf-8');
      console.log(chalk.bold.green(`\n📄 完整审查报告已生成: ${chalk.underline(outputPath)}\n`));

    } catch (err: any) {
      console.error(chalk.red(`\n❌ Review 执行异常: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
