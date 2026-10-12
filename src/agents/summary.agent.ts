import { callDeepSeek } from './base.js';
import type { PRSummary } from './types.js';
import type { ParsedFile } from '../parser/diff.parser.js';
import type { RepoConfig } from '../config/schema.js';

export async function summaryAgent(
  prTitle: string,
  files: ParsedFile[],
  config: RepoConfig
): Promise<PRSummary> {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const defaultOverview =
    config.language === 'en'
      ? 'This PR contains code changes, see walkthrough below.'
      : '本次 PR 包含代码变更，详见下方变更清单。';
  const defaultChanges = config.language === 'en' ? 'Code changes' : '代码变更';

  const defaultSummary: PRSummary = {
    overview: defaultOverview,
    walkthrough: files.map(f => ({ file: f.filePath, changes: defaultChanges })),
    mermaidDiagram: '',
  };

  const diffSummary = files.slice(0, 10).map(f =>
    `### ${f.filePath}\n${f.hunks.map(h => h.rawHunk.slice(0, 300)).join('\n')}`
  ).join('\n\n');

  const prompt = `你是一位技术文档专家。请根据以下 PR 代码变更，生成简洁的 PR 审查摘要。

【PR 标题】: ${prTitle}
【变更文件和 diff（前10个文件）】:
${diffSummary}

输出语言要求: ${langPrompt}。
严格输出以下 JSON 格式（只输出 JSON，不要任何其他内容）:
{
  "overview": "1-3 句话概述 PR 目的和主要改动",
  "walkthrough": [{"file": "文件路径", "changes": "该文件变更的一句话描述"}],
  "mermaidDiagram": "如果涉及明显的函数调用链或状态流转则生成 Mermaid sequenceDiagram，否则输出空字符串"
}`;

  try {
    const raw = await callDeepSeek(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaultSummary;
    const parsed = JSON.parse(match[0]) as Partial<PRSummary>;
    return {
      overview: typeof parsed.overview === 'string' ? parsed.overview : defaultSummary.overview,
      walkthrough: Array.isArray(parsed.walkthrough)
        ? parsed.walkthrough.filter(
            (item): item is { file: string; changes: string } =>
              Boolean(item && typeof item.file === 'string' && typeof item.changes === 'string')
          )
        : defaultSummary.walkthrough,
      mermaidDiagram: typeof parsed.mermaidDiagram === 'string' ? parsed.mermaidDiagram : '',
    };
  } catch {
    return defaultSummary;
  }
}

export default summaryAgent;
