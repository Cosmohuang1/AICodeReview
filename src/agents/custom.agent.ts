import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const customAgent: AgentFn = async (chunk, config) => {
  if (!config.rules || config.rules.length === 0) {
    return [];
  }

  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const rulesList = config.rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n');

  const prompt = `你是一位专注于企业自定义编码规范与架构原则审查的资深工程师。请审查以下代码变更，严格比对仓库自定义规则：

【自定义编码规范与规则】:
${rulesList}

请只关注代码变更是否违反了上述自定义规则。

【文件】: ${chunk.file} (${chunk.language})
【代码上下文】:
\`\`\`${chunk.language}
${chunk.fullContext}
\`\`\`

【变更内容（diff）】:
\`\`\`diff
${chunk.diffContent}
\`\`\`

输出语言要求: ${langPrompt}。
严格输出 JSON 数组（不要任何其他文字）:
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"custom","message":"具体违反哪条规则及说明","suggestion":"符合规范的修复代码（可选）","confidence":0.0到1.0}]

如无违反自定义规则则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'custom' as const,
    }));
  } catch {
    return [];
  }
};

export default customAgent;
