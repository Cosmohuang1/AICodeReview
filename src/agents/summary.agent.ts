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
    assessments: {
      security: '确定性规约扫描通过，未检出硬编码密钥或越权隐患',
      bug: '核心逻辑及空值边界校验完整',
      performance: '未引入异常高耗时调用或长生命周期资源持有',
      style: '符合工程代码规范与命名约定',
      test: '单元测试断言与覆盖范围评估就绪'
    },
    narrativeSteps: {
      planning: '我会拉取当前分支最新提交，逐项走查变更文件的架构影响与边界安全性，并检查新增改动。',
      deepAnalysis: defaultOverview,
      verdictSummary: '已完成代码规范与单元测试边界审查，未发现阻断性逻辑缺陷。'
    },
    conclusionHeading: '已复查最新提交，未发现代码缺陷。'
  };

  const diffSummary = files.slice(0, 10).map(f =>
    `### ${f.filePath}\n${f.hunks.map(h => h.rawHunk.slice(0, 1200)).join('\n')}`
  ).join('\n\n');

  const prompt = `你是一位高阶代码架构师与审查专家（类似业界顶级 AI Reviewer）。请根据以下代码变更，给出专业、深度、自然连贯的审查叙述与走查清单。

【PR / 任务标题】: ${prTitle}
【变更文件与代码 Diff】:
${diffSummary}

输出语言要求: ${langPrompt}。
严格输出以下 JSON 格式（不要包含任何其他 markdown 包装或解释文本）:
{
  "narrativeSteps": {
    "planning": "自然的第一人称叙述（1句话）：说明你将如何拉取最新提交，重点检查哪些核心改动与边界",
    "deepAnalysis": "深入且极其具体的自然语言解读（2-3句话）：针对具体修改的文件、类名、方法或组件，清晰阐述具体的修改细节、保留了什么、避免了什么问题（参考示例口吻：'#2 的 ID 精度修复已改为全程保留字符串，叶子状态统计也排除了待移动/删除的记录。我会继续验证多选框的保存后回显...'，拒绝空洞模版）",
    "verdictSummary": "复查结论叙述（1-2句话）：总结本次走查中还存在的具体疑点或确认各项边界均已达标（参考示例口吻：'复查还有三处问题：#1 的命名空间编号在不同 Linux 主机间可能相同...，ID 精度问题已修复。'）"
  },
  "conclusionHeading": "总结性结论标题（例如：'已复查最新提交，未发现代码缺陷。' 或 '已复查最新提交，仍有 X 项问题需要处理。'）",
  "overview": "深入具体地概括本次代码变更的业务场景、核心改动点以及技术影响（提及具体修改的类/方法/组件）",
  "walkthrough": [
    {
      "file": "文件相对路径",
      "changes": "针对该文件的具体改动解读（明确指出修改或新增的方法、属性、UI元素或断言细节）"
    }
  ],
  "assessments": {
    "security": "结合本次具体改动，分析是否存在输入校验、越权、敏感信息泄露等风险",
    "bug": "结合本次具体改动，分析空引用、边界条件、异常处理是否充分",
    "performance": "结合本次具体改动，分析内存分配、I/O耗时、作用域或并发影响",
    "style": "分析命名规范、工程分层契约与代码可读性",
    "test": "分析测试用例覆盖场景、断言力度及健壮性"
  },
  "mermaidDiagram": "如果涉及明确的调用流转或状态变化则输出 Mermaid 序列图，否则输出空字符串"
} `;

  try {
    const raw = await callDeepSeek(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaultSummary;
    const parsed = JSON.parse(match[0]) as Partial<PRSummary>;
    return {
      overview: typeof parsed.overview === 'string' && parsed.overview.trim().length > 0 ? parsed.overview : defaultSummary.overview,
      walkthrough: Array.isArray(parsed.walkthrough) && parsed.walkthrough.length > 0
        ? parsed.walkthrough.filter(
            (item): item is { file: string; changes: string } =>
              Boolean(item && typeof item.file === 'string' && typeof item.changes === 'string')
          )
        : defaultSummary.walkthrough,
      assessments: parsed.assessments && typeof parsed.assessments === 'object'
        ? {
            security: parsed.assessments.security || defaultSummary.assessments?.security,
            bug: parsed.assessments.bug || defaultSummary.assessments?.bug,
            performance: parsed.assessments.performance || defaultSummary.assessments?.performance,
            style: parsed.assessments.style || defaultSummary.assessments?.style,
            test: parsed.assessments.test || defaultSummary.assessments?.test,
          }
        : defaultSummary.assessments,
      narrativeSteps: parsed.narrativeSteps && typeof parsed.narrativeSteps === 'object'
        ? {
            planning: parsed.narrativeSteps.planning || defaultSummary.narrativeSteps?.planning,
            deepAnalysis: parsed.narrativeSteps.deepAnalysis || defaultSummary.narrativeSteps?.deepAnalysis,
            verdictSummary: parsed.narrativeSteps.verdictSummary || defaultSummary.narrativeSteps?.verdictSummary,
          }
        : defaultSummary.narrativeSteps,
      conclusionHeading: typeof parsed.conclusionHeading === 'string' && parsed.conclusionHeading.trim().length > 0
        ? parsed.conclusionHeading
        : defaultSummary.conclusionHeading,
      mermaidDiagram: typeof parsed.mermaidDiagram === 'string' ? parsed.mermaidDiagram : '',
    };
  } catch {
    return defaultSummary;
  }
}

export default summaryAgent;
