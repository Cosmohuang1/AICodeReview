import type { ParsedFile, ParsedHunk } from './diff.parser.js';
import type { ReviewComment } from '../agents/types.js';

interface HunkLineInfo {
  type: 'add' | 'context' | 'del';
  line?: number; // target file line number for add / context
  diffPosition: number;
}

function cleanSuggestionCode(suggestion?: string): string | undefined {
  if (!suggestion) return undefined;
  const trimmed = suggestion.trim();
  const codeBlockMatch = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return trimmed;
}

function analyzeHunk(hunk: ParsedHunk): {
  hunkStartLine: number;
  hunkEndLine: number;
  addedLines: { line: number; diffPosition: number }[];
  contextLines: { line: number; diffPosition: number }[];
} {
  const lines = hunk.rawHunk ? hunk.rawHunk.split('\n') : [];
  let currentNewLine = hunk.newStart;
  // Hunk header @@ is at hunk.diffPosition
  let currentDiffPos = hunk.diffPosition;

  const addedLines: { line: number; diffPosition: number }[] = [];
  const contextLines: { line: number; diffPosition: number }[] = [];

  for (const rawLine of lines) {
    currentDiffPos++;
    if (rawLine.startsWith('+')) {
      addedLines.push({ line: currentNewLine, diffPosition: currentDiffPos });
      currentNewLine++;
    } else if (rawLine.startsWith(' ') || (!rawLine.startsWith('-') && !rawLine.startsWith('@'))) {
      contextLines.push({ line: currentNewLine, diffPosition: currentDiffPos });
      currentNewLine++;
    } else if (rawLine.startsWith('-')) {
      // deleted line in old file, advances diffPosition but not new file line
    }
  }

  const allLines = [...addedLines, ...contextLines].map(x => x.line);
  const hunkStartLine = allLines.length > 0 ? Math.min(...allLines) : hunk.newStart;
  const hunkEndLine = allLines.length > 0 ? Math.max(...allLines) : hunk.newStart;

  return {
    hunkStartLine,
    hunkEndLine,
    addedLines,
    contextLines,
  };
}

/**
 * 将单条审查意见对齐并锚定到 diff hunk 的实际修改行
 * 防止批注漂移与 GitHub 422 异常
 */
export function anchorCommentToDiff(
  comment: ReviewComment,
  parsedFile: ParsedFile
): ReviewComment | null {
  if (comment.file !== parsedFile.filePath) {
    return null;
  }

  const cleanedSuggestion = cleanSuggestionCode(comment.suggestion);

  for (const hunk of parsedFile.hunks) {
    const { hunkStartLine, hunkEndLine, addedLines, contextLines } = analyzeHunk(hunk);

    // 1. 如果有新增修改行，优先检查是否精确匹配新增行
    const exactAdd = addedLines.find(al => al.line === comment.line);
    if (exactAdd) {
      return {
        ...comment,
        line: exactAdd.line,
        diffPosition: comment.diffPosition ?? exactAdd.diffPosition,
        suggestion: cleanedSuggestion,
      };
    }

    // 2. 检查是否落在 hunk 范围内（包括上下 3 行的容差范围）
    const isNearby = comment.line >= hunkStartLine - 3 && comment.line <= hunkEndLine + 3;
    if (isNearby && addedLines.length > 0) {
      // 防漂移吸附：找到距离该行最近的真实新增/修改行（+）
      let closest = addedLines[0];
      let minDistance = Math.abs(addedLines[0].line - comment.line);

      for (let i = 1; i < addedLines.length; i++) {
        const distance = Math.abs(addedLines[i].line - comment.line);
        if (distance < minDistance) {
          minDistance = distance;
          closest = addedLines[i];
        }
      }

      return {
        ...comment,
        line: closest.line,
        diffPosition: comment.diffPosition ?? closest.diffPosition,
        suggestion: cleanedSuggestion,
      };
    }

  }

  // 超出所有 hunk 的范围，为避免向 GitHub 发布无效批注，返回 null
  return null;
}

/**
 * 批量将审查意见锚定到解析后的文件集
 */
export function anchorComments(
  comments: ReviewComment[],
  parsedFiles: ParsedFile[]
): ReviewComment[] {
  const fileMap = new Map<string, ParsedFile>();
  for (const f of parsedFiles) {
    fileMap.set(f.filePath, f);
  }

  const anchoredList: ReviewComment[] = [];

  for (const comment of comments) {
    const parsedFile = fileMap.get(comment.file);
    if (!parsedFile) {
      continue;
    }

    const anchored = anchorCommentToDiff(comment, parsedFile);
    if (anchored) {
      anchoredList.push(anchored);
    }
  }

  return anchoredList;
}

export default anchorComments;
