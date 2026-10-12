import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const performanceAgent: AgentFn = async (chunk, config) => {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const prompt = `你是一位专注于性能优化的资深系统架构师。请审查以下代码变更，只关注性能瓶颈与效率问题：
- N+1 查询与低效数据库/网络请求
- 循环内进行同步 I/O、重复查询或无并发的 await
- 内存泄漏风险（未清理的监听器、定时器、全局缓存膨胀）
- 不必要的重复计算与缺少缓存/记忆化
- 大对象的频繁深拷贝、无序序列化与反序列化开销
- 高时间复杂度操作（如嵌套循环查找本可用 Map/Set 优化为 O(1)）

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
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"performance","message":"具体性能问题描述","suggestion":"性能优化后的完整代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'performance' as const,
    }));
  } catch {
    return [];
  }
};

export default performanceAgent;
