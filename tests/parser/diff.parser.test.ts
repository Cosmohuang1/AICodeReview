import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/parser/diff.parser.js';

const SAMPLE_DIFF = `diff --git a/src/api/user.ts b/src/api/user.ts
index abc123..def456 100644
--- a/src/api/user.ts
+++ b/src/api/user.ts
@@ -40,6 +40,9 @@ export async function getUser(id: string) {
   const user = await db.findById(id);
+  if (!user) {
+    throw new Error('not found');
+  }
   return user;
 }`;

const MULTI_HUNK_DIFF = `diff --git a/src/calc.py b/src/calc.py
index 111..222 100644
--- a/src/calc.py
+++ b/src/calc.py
@@ -10,1 +10,2 @@ def add(a, b):
-    return a - b
+    return a + b
+    # bonus comment
@@ -30,1 +31,2 @@ def mul(a, b):
     return a * b
+    # multiply note
`;

const NEW_FILE_DIFF = `diff --git a/src/new-feature.go b/src/new-feature.go
new file mode 100644
index 0000000..abcdef1
--- /dev/null
+++ b/src/new-feature.go
@@ -0,0 +1,5 @@
+package main
+
+func Hello() string {
+	return "world"
+}
`;

const DELETED_FILE_DIFF = `diff --git a/src/obsolete.rs b/src/obsolete.rs
deleted file mode 100644
index 1234567..0000000
--- a/src/obsolete.rs
+++ /dev/null
@@ -1,3 +0,0 @@
-fn old() {
-    println!("goodbye");
-}
`;

describe('parseDiff', () => {
  it('parses file path correctly', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('src/api/user.ts');
  });

  it('detects TypeScript language', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files[0].language).toBe('typescript');
  });

  it('parses hunk start line', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files[0].hunks[0].newStart).toBe(40);
  });

  it('returns empty array for empty diff or whitespace-only diff', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('   \n\t  ')).toEqual([]);
  });

  it('parses hunk changes and diffPosition correctly', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const hunk = files[0].hunks[0];
    expect(hunk.oldStart).toBe(40);
    expect(hunk.newStart).toBe(40);
    expect(hunk.newLines).toContain("    throw new Error('not found');");
    expect(hunk.rawHunk).toContain("+  if (!user) {");
    expect(hunk.diffPosition).toBe(1);
  });

  it('detects language from file extension', () => {
    const pythonFiles = parseDiff(MULTI_HUNK_DIFF);
    expect(pythonFiles[0].language).toBe('python');

    const goFiles = parseDiff(NEW_FILE_DIFF);
    expect(goFiles[0].language).toBe('go');

    const deletedFiles = parseDiff(DELETED_FILE_DIFF);
    expect(deletedFiles[0].language).toBe('rust');
  });

  it('handles multiple hunks and diffPosition progression', () => {
    const files = parseDiff(MULTI_HUNK_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].hunks).toHaveLength(2);

    const firstHunk = files[0].hunks[0];
    const secondHunk = files[0].hunks[1];

    expect(firstHunk.diffPosition).toBe(1);
    // Hunk 1 has 1 header + 3 changes = 4 lines
    // Hunk 2 header is line 5, changes start line 6 => diffPosition is 5
    expect(secondHunk.diffPosition).toBe(5);
  });

  it('handles new file diff', () => {
    const files = parseDiff(NEW_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('src/new-feature.go');
    expect(files[0].isNew).toBe(true);
    expect(files[0].isDeleted).toBe(false);
    expect(files[0].hunks[0].newLines).toHaveLength(5);
  });

  it('handles deleted file diff', () => {
    const files = parseDiff(DELETED_FILE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe('src/obsolete.rs');
    expect(files[0].isDeleted).toBe(true);
    expect(files[0].isNew).toBe(false);
  });
});
