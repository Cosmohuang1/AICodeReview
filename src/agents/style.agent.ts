import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const styleAgent: AgentFn = async (chunk, config) => {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const prompt = `你是一位专注于代码规范与可维护性的资深工程师。请审查以下代码变更，只关注代码风格、规范与设计异味：
- 变量、函数、类命名不清晰或不符合规范
- 关键业务逻辑缺少必要注释或文档
- 函数或方法过长、嵌套过深、圈复杂度过高（建议拆分）
- 重复代码或可抽象逻辑（违反 DRY 原则）
- 魔法数字、硬编码宿主机绝对文件路径（如 @"D:\..."、"C:\..." 等）或硬编码数据库连接字符串未抽取为配置项
- TypeScript 类型不规范（滥用 any、类型断言不安全）

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
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"style","message":"具体代码风格规范问题描述","suggestion":"重构规范后的完整代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'style' as const,
    }));
  } catch {
    return [];
  }
};

export default styleAgent;
