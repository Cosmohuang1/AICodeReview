import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const bugAgent: AgentFn = async (chunk, config) => {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const prompt = `你是一位专注于代码 Bug 检测的资深工程师。请审查以下代码变更，只关注：
- 空指针 / undefined / null 访问风险
- 数组越界、空数组、空字符串边界条件
- 异常未捕获或错误处理缺失
- 并发竞态条件
- 逻辑错误（条件判断反向、操作符优先级错误、变量遮蔽）

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
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"bug","message":"具体问题描述","suggestion":"修复后的完整代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'bug' as const,
    }));
  } catch {
    return [];
  }
};

export default bugAgent;
