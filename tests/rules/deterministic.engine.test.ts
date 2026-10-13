import { describe, it, expect } from 'vitest';
import { runDeterministicRules } from '../../src/rules/deterministic.engine.js';
import type { CodeChunk } from '../../src/agents/types.js';

describe('DeterministicRulesEngine', () => {
  const createChunk = (diffContent: string, startLine = 10): CodeChunk => ({
    file: 'src/example.ts',
    language: 'typescript',
    diffContent,
    fullContext: diffContent,
    startLine,
    endLine: startLine + 10,
    diffPosition: 1,
  });

  describe('Secret & Credential Detection', () => {
    it('detects hardcoded OpenAI-like API keys in added lines', () => {
      const chunk = createChunk(
        `@@ -10,3 +10,4 @@
 const env = process.env;
+const apiKey = "sk-proj-abc1234567890defghijklmnopqrstuvwxyz";
 console.log("ready");`
      );

      const comments = runDeterministicRules(chunk);
      expect(comments.length).toBeGreaterThan(0);
      const secretComment = comments.find(c => c.message.includes('API Key') || c.message.includes('密钥'));
      expect(secretComment).toBeDefined();
      expect(secretComment?.severity).toBe('error');
      expect(secretComment?.category).toBe('security');
      expect(secretComment?.confidence).toBe(1.0);
      expect(secretComment?.line).toBe(11);
    });

    it('detects AWS access keys', () => {
      const chunk = createChunk(
        `@@ -10,3 +10,4 @@
+const awsKey = "AKIAIOSFODNN7EXAMPLE";`
      );

      const comments = runDeterministicRules(chunk);
      expect(comments.some(c => c.message.includes('AWS') || c.message.includes('密钥'))).toBe(true);
    });

    it('detects private key headers', () => {
      const chunk = createChunk(
        `@@ -10,3 +10,4 @@
+const privateKey = "-----BEGIN RSA PRIVATE KEY-----";`
      );

      const comments = runDeterministicRules(chunk);
      expect(comments.some(c => c.message.includes('私钥') || c.message.includes('Private Key'))).toBe(true);
    });

    it('does not trigger on removed (-) or unchanged lines', () => {
      const chunk = createChunk(
        `@@ -10,3 +10,3 @@
-const oldKey = "sk-proj-abc1234567890defghijklmnopqrstuvwxyz";
 const dummy = "ok";`
      );

      const comments = runDeterministicRules(chunk);
      expect(comments).toHaveLength(0);
    });
  });

  describe('SQL Injection Detection', () => {
    it('detects string concatenation in SQL queries', () => {
      const chunk = createChunk(
        `@@ -20,3 +20,4 @@
 function getUser(id: string) {
+  const query = "SELECT * FROM users WHERE id = " + id;
+  return db.execute(query);
 }`,
        20
      );

      const comments = runDeterministicRules(chunk);
      const sqlComment = comments.find(c => c.message.includes('SQL') || c.message.includes('注入'));
      expect(sqlComment).toBeDefined();
      expect(sqlComment?.severity).toBe('error');
      expect(sqlComment?.category).toBe('security');
      expect(sqlComment?.confidence).toBe(1.0);
    });

    it('detects raw template literal interpolation in SQL', () => {
      const chunk = createChunk(
        `@@ -30,3 +30,4 @@
+const sql = \`DELETE FROM orders WHERE user_id = \${userId}\`;
 db.query(sql);`,
        30
      );

      const comments = runDeterministicRules(chunk);
      const sqlComment = comments.find(c => c.message.includes('SQL') || c.message.includes('注入'));
      expect(sqlComment).toBeDefined();
    });
  });

  describe('XSS & Dangerous HTML Detection', () => {
    it('detects unsafe assignment to innerHTML', () => {
      const chunk = createChunk(
        `@@ -15,3 +15,4 @@
 function render(content: string) {
+  document.getElementById("app")!.innerHTML = content;
 }`,
        15
      );

      const comments = runDeterministicRules(chunk);
      const xssComment = comments.find(c => c.message.includes('innerHTML') || c.message.includes('XSS'));
      expect(xssComment).toBeDefined();
      expect(xssComment?.category).toBe('security');
    });

    it('detects dangerouslySetInnerHTML with variable', () => {
      const chunk = createChunk(
        `@@ -5,3 +5,4 @@
 export function MyComponent({ html }: { html: string }) {
+  return <div dangerouslySetInnerHTML={{ __html: html }} />;
 }`,
        5
      );

      const comments = runDeterministicRules(chunk);
      expect(comments.some(c => c.message.includes('dangerouslySetInnerHTML') || c.message.includes('XSS'))).toBe(true);
    });
  });

  describe('Code Logic & Anti-pattern Detection', () => {
    it('detects comparison with NaN (=== NaN)', () => {
      const chunk = createChunk(
        `@@ -40,3 +40,4 @@
+if (value === NaN) {
   console.log('invalid');
 }`,
        40
      );

      const comments = runDeterministicRules(chunk);
      const nanComment = comments.find(c => c.message.includes('NaN'));
      expect(nanComment).toBeDefined();
      expect(nanComment?.category).toBe('bug');
      expect(nanComment?.severity).toBe('error');
      expect(nanComment?.suggestion).toContain('Number.isNaN');
    });

    it('detects single equal assignment in if conditions', () => {
      const chunk = createChunk(
        `@@ -50,3 +50,4 @@
+if (user = getUser()) {
   console.log('found');
 }`,
        50
      );

      const comments = runDeterministicRules(chunk);
      const assignComment = comments.find(c => c.message.includes('赋值') || c.message.includes('assignment'));
      expect(assignComment).toBeDefined();
      expect(assignComment?.category).toBe('bug');
    });
  });

  describe('Clean code passes without false positives', () => {
    it('returns empty array when no patterns matched', () => {
      const chunk = createChunk(
        `@@ -1,3 +1,4 @@
 const a = 1;
+const b = a + 2;
 console.log(b);`
      );

      const comments = runDeterministicRules(chunk);
      expect(comments).toHaveLength(0);
    });
  });
});
