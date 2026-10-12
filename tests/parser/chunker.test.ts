import { describe, it, expect } from 'vitest';
import { chunkFiles } from '../../src/parser/chunker.js';
import type { ParsedFile } from '../../src/parser/diff.parser.js';

const mockFile: ParsedFile = {
  filePath: 'src/api/user.ts',
  language: 'typescript',
  isNew: false,
  isDeleted: false,
  hunks: [{
    oldStart: 40,
    newStart: 40,
    newLines: ['const user = await db.findById(id);', 'return user;'],
    diffPosition: 5,
    rawHunk: '+const user = await db.findById(id);\n+return user;',
  }],
};

const mockDeletedFile: ParsedFile = {
  filePath: 'src/api/old.ts',
  language: 'typescript',
  isNew: false,
  isDeleted: true,
  hunks: [{
    oldStart: 1,
    newStart: 0,
    newLines: [],
    diffPosition: 1,
    rawHunk: '-console.log("old");',
  }],
};

const mockMultiHunkFile: ParsedFile = {
  filePath: 'src/api/service.ts',
  language: 'typescript',
  isNew: false,
  isDeleted: false,
  hunks: [
    {
      oldStart: 10,
      newStart: 10,
      newLines: ['line 10', 'line 11'],
      diffPosition: 1,
      rawHunk: '+line 10\n+line 11',
    },
    {
      oldStart: 50,
      newStart: 55,
      newLines: ['line 55'],
      diffPosition: 10,
      rawHunk: '+line 55',
    },
  ],
};

describe('chunkFiles', () => {
  it('creates a chunk for each hunk', () => {
    const chunks = chunkFiles([mockFile], new Map());
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks).toHaveLength(1);
  });

  it('sets correct file path on chunk', () => {
    const chunks = chunkFiles([mockFile], new Map());
    expect(chunks[0].file).toBe('src/api/user.ts');
  });

  it('includes full context when file content is provided', () => {
    const content = 'export async function getUser(id: string) {\n  const user = await db.findById(id);\n  return user;\n}';
    const chunks = chunkFiles([mockFile], new Map([['src/api/user.ts', content]]));
    expect(chunks[0].fullContext).toContain('getUser');
  });

  it('uses diffContent when no file content available', () => {
    const chunks = chunkFiles([mockFile], new Map());
    expect(chunks[0].fullContext).toBe(chunks[0].diffContent);
  });

  it('skips deleted files', () => {
    const chunks = chunkFiles([mockDeletedFile], new Map());
    expect(chunks).toHaveLength(0);

    const mixedChunks = chunkFiles([mockFile, mockDeletedFile], new Map());
    expect(mixedChunks).toHaveLength(1);
    expect(mixedChunks[0].file).toBe('src/api/user.ts');
  });

  it('populates chunk fields accurately', () => {
    const chunks = chunkFiles([mockFile], new Map());
    expect(chunks[0]).toEqual({
      file: 'src/api/user.ts',
      language: 'typescript',
      diffContent: mockFile.hunks[0].rawHunk,
      fullContext: mockFile.hunks[0].rawHunk,
      startLine: 40,
      endLine: 41, // 40 + 2 - 1
      diffPosition: 5,
    });
  });

  it('falls back to diffContent when fullContext exceeds maxTokens', () => {
    // 1000 lines of content will exceed maxTokens = 50 tokens
    const longContent = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');
    const chunks = chunkFiles([mockFile], new Map([['src/api/user.ts', longContent]]), 50);

    expect(chunks[0].fullContext).toBe(chunks[0].diffContent);
  });

  it('handles multiple hunks across multiple files', () => {
    const chunks = chunkFiles([mockFile, mockMultiHunkFile], new Map());
    expect(chunks).toHaveLength(3);
    expect(chunks[0].file).toBe('src/api/user.ts');
    expect(chunks[1].file).toBe('src/api/service.ts');
    expect(chunks[1].startLine).toBe(10);
    expect(chunks[1].endLine).toBe(11);
    expect(chunks[2].file).toBe('src/api/service.ts');
    expect(chunks[2].startLine).toBe(55);
    expect(chunks[2].endLine).toBe(55);
  });

  it('extracts context with 20 line window before and after', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `content line ${i + 1}`);
    const content = lines.join('\n');
    const singleHunkFile: ParsedFile = {
      filePath: 'src/large.ts',
      language: 'typescript',
      isNew: false,
      isDeleted: false,
      hunks: [{
        oldStart: 50,
        newStart: 50,
        newLines: ['content line 50', 'content line 51'],
        diffPosition: 1,
        rawHunk: '+content line 50\n+content line 51',
      }],
    };

    const chunks = chunkFiles([singleHunkFile], new Map([['src/large.ts', content]]), 5000);
    // startLine = 50, 50 - 20 = line 30 (0-indexed 29) -> content line 30
    // endLine = 50 + 2 = 52, 52 + 20 = line 72 (0-indexed 71) -> content line 72
    expect(chunks[0].fullContext).toContain('content line 30');
    expect(chunks[0].fullContext).not.toContain('content line 28\n');
    expect(chunks[0].fullContext).toContain('content line 72');
  });

  it('handles hunk with empty newLines without producing invalid endLine', () => {
    const deleteOnlyFile: ParsedFile = {
      filePath: 'src/delete-only.ts',
      language: 'typescript',
      isNew: false,
      isDeleted: false,
      hunks: [{
        oldStart: 25,
        newStart: 25,
        newLines: [],
        diffPosition: 3,
        rawHunk: '-deleted line',
      }],
    };

    const chunks = chunkFiles([deleteOnlyFile], new Map());
    expect(chunks).toHaveLength(1);
    expect(chunks[0].startLine).toBe(25);
    expect(chunks[0].endLine).toBe(25);
  });
});
