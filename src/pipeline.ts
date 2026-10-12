import { fetchPRDiff, type PRContext } from './github/diff.fetcher.js';
import { parseDiff } from './parser/diff.parser.js';
import { chunkFiles } from './parser/chunker.js';
import { loadRepoConfig } from './config/loader.js';
import { runOrchestrator } from './orchestrator/index.js';
import { selfCritique } from './filter/self-critique.js';
import { summaryAgent } from './agents/summary.agent.js';
import { publishReview } from './github/publisher.js';
import type { PRSummary } from './agents/types.js';

export function isFileExcluded(filePath: string, excludePatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  return excludePatterns.some(pattern => {
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Check exact match
    if (normalizedPath === normalizedPattern) {
      return true;
    }

    // Suffix match e.g. *.min.js, *.snap, package-lock.json
    if (normalizedPattern.startsWith('*')) {
      const suffix = normalizedPattern.replace(/^\*+/, '');
      if (suffix && normalizedPath.endsWith(suffix)) {
        return true;
      }
    } else if (normalizedPath.endsWith('/' + normalizedPattern)) {
      return true;
    }

    // Directory pattern e.g. dist/** or coverage/** or dist/*
    if (normalizedPattern.includes('**') || normalizedPattern.endsWith('/*')) {
      const dirPrefix = normalizedPattern.replace(/\/?\*+$/, '');
      if (
        normalizedPath === dirPrefix ||
        normalizedPath.startsWith(dirPrefix + '/') ||
        normalizedPath.includes('/' + dirPrefix + '/')
      ) {
        return true;
      }
    }

    // Simple wildcards or regex conversion
    try {
      const regexStr =
        '^' +
        normalizedPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/(?<!\.)\*/g, '[^/]*') +
        '$';
      if (new RegExp(regexStr).test(normalizedPath)) {
        return true;
      }
    } catch {
      // fallback
    }

    const cleanPattern = normalizedPattern.replace(/\*/g, '');
    if (cleanPattern && (normalizedPath.endsWith(cleanPattern) || normalizedPath.startsWith(cleanPattern))) {
      return true;
    }

    return false;
  });
}

export async function runReviewPipeline(ctx: PRContext): Promise<void> {
  console.log(`[ai-review] Starting review for PR #${ctx.prNumber} in ${ctx.owner}/${ctx.repo}`);

  // 1. 获取 diff + 文件内容 + PR 原始描述
  const { rawDiff, fileContents, originalBody } = await fetchPRDiff(ctx);

  // 2. 从仓库读取 .ai-review.yml / .ai-review.yaml（若不存在则使用默认配置）
  const configYaml =
    fileContents.get('.ai-review.yml') ??
    fileContents.get('.ai-review.yaml') ??
    null;
  const config = loadRepoConfig(configYaml);

  // 3. 解析 diff
  const parsedFiles = parseDiff(rawDiff);

  // 4. 过滤排除文件
  const filteredFiles = parsedFiles.filter(f => !isFileExcluded(f.filePath, config.exclude));

  // 5. 按 maxFilesPerReview 限制
  const limitedFiles = filteredFiles.slice(0, config.maxFilesPerReview);
  if (filteredFiles.length > config.maxFilesPerReview) {
    console.warn(`[ai-review] 文件数超限，只审查前 ${config.maxFilesPerReview} 个文件`);
  }

  // 6. 语法感知分块
  const chunks = chunkFiles(limitedFiles, fileContents);

  // 7. 并发 6 Agent 审查
  const rawComments = await runOrchestrator(chunks, config);

  // 8. Self-Critique 二阶过滤
  const filteredComments = await selfCritique(rawComments, chunks, config);

  // 9. 生成 PR Summary（容错保护）
  const [summaryResult] = await Promise.allSettled([
    summaryAgent(ctx.prTitle, limitedFiles, config),
  ]);
  const prSummary: PRSummary =
    summaryResult.status === 'fulfilled'
      ? summaryResult.value
      : {
          overview: config.language === 'en' ? 'AI Review completed.' : 'AI Review 完成。',
          walkthrough: [],
          mermaidDiagram: '',
        };

  // 10. 发布到 GitHub
  await publishReview(ctx, prSummary, originalBody, filteredComments);

  console.log(`[ai-review] Review complete: ${filteredComments.length} comments published`);
}

export default runReviewPipeline;
