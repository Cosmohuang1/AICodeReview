import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const testAgent: AgentFn = async (chunk, config) => {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const prompt = `你是一位专注于测试质量与测试覆盖率的资深质量保证工程师。请审查以下代码变更，只关注测试相关的缺失与不足：
- 新增或变更的关键业务逻辑是否缺少单元测试或集成测试覆盖
- 现有测试是否充分覆盖了新增的条件分支、异常路径或边界情况
- 测试用例断言是否有效（避免无断言或空断言）
- 测试用例是否脆弱（依赖外部不可控环境或时间）

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
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"test","message":"具体测试缺失或改进建议描述","suggestion":"推荐补充的测试用例代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'test' as const,
    }));
  } catch {
    return [];
  }
};

export default testAgent;
