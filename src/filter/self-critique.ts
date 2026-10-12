import { callDeepSeek, extractJsonArray } from '../agents/base.js';
import type { ReviewComment, CodeChunk } from '../agents/types.js';
import type { RepoConfig } from '../config/schema.js';

export async function selfCritique(
  comments: ReviewComment[],
  chunks: CodeChunk[],
  config: RepoConfig
): Promise<ReviewComment[]> {
  if (comments.length === 0) return [];

  const codeContext = chunks.slice(0, 3).map(c => c.fullContext).join('\n\n---\n\n');

  const prompt = `你是一位严格的代码审查质量控制员。以下是 AI 对代码变更生成的审查建议列表。
请逐条判断每条建议是否有价值，过滤掉以下低质量建议：
- 误报：代码已在上下文中处理了该问题
- 过度挑刺：纯粹个人风格偏好，无实质影响
- 不可操作：描述模糊，开发者无法据此修改
- 重复：与列表中其他建议描述同一问题

【代码上下文】:
${codeContext}

【待审核建议列表（JSON）】:
${JSON.stringify(comments, null, 2)}

输出过滤后的建议列表（JSON 数组）。保留原始所有字段，将 confidence 字段更新为你的评估分（0-1）。只输出 JSON。`;

  try {
    const raw = await callDeepSeek(prompt);
    const filtered = extractJsonArray<Partial<ReviewComment>>(raw);
    const results: ReviewComment[] = [];

    for (const item of filtered) {
      const confidence = typeof item.confidence === 'number' ? item.confidence : 0;
      if (confidence < config.selfCritiqueThreshold) {
        continue;
      }

      const original = comments.find(
        c => c.file === item.file && c.line === item.line
      );

      if (original) {
        results.push({
          ...original,
          ...item,
          file: item.file || original.file,
          line: typeof item.line === 'number' ? item.line : original.line,
          side: 'RIGHT',
          severity: (item.severity as any) || original.severity,
          category: (item.category as any) || original.category,
          message: item.message || original.message,
          suggestion: item.suggestion !== undefined ? item.suggestion : original.suggestion,
          confidence,
        });
      } else if (item.file && typeof item.line === 'number' && item.message && item.category && item.severity) {
        results.push({
          file: item.file,
          line: item.line,
          side: 'RIGHT',
          severity: item.severity,
          category: item.category,
          message: item.message,
          suggestion: item.suggestion,
          confidence,
        });
      }
    }

    return results;
  } catch {
    console.warn('[ai-review] Self-critique filter failed, returning original comments');
    return comments;
  }
}

export default selfCritique;
