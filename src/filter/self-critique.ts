import { callDeepSeek, extractJsonArray } from '../agents/base.js';
import type { ReviewComment, CodeChunk, Severity, Category } from '../agents/types.js';
import type { RepoConfig } from '../config/schema.js';

export async function selfCritique(
  comments: ReviewComment[],
  chunks: CodeChunk[],
  config: RepoConfig
): Promise<ReviewComment[]> {
  if (comments.length === 0) return [];

  // 1. 分离确定性规则意见（置信度 1.0）与概率性大模型意见
  // 确定性意见（如硬编码密钥、SQL 注入）已由规则引擎 100% 确认，直接保留，避免大模型误杀与 Token 浪费
  const deterministicComments = comments.filter(c => c.confidence >= 1.0);
  const probabilisticComments = comments.filter(c => c.confidence < 1.0);

  if (probabilisticComments.length === 0) {
    return deterministicComments;
  }

  // 2. 针对概率性意见，精准匹配对应文件的 Code Chunks 上下文
  const targetFiles = new Set(probabilisticComments.map(c => c.file));
  let relevantChunks = chunks.filter(c => targetFiles.has(c.file));
  if (relevantChunks.length === 0) {
    relevantChunks = chunks.slice(0, 3);
  } else if (relevantChunks.length > 5) {
    relevantChunks = relevantChunks.slice(0, 5);
  }

  const codeContext = relevantChunks.map(c => c.fullContext).join('\n\n---\n\n');

  const prompt = `你是一位严格的代码审查质量控制员。以下是 AI 对代码变更生成的审查建议列表。
请逐条判断每条建议是否有价值，过滤掉以下低质量建议：
- 误报：代码已在上下文中处理了该问题
- 过度挑刺：纯粹个人风格偏好，无实质影响
- 不可操作：描述模糊，开发者无法据此修改
- 重复：与列表中其他建议描述同一问题

【代码上下文】:
${codeContext}

【待审核建议列表（JSON）】:
${JSON.stringify(probabilisticComments, null, 2)}

输出过滤后的建议列表（JSON 数组）。保留原始所有字段，将 confidence 字段更新为你的评估分（0-1）。只输出 JSON。`;

  try {
    const raw = await callDeepSeek(prompt);
    const filtered = extractJsonArray<Partial<ReviewComment>>(raw);
    const results: ReviewComment[] = [...deterministicComments];

    const validSeverities = new Set<Severity>(['error', 'warning', 'info']);
    const validCategories = new Set<Category>(['bug', 'security', 'performance', 'style', 'test', 'custom']);

    for (const item of filtered) {
      const confidence = typeof item.confidence === 'number' ? item.confidence : 0;
      if (confidence < config.selfCritiqueThreshold) {
        continue;
      }

      const original = probabilisticComments.find(
        c => c.file === item.file && c.line === item.line
      );

      const resolvedSeverity: Severity =
        item.severity && validSeverities.has(item.severity as Severity)
          ? (item.severity as Severity)
          : original?.severity ?? 'warning';

      const resolvedCategory: Category =
        item.category && validCategories.has(item.category as Category)
          ? (item.category as Category)
          : original?.category ?? 'bug';

      if (original) {
        results.push({
          ...original,
          ...item,
          file: item.file || original.file,
          line: typeof item.line === 'number' ? item.line : original.line,
          side: 'RIGHT',
          severity: resolvedSeverity,
          category: resolvedCategory,
          message: item.message || original.message,
          suggestion: item.suggestion !== undefined ? item.suggestion : original.suggestion,
          confidence,
        });
      } else if (item.file && typeof item.line === 'number' && item.message) {
        results.push({
          file: item.file,
          line: item.line,
          side: 'RIGHT',
          severity: resolvedSeverity,
          category: resolvedCategory,
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
