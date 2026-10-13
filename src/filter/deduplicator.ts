import type { ReviewComment, Severity } from '../agents/types.js';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function areCommentsRedundant(c1: ReviewComment, c2: ReviewComment): boolean {
  if (c1.file !== c2.file) return false;

  const lineDiff = Math.abs(c1.line - c2.line);

  // 同一行：直接视为针对同一处代码的候选合并项
  if (lineDiff === 0) {
    return true;
  }

  // 相邻 1 行内：如果类别相同或核心描述高度相似，合并为一条
  if (lineDiff <= 1) {
    if (c1.category === c2.category) {
      return true;
    }
    const norm1 = normalizeText(c1.message);
    const norm2 = normalizeText(c2.message);
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      return true;
    }
  }

  return false;
}

function mergeTwoComments(c1: ReviewComment, c2: ReviewComment): ReviewComment {
  const rank1 = SEVERITY_WEIGHT[c1.severity] ?? 1;
  const rank2 = SEVERITY_WEIGHT[c2.severity] ?? 1;

  const primary = rank1 >= rank2 ? c1 : c2;
  const secondary = rank1 >= rank2 ? c2 : c1;

  // 跨 Agent 共识加权：若多个 Agent 对同一行产生共鸣，提升置信度
  const boostedConfidence = Math.min(
    1.0,
    Number((Math.max(c1.confidence, c2.confidence) + 0.05).toFixed(2))
  );

  return {
    ...primary,
    confidence: boostedConfidence,
    suggestion: primary.suggestion || secondary.suggestion,
    // 如果次要意见有补充细节且主要意见很短，保留主要意见
    message: primary.message,
    line: Math.min(c1.line, c2.line),
  };
}

/**
 * 跨 Agent 审查意见智能去重与聚合器
 * 消除多 Agent 对同一行/相邻行重复吐槽，融合置信度并保留最优 Suggestion
 */
export function deduplicateComments(comments: ReviewComment[]): ReviewComment[] {
  if (comments.length <= 1) {
    return [...comments];
  }

  // 先按文件与行号初排序
  const sorted = [...comments].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return (SEVERITY_WEIGHT[b.severity] ?? 1) - (SEVERITY_WEIGHT[a.severity] ?? 1);
  });

  const merged: ReviewComment[] = [];

  for (const comment of sorted) {
    // 检查是否能与 merged 中已有的最新意见合并
    const last = merged[merged.length - 1];
    if (last && areCommentsRedundant(last, comment)) {
      merged[merged.length - 1] = mergeTwoComments(last, comment);
    } else {
      merged.push({ ...comment });
    }
  }

  // 最终稳定排序：file ASC -> line ASC -> severity DESC
  return merged.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return (SEVERITY_WEIGHT[b.severity] ?? 1) - (SEVERITY_WEIGHT[a.severity] ?? 1);
  });
}

export default deduplicateComments;
