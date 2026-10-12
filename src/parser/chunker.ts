import type { ParsedFile } from './diff.parser.js';
import type { CodeChunk } from '../agents/types.js';

const CHARS_PER_TOKEN = 4;
const CONTEXT_LINES = 20; // 在 diff 前后各取 N 行作为上下文

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function extractContext(fullContent: string, startLine: number, endLine: number): string {
  const lines = fullContent.split('\n');
  if (lines.length === 0) return fullContent;

  const ctxStart = Math.max(0, startLine - CONTEXT_LINES - 1);
  const ctxEnd = Math.min(lines.length - 1, endLine + CONTEXT_LINES - 1);

  if (ctxStart > ctxEnd) {
    return fullContent;
  }

  return lines.slice(ctxStart, ctxEnd + 1).join('\n');
}

export function chunkFiles(
  files: ParsedFile[],
  fileContents: Map<string, string>,
  maxTokens = 8000
): CodeChunk[] {
  const chunks: CodeChunk[] = [];

  for (const file of files) {
    if (file.isDeleted) continue;
    const fullContent = fileContents.get(file.filePath) ?? null;

    for (const hunk of file.hunks) {
      const diffContent = hunk.rawHunk;
      const fullContext = fullContent
        ? extractContext(fullContent, hunk.newStart, hunk.newStart + hunk.newLines.length)
        : diffContent;

      // 如果 fullContext 太大，截断到 maxTokens
      const contextToUse = estimateTokens(fullContext) > maxTokens
        ? diffContent // 降级：只用 diff 内容
        : fullContext;

      const endLine = hunk.newLines.length > 0
        ? hunk.newStart + hunk.newLines.length - 1
        : hunk.newStart;

      chunks.push({
        file: file.filePath,
        language: file.language,
        diffContent,
        fullContext: contextToUse,
        startLine: hunk.newStart,
        endLine,
        diffPosition: hunk.diffPosition,
      });
    }
  }

  return chunks;
}
