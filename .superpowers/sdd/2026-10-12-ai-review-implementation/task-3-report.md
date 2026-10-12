# Task 3 Report: Diff 解析与语法感知分块（Chunker）

## What Was Done

1. **Test-Driven Development (TDD) for Diff Parser**:
   - Created `tests/parser/diff.parser.test.ts` covering:
     - File path extraction from unified diffs.
     - Language detection by file extension (`.ts`, `.py`, `.go`, `.rs`, etc.).
     - Hunk parsing (`newStart`, `oldStart`, `newLines`, `rawHunk`).
     - GitHub diff line position tracking (`diffPosition`) across single and multiple hunks.
     - New files (`isNew: true`) and deleted files (`isDeleted: true`).
     - Graceful handling of empty or whitespace diff inputs.
   - Ran `npx vitest run tests/parser/diff.parser.test.ts` to confirm failing tests prior to implementation.

2. **Implemented Diff Parser (`src/parser/diff.parser.ts`)**:
   - Exported `ParsedHunk` and `ParsedFile` interfaces.
   - Exported `parseDiff(rawDiff: string): ParsedFile[]` utilizing the `parse-diff` library.
   - Handled line formatting safely: inspected whether change content already contains the leading prefix (`+`, `-`, `' '`), preventing double-prefixing in `rawHunk` and cleanly populating `newLines` for additions and normal context lines.
   - Handled deleted files by ensuring files with `to === '/dev/null'` or `f.deleted` are tagged `isDeleted: true` and mapped to `filePath: f.from`.
   - Verified tests pass (9/9 passed).

3. **Test-Driven Development (TDD) for Chunker**:
   - Created `tests/parser/chunker.test.ts` covering:
     - Chunk generation per hunk.
     - File path, language, diffContent, and diffPosition assignment.
     - Context extraction (`fullContext`) when full file content is provided in `fileContents` map.
     - Fallback to `diffContent` when file content is absent or when `fullContext` exceeds `maxTokens`.
     - Automatic skipping of deleted files (`isDeleted: true`).
     - Line boundary extraction within a 20-line window before and after.
     - Edge cases such as deletion-only hunks with empty `newLines`.
   - Ran `npx vitest run tests/parser/chunker.test.ts` to confirm failing tests prior to implementation.

4. **Implemented Chunker (`src/parser/chunker.ts`)**:
   - Exported `chunkFiles(files: ParsedFile[], fileContents: Map<string, string>, maxTokens = 8000): CodeChunk[]`.
   - Implemented token estimation (`Math.ceil(text.length / 4)`).
   - Implemented line-based context extraction with `CONTEXT_LINES = 20`.
   - Added robust boundary handling in `extractContext`: if the full file content provided is shorter than `startLine - 20` (e.g. truncated content or small mock content in tests), it falls back to providing the available `fullContent` rather than slicing an inverted empty range.
   - Verified tests pass (10/10 passed).

5. **Type Checking and Project-wide Test Verification**:
   - Ran `npx tsc --noEmit`: 0 errors.
   - Ran `npx vitest run`: 36/36 tests passed across all 4 test suites.
   - Coverage on `src/parser`: 100% statements, 100% functions, 100% lines.

6. **Git Commit**:
   - Committed with message `feat: diff parser and syntax-aware chunker` (`cb9bc5a`).

## Test Results

- **Vitest**: 19 passed in `tests/parser/` (36 passed across entire project)
  - `tests/parser/diff.parser.test.ts`: 9/9 passed
    - `parseDiff > parses file path correctly`
    - `parseDiff > detects TypeScript language`
    - `parseDiff > parses hunk start line`
    - `parseDiff > returns empty array for empty diff or whitespace-only diff`
    - `parseDiff > parses hunk changes and diffPosition correctly`
    - `parseDiff > detects language from file extension`
    - `parseDiff > handles multiple hunks and diffPosition progression`
    - `parseDiff > handles new file diff`
    - `parseDiff > handles deleted file diff`
  - `tests/parser/chunker.test.ts`: 10/10 passed
    - `chunkFiles > creates a chunk for each hunk`
    - `chunkFiles > sets correct file path on chunk`
    - `chunkFiles > includes full context when file content is provided`
    - `chunkFiles > uses diffContent when no file content available`
    - `chunkFiles > skips deleted files`
    - `chunkFiles > populates chunk fields accurately`
    - `chunkFiles > falls back to diffContent when fullContext exceeds maxTokens`
    - `chunkFiles > handles multiple hunks across multiple files`
    - `chunkFiles > extracts context with 20 line window before and after`
    - `chunkFiles > handles hunk with empty newLines without producing invalid endLine`
- **TypeScript**: `tsc --noEmit` passed with 0 errors.

## Concerns / Decisions

1. **`parse-diff` Content Formatting**:
   - In `parse-diff`, `change.content` already includes the diff line prefix (`+`, `-`, or `' '`). A naive template literal like `+${change.content}` would produce invalid `++` diff lines. We implemented prefix inspection so that `rawHunk` retains standard unified diff format while `newLines` contains clean lines without the leading prefix.
2. **Deleted File Preservation**:
   - Unified diffs for deleted files specify `+++ /dev/null`. Instead of discarding them, `parseDiff` preserves them with `isDeleted: true` and sets `filePath = f.from`. This allows `summaryAgent` downstream to recognize deletions, while `chunkFiles` explicitly skips deleted files via `if (file.isDeleted) continue;`.
3. **`extractContext` Out-of-Bounds Clamping**:
   - When unit tests or callers provide file contents that have fewer lines than `startLine - CONTEXT_LINES` (e.g. testing with short mock contents), `ctxStart > ctxEnd` occurs. `extractContext` detects this condition and returns `fullContent` rather than an empty string `""`.
