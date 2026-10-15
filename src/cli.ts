#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadRepoConfig } from './config/loader.js';
import { ReviewService } from './services/review.service.js';
import { registerLocalReviewCommand } from './local-review/command.js';
import { buildPRBody, buildInlineCommentBody } from './reporter/markdown.reporter.js';

const program = new Command();

program
  .name('ai-review')
  .description('对标 CodeRabbit 的本地与企业级 AI 代码审查工具 (DeepSeek 驱动)')
  .version('0.2.0');

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

      // 3. 读取被修改文件的完整内容作为上下文
      const fileContents = new Map<string, string>();
      // 先轻量探测文件，供 ReviewService 使用
      try {
        const fileMatch = rawDiff.match(/diff --git a\/(.+?) b\/(.+?)(?:\n|$)/g);
        if (fileMatch) {
          for (const m of fileMatch) {
            const parts = m.trim().split(' ');
            const filePath = parts[3]?.replace(/^b\//, '');
            if (filePath) {
              const fullPath = path.resolve(process.cwd(), filePath);
              if (fs.existsSync(fullPath)) {
                try {
                  fileContents.set(filePath, fs.readFileSync(fullPath, 'utf-8'));
                } catch {
                  // ignore
                }
              }
            }
          }
        }
      } catch {
        // ignore
      }

      console.log(chalk.cyan('🤖 正在执行统一代码审查流水线 (含确定性规约、6 专精 Agent、去重与 Self-Critique)...'));

      const result = await ReviewService.executeReview({
        rawDiff,
        fileContents,
        config,
        contextTitle: scopeDesc,
        onStep: (step, name) => {
          console.log(chalk.blue(`  [步骤 ${step}] ${name}`));
        },
        onProgress: (done, total, chunk) => {
          console.log(chalk.gray(`    [${done}/${total}] 走查 ${path.basename(chunk.file)} (${chunk.startLine}-${chunk.endLine} 行)`));
        },
      });

      const { summary, comments: filteredComments } = result;

      // 4. 控制台终端美化输出
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
          const prioBadge = c.priority === 'P0' ? chalk.bgRed.white(' P0 ') :
                            c.priority === 'P1' ? chalk.bgYellow.black(' P1 ') :
                            chalk.bgGray.white(' P2 ');
          console.log(`\n${prioBadge} ${badge} [${c.category.toUpperCase()}] ${chalk.bold.underline(c.file)} (Line: ${c.line})`);
          console.log(chalk.white(`  说明: ${c.message}`));
          if (c.suggestion) {
            console.log(chalk.green(`  建议修复:\n${c.suggestion.split('\n').map(l => '    ' + l).join('\n')}`));
          }
        }
      } else {
        console.log(chalk.bold.green('\n🎉 太棒了！本次审查未发现任何代码缺陷或安全隐患！'));
      }

      // 5. 导出 Markdown 报告
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

registerLocalReviewCommand(program);

program.parse(process.argv);
