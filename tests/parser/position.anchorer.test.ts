import { describe, it, expect } from 'vitest';
import { anchorCommentToDiff, anchorComments } from '../../src/parser/position.anchorer.js';
import type { ParsedFile } from '../../src/parser/diff.parser.js';
import type { ReviewComment } from '../../src/agents/types.js';

describe('PositionAnchorer (Anti-drift Engine)', () => {
  const sampleParsedFile: ParsedFile = {
    filePath: 'src/service.ts',
    language: 'typescript',
    isNew: false,
    isDeleted: false,
    hunks: [
      {
        oldStart: 10,
        newStart: 10,
        // Lines in hunk:
        // Position 1: @@ -10,4 +10,5 @@
        // Position 2: (context) const a = 1; -> line 10
        // Position 3: (+) const b = 2; -> line 11 (added)
        // Position 4: (+) const c = 3; -> line 12 (added)
        // Position 5: (context) return a; -> line 13
        newLines: ['const a = 1;', 'const b = 2;', 'const c = 3;', 'return a;'],
        diffPosition: 1,
        rawHunk: [
          ' const a = 1;',
          '+const b = 2;',
          '+const c = 3;',
          ' return a;',
        ].join('\n'),
      },
    ],
  };

  const createComment = (line: number, file = 'src/service.ts'): ReviewComment => ({
    file,
    line,
    side: 'RIGHT',
    severity: 'warning',
    category: 'bug',
    message: 'Potential issue',
    confidence: 0.85,
  });

  describe('Accurate line mapping & diffPosition calculation', () => {
    it('accurately maps a comment directly on an added line', () => {
      const comment = createComment(11);
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored).not.toBeNull();
      expect(anchored?.line).toBe(11);
      // Diff position:
      // hunk header is pos 1
      // line 10 (context) is pos 2
      // line 11 (added) is pos 3
      expect(anchored?.diffPosition).toBe(3);
    });

    it('accurately maps line 12 to diffPosition 4', () => {
      const comment = createComment(12);
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored).not.toBeNull();
      expect(anchored?.line).toBe(12);
      expect(anchored?.diffPosition).toBe(4);
    });
  });

  describe('Anti-drift: snapping unchanged context lines to nearest modified line', () => {
    it('snaps unchanged context line 10 to nearest added line 11', () => {
      // LLM pointed to line 10 which wasn't changed
      const comment = createComment(10);
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored).not.toBeNull();
      expect(anchored?.line).toBe(11); // snapped to closest added line
      expect(anchored?.diffPosition).toBe(3);
    });

    it('snaps context line 13 to nearest added line 12', () => {
      const comment = createComment(13);
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored).not.toBeNull();
      expect(anchored?.line).toBe(12); // snapped to closest added line
      expect(anchored?.diffPosition).toBe(4);
    });
  });

  describe('Handling comments far outside any diff hunk', () => {
    it('discards comment if line is far outside any changed hunk (e.g. line 999)', () => {
      const comment = createComment(999);
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      // Should be null to prevent GitHub 422 API reject
      expect(anchored).toBeNull();
    });

    it('discards comment if file does not match parsed file', () => {
      const comment = createComment(11, 'other/file.ts');
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored).toBeNull();
    });
  });

  describe('Cleaning code suggestions', () => {
    it('strips markdown triple backtick fences from suggestion', () => {
      const comment: ReviewComment = {
        ...createComment(11),
        suggestion: '```typescript\nconst b = 20;\n```',
      };
      const anchored = anchorCommentToDiff(comment, sampleParsedFile);

      expect(anchored?.suggestion).toBe('const b = 20;');
    });
  });

  describe('Batch anchorComments over multiple files', () => {
    it('anchors a list of comments across parsed files', () => {
      const comments = [createComment(11), createComment(999)];
      const anchoredList = anchorComments(comments, [sampleParsedFile]);

      expect(anchoredList).toHaveLength(1);
      expect(anchoredList[0].line).toBe(11);
      expect(anchoredList[0].diffPosition).toBe(3);
    });
  });
});
