# ai-review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个对标 CodeRabbit 的 GitHub App AI Code Review 服务，PR 提交时自动触发，输出 PR 摘要 + 行级 Inline Comment（含 suggestion 一键应用）。

**Architecture:** Express Webhook 服务 + DeepSeek 6-Agent 并发审查 + Self-Critique 二阶过滤 + Octokit 发布到 GitHub PR。

**Tech Stack:** TypeScript, Express, @octokit/app, openai SDK (DeepSeek 兼容), tree-sitter, parse-diff, zod, js-yaml, vitest, tsup

## Global Constraints

- Node.js >= 20 (使用原生 `fetch`, `AbortController`)
- TypeScript strict mode 开启
- 所有模块使用 ESM (`"type": "module"` in package.json)
- 测试使用 vitest，覆盖率目标 ≥ 80%
- 环境变量通过 `process.env` 读取，绝不硬编码
- 所有 DeepSeek 调用使用 openai SDK 兼容模式（baseURL 设为 DeepSeek endpoint）
- 报告语言默认中文
- GitHub Review Comment 必须使用 `position` 参数（diff 行偏移量），不能用 `line`（除非是单文件 review）

---

### Task 1: 项目脚手架与基础配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/config/defaults.ts`
- Create: `src/config/schema.ts`
- Create: `src/config/loader.ts`
- Create: `tests/config/loader.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // src/config/schema.ts
  export type Category = 'bug' | 'security' | 'performance' | 'style' | 'test' | 'custom';
  export type Severity = 'error' | 'warning' | 'info';
  export interface RepoConfig {
    language: 'zh' | 'en';
    rules: string[];
    exclude: string[];
    severityOverride: Partial<Record<Category, Severity>>;
    selfCritiqueThreshold: number;
    maxFilesPerReview: number;
  }
  export function parseRepoConfig(raw: unknown): RepoConfig; // throws ZodError
  ```

- [ ] **Step 1: 初始化 package.json**

```bash
mkdir -p C:\Users\admin\.gemini\antigravity\scratch\ai-review
cd C:\Users\admin\.gemini\antigravity\scratch\ai-review
```

创建 `package.json`:
```json
{
  "name": "ai-review",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/server/app.js",
  "scripts": {
    "build": "tsup src/server/app.ts --format esm --dts",
    "start": "node dist/server/app.js",
    "dev": "tsx watch src/server/app.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@octokit/app": "^15.0.0",
    "@octokit/rest": "^21.0.0",
    "@octokit/webhooks": "^13.0.0",
    "express": "^4.18.0",
    "js-yaml": "^4.1.0",
    "openai": "^4.50.0",
    "parse-diff": "^0.11.0",
    "tree-sitter": "^0.21.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/js-yaml": "^4.0.0",
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "tsx": "^4.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 .env.example**

```bash
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=      # PEM 私钥内容，换行替换为 \n
GITHUB_WEBHOOK_SECRET=
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
PORT=3000
```

- [ ] **Step 4: 写 schema.ts 的失败测试**

创建 `tests/config/loader.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseRepoConfig } from '../../src/config/schema.js';

describe('parseRepoConfig', () => {
  it('returns defaults when given empty object', () => {
    const result = parseRepoConfig({});
    expect(result.language).toBe('zh');
    expect(result.selfCritiqueThreshold).toBe(0.6);
    expect(result.maxFilesPerReview).toBe(20);
    expect(result.rules).toEqual([]);
    expect(result.exclude).toEqual([]);
  });

  it('merges custom rules with empty defaults', () => {
    const result = parseRepoConfig({ rules: ['禁止使用 console.log'] });
    expect(result.rules).toContain('禁止使用 console.log');
  });

  it('throws on invalid language value', () => {
    expect(() => parseRepoConfig({ language: 'fr' })).toThrow();
  });

  it('throws on invalid selfCritiqueThreshold (out of range)', () => {
    expect(() => parseRepoConfig({ selfCritiqueThreshold: 1.5 })).toThrow();
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

```bash
npx vitest run tests/config/loader.test.ts
```
Expected: FAIL — "Cannot find module '../../src/config/schema.js'"

- [ ] **Step 6: 实现 src/config/schema.ts**

```typescript
import { z } from 'zod';

export type Category = 'bug' | 'security' | 'performance' | 'style' | 'test' | 'custom';
export type Severity = 'error' | 'warning' | 'info';

const categoryEnum = z.enum(['bug', 'security', 'performance', 'style', 'test', 'custom']);
const severityEnum = z.enum(['error', 'warning', 'info']);

const RepoConfigSchema = z.object({
  language: z.enum(['zh', 'en']).default('zh'),
  rules: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([
    '*.min.js', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'dist/**', 'build/**', '*.generated.ts', '*.generated.js',
  ]),
  severityOverride: z.record(categoryEnum, severityEnum).partial().default({}),
  selfCritiqueThreshold: z.number().min(0).max(1).default(0.6),
  maxFilesPerReview: z.number().int().positive().default(20),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export function parseRepoConfig(raw: unknown): RepoConfig {
  return RepoConfigSchema.parse(raw);
}
```

- [ ] **Step 7: 实现 src/config/loader.ts**

```typescript
import yaml from 'js-yaml';
import { parseRepoConfig, type RepoConfig } from './schema.js';

// 在实际项目中，content 来自 GitHub API 读取仓库文件
// 在测试中，直接传字符串
export function loadRepoConfig(yamlContent: string | null): RepoConfig {
  if (!yamlContent) {
    return parseRepoConfig({});
  }
  try {
    const raw = yaml.load(yamlContent);
    return parseRepoConfig(raw);
  } catch {
    console.warn('[ai-review] .ai-review.yml 解析失败，使用默认配置');
    return parseRepoConfig({});
  }
}
```

- [ ] **Step 8: 运行测试确认通过**

```bash
npx vitest run tests/config/loader.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 9: 安装依赖**

```bash
npm install
```

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "feat: project scaffold, config schema and loader"
```

---

### Task 2: 类型定义与 DeepSeek 基础调用层

**Files:**
- Create: `src/agents/types.ts`
- Create: `src/agents/base.ts`
- Create: `tests/agents/base.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // src/agents/types.ts
  export interface ReviewComment {
    file: string; line: number; startLine?: number; side: 'RIGHT';
    severity: Severity; category: Category;
    message: string; suggestion?: string; confidence: number;
  }
  export interface CodeChunk {
    file: string; language: string; diffContent: string;
    fullContext: string; startLine: number; endLine: number;
    diffPosition: number;
  }
  export type AgentFn = (chunk: CodeChunk, config: RepoConfig) => Promise<ReviewComment[]>;

  // src/agents/base.ts
  export function callDeepSeek(prompt: string): Promise<string>;
  export function extractJsonArray(text: string): ReviewComment[];
  ```

- [ ] **Step 1: 写 base.ts 测试（失败）**

创建 `tests/agents/base.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractJsonArray } from '../../src/agents/base.js';

describe('extractJsonArray', () => {
  it('extracts JSON array from clean response', () => {
    const input = '[{"file":"a.ts","line":1,"side":"RIGHT","severity":"error","category":"bug","message":"test","confidence":0.9}]';
    const result = extractJsonArray(input);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('a.ts');
  });

  it('extracts JSON array from response with surrounding text', () => {
    const input = '以下是审查结果：\n```json\n[{"file":"b.ts","line":2,"side":"RIGHT","severity":"warning","category":"style","message":"命名问题","confidence":0.7}]\n```';
    const result = extractJsonArray(input);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('b.ts');
  });

  it('returns empty array when no JSON found', () => {
    const result = extractJsonArray('没有发现问题');
    expect(result).toEqual([]);
  });

  it('returns empty array when JSON is not an array', () => {
    const result = extractJsonArray('{"error": "invalid"}');
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/agents/base.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 src/agents/types.ts**

```typescript
import type { Category, Severity } from '../config/schema.js';

export type { Category, Severity };

export interface ReviewComment {
  file: string;
  line: number;
  startLine?: number;
  side: 'RIGHT';
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
  confidence: number;
}

export interface CodeChunk {
  file: string;
  language: string;
  diffContent: string;
  fullContext: string;
  startLine: number;
  endLine: number;
  diffPosition: number; // GitHub pull_request_review_comment 的 position 参数
}

export interface PRSummary {
  overview: string;
  walkthrough: Array<{ file: string; changes: string }>;
  mermaidDiagram: string;
}

import type { RepoConfig } from '../config/schema.js';
export type AgentFn = (chunk: CodeChunk, config: RepoConfig) => Promise<ReviewComment[]>;
```

- [ ] **Step 4: 实现 src/agents/base.ts**

```typescript
import OpenAI from 'openai';
import type { ReviewComment } from './types.js';

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  });
}

export async function callDeepSeek(prompt: string, timeoutMs = 60_000): Promise<string> {
  const client = getClient();
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      },
      { signal: controller.signal }
    );
    return response.choices[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

export function extractJsonArray(text: string): ReviewComment[] {
  // 尝试提取 markdown 代码块中的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  // 找到第一个 [ 和最后一个 ] 之间的内容
  const start = jsonText.indexOf('[');
  const end = jsonText.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed as ReviewComment[];
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/agents/base.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agents/ tests/agents/base.test.ts
git commit -m "feat: agent types and DeepSeek base caller"
```

---

### Task 3: Diff 解析与语法感知分块（Chunker）

**Files:**
- Create: `src/parser/diff.parser.ts`
- Create: `src/parser/chunker.ts`
- Create: `tests/parser/diff.parser.test.ts`
- Create: `tests/parser/chunker.test.ts`

**Interfaces:**
- Consumes: `CodeChunk` from `src/agents/types.ts`
- Produces:
  ```typescript
  // src/parser/diff.parser.ts
  export interface ParsedFile {
    filePath: string;
    language: string;
    hunks: Array<{ oldStart: number; newStart: number; newLines: string[]; diffPosition: number; rawHunk: string }>;
    isNew: boolean;
    isDeleted: boolean;
  }
  export function parseDiff(rawDiff: string): ParsedFile[];

  // src/parser/chunker.ts
  export function chunkFiles(
    files: ParsedFile[],
    fileContents: Map<string, string>,
    maxTokens?: number
  ): CodeChunk[];
  ```

- [ ] **Step 1: 写 diff.parser 失败测试**

创建 `tests/parser/diff.parser.test.ts`:
```typescript
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

  it('returns empty array for empty diff', () => {
    expect(parseDiff('')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/parser/diff.parser.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 src/parser/diff.parser.ts**

```typescript
import parseDiffLib from 'parse-diff';

export interface ParsedHunk {
  oldStart: number;
  newStart: number;
  newLines: string[];
  diffPosition: number; // 从文件 diff 开始的行偏移（GitHub position）
  rawHunk: string;
}

export interface ParsedFile {
  filePath: string;
  language: string;
  hunks: ParsedHunk[];
  isNew: boolean;
  isDeleted: boolean;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  py: 'python', java: 'java',
  go: 'go', rs: 'rust', cs: 'csharp',
  cpp: 'cpp', c: 'c', php: 'php',
  rb: 'ruby', kt: 'kotlin', swift: 'swift',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

export function parseDiff(rawDiff: string): ParsedFile[] {
  if (!rawDiff.trim()) return [];
  const files = parseDiffLib(rawDiff);

  return files
    .filter(f => f.to && f.to !== '/dev/null')
    .map(f => {
      const filePath = f.to ?? f.from ?? 'unknown';
      let position = 0; // diff position counter

      const hunks: ParsedHunk[] = f.chunks.map(chunk => {
        position++; // hunk header line counts as position 1
        const newLines: string[] = [];
        const rawLines: string[] = [];

        for (const change of chunk.changes) {
          position++;
          rawLines.push(
            change.type === 'add' ? `+${change.content}` :
            change.type === 'del' ? `-${change.content}` :
            ` ${change.content}`
          );
          if (change.type === 'add' || change.type === 'normal') {
            newLines.push(change.content);
          }
        }

        return {
          oldStart: chunk.oldStart,
          newStart: chunk.newStart,
          newLines,
          diffPosition: position - chunk.changes.length, // position of first change
          rawHunk: rawLines.join('\n'),
        };
      });

      return {
        filePath,
        language: detectLanguage(filePath),
        hunks,
        isNew: f.new ?? false,
        isDeleted: !f.to || f.to === '/dev/null',
      };
    });
}
```

- [ ] **Step 4: 运行 diff.parser 测试**

```bash
npx vitest run tests/parser/diff.parser.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: 写 chunker 失败测试**

创建 `tests/parser/chunker.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { chunkFiles } from '../../src/parser/chunker.js';
import type { ParsedFile } from '../../src/parser/diff.parser.js';

const mockFile: ParsedFile = {
  filePath: 'src/api/user.ts',
  language: 'typescript',
  isNew: false,
  isDeleted: false,
  hunks: [{
    oldStart: 40, newStart: 40,
    newLines: ['const user = await db.findById(id);', 'return user;'],
    diffPosition: 5,
    rawHunk: '+const user = await db.findById(id);\n+return user;',
  }],
};

describe('chunkFiles', () => {
  it('creates a chunk for each hunk', () => {
    const chunks = chunkFiles([mockFile], new Map());
    expect(chunks.length).toBeGreaterThan(0);
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
});
```

- [ ] **Step 6: 运行 chunker 测试确认失败**

```bash
npx vitest run tests/parser/chunker.test.ts
```
Expected: FAIL

- [ ] **Step 7: 实现 src/parser/chunker.ts**

```typescript
import type { ParsedFile } from './diff.parser.js';
import type { CodeChunk } from '../agents/types.js';

const CHARS_PER_TOKEN = 4;
const CONTEXT_LINES = 20; // 在 diff 前后各取 N 行作为上下文

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function extractContext(fullContent: string, startLine: number, endLine: number): string {
  const lines = fullContent.split('\n');
  const ctxStart = Math.max(0, startLine - CONTEXT_LINES - 1);
  const ctxEnd = Math.min(lines.length - 1, endLine + CONTEXT_LINES - 1);
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
        ? diffContent  // 降级：只用 diff 内容
        : fullContext;

      chunks.push({
        file: file.filePath,
        language: file.language,
        diffContent,
        fullContext: contextToUse,
        startLine: hunk.newStart,
        endLine: hunk.newStart + hunk.newLines.length - 1,
        diffPosition: hunk.diffPosition,
      });
    }
  }

  return chunks;
}
```

- [ ] **Step 8: 运行 chunker 测试**

```bash
npx vitest run tests/parser/chunker.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add src/parser/ tests/parser/
git commit -m "feat: diff parser and syntax-aware chunker"
```

---

### Task 4: 六个审查 Agent

**Files:**
- Create: `src/agents/bug.agent.ts`
- Create: `src/agents/security.agent.ts`
- Create: `src/agents/performance.agent.ts`
- Create: `src/agents/style.agent.ts`
- Create: `src/agents/test.agent.ts`
- Create: `src/agents/custom.agent.ts`
- Create: `tests/agents/bug.agent.test.ts`

**Interfaces:**
- Consumes: `callDeepSeek`, `extractJsonArray` from `src/agents/base.ts`; `CodeChunk`, `AgentFn` from `src/agents/types.ts`; `RepoConfig` from `src/config/schema.ts`
- Produces: Each file exports a single `AgentFn` default export.

- [ ] **Step 1: 写 bug.agent 失败测试**

创建 `tests/agents/bug.agent.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock callDeepSeek to avoid real API calls
vi.mock('../../src/agents/base.js', () => ({
  callDeepSeek: vi.fn().mockResolvedValue(
    '[{"file":"src/a.ts","line":5,"side":"RIGHT","severity":"error","category":"bug","message":"空指针","confidence":0.9}]'
  ),
  extractJsonArray: (await import('../../src/agents/base.js')).extractJsonArray,
}));

import { bugAgent } from '../../src/agents/bug.agent.js';
import type { CodeChunk } from '../../src/agents/types.js';
import { parseRepoConfig } from '../../src/config/schema.js';

const mockChunk: CodeChunk = {
  file: 'src/a.ts', language: 'typescript',
  diffContent: '+const x = obj.value;',
  fullContext: 'function test() { const x = obj.value; }',
  startLine: 5, endLine: 5, diffPosition: 3,
};

describe('bugAgent', () => {
  it('returns ReviewComment array from DeepSeek response', async () => {
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('bug');
    expect(result[0].file).toBe('src/a.ts');
  });

  it('returns empty array on API error', async () => {
    const { callDeepSeek } = await import('../../src/agents/base.js');
    vi.mocked(callDeepSeek).mockRejectedValueOnce(new Error('timeout'));
    const config = parseRepoConfig({});
    const result = await bugAgent(mockChunk, config);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行 bug.agent 测试确认失败**

```bash
npx vitest run tests/agents/bug.agent.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 src/agents/bug.agent.ts**

```typescript
import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn } from './types.js';

export const bugAgent: AgentFn = async (chunk, _config) => {
  const prompt = `你是一位专注于代码 Bug 检测的资深工程师。请审查以下代码变更，只关注：
- 空指针 / undefined / null 访问风险
- 数组越界、空数组、空字符串边界条件
- 异常未捕获或错误处理缺失
- 并发竞态条件
- 逻辑错误（条件判断反向、操作符优先级错误、变量遮蔽）

【文件】: ${chunk.file} (${chunk.language})
【代码上下文】:
\`\`\`${chunk.language}
${chunk.fullContext}
\`\`\`

【变更内容（diff）】:
\`\`\`diff
${chunk.diffContent}
\`\`\`

严格输出 JSON 数组（不要任何其他文字）:
[{"file":"文件路径","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"bug","message":"具体问题（中文）","suggestion":"修复后的完整代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    return extractJsonArray(raw);
  } catch {
    return [];
  }
};
```

- [ ] **Step 4: 实现其余 5 个 Agent（相同结构，不同 Prompt）**

`src/agents/security.agent.ts` — Prompt 聚焦：SQL 注入/XSS/CSRF/明文密钥/未鉴权路由/命令注入/路径穿越，`category: "security"`

`src/agents/performance.agent.ts` — Prompt 聚焦：N+1 查询/循环内同步 IO/内存泄漏/不必要的重复计算/大对象深拷贝，`category: "performance"`

`src/agents/style.agent.ts` — Prompt 聚焦：变量/函数命名不清晰/注释缺失/过长函数/重复代码/魔法数字，`category: "style"`

`src/agents/test.agent.ts` — Prompt 聚焦：新增代码是否缺少单元测试/现有测试是否覆盖新分支/测试用例是否有效，`category: "test"`

`src/agents/custom.agent.ts` — Prompt 动态拼入 `config.rules`，检查是否违反自定义规范，`category: "custom"`

（每个文件结构完全同 bug.agent.ts，只改 Prompt 内容和 category 字段注释）

- [ ] **Step 5: 运行 bug.agent 测试确认通过**

```bash
npx vitest run tests/agents/bug.agent.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agents/ tests/agents/
git commit -m "feat: 6 review agents (bug, security, performance, style, test, custom)"
```

---

### Task 5: Orchestrator（并发调度）+ Self-Critique Filter

**Files:**
- Create: `src/orchestrator/index.ts`
- Create: `src/filter/self-critique.ts`
- Create: `tests/orchestrator/index.test.ts`
- Create: `tests/filter/self-critique.test.ts`

**Interfaces:**
- Consumes: All 6 `AgentFn` from `src/agents/`; `callDeepSeek`, `extractJsonArray` from `src/agents/base.ts`
- Produces:
  ```typescript
  // src/orchestrator/index.ts
  export async function runOrchestrator(chunks: CodeChunk[], config: RepoConfig): Promise<ReviewComment[]>;
  // src/filter/self-critique.ts
  export async function selfCritique(comments: ReviewComment[], chunks: CodeChunk[], config: RepoConfig): Promise<ReviewComment[]>;
  ```

- [ ] **Step 1: 写 orchestrator 失败测试**

创建 `tests/orchestrator/index.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/agents/bug.agent.js', () => ({ bugAgent: vi.fn().mockResolvedValue([
  { file: 'a.ts', line: 1, side: 'RIGHT', severity: 'error', category: 'bug', message: 'bug found', confidence: 0.9 }
])}));
vi.mock('../../src/agents/security.agent.js', () => ({ securityAgent: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/agents/performance.agent.js', () => ({ performanceAgent: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/agents/style.agent.js', () => ({ styleAgent: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/agents/test.agent.js', () => ({ testAgent: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/agents/custom.agent.js', () => ({ customAgent: vi.fn().mockResolvedValue([]) }));

import { runOrchestrator } from '../../src/orchestrator/index.js';
import { parseRepoConfig } from '../../src/config/schema.js';
import type { CodeChunk } from '../../src/agents/types.js';

const chunk: CodeChunk = {
  file: 'a.ts', language: 'typescript',
  diffContent: '+const x = 1;', fullContext: 'const x = 1;',
  startLine: 1, endLine: 1, diffPosition: 1,
};

describe('runOrchestrator', () => {
  it('collects results from all agents', async () => {
    const config = parseRepoConfig({});
    const results = await runOrchestrator([chunk], config);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].category).toBe('bug');
  });

  it('handles empty chunks array', async () => {
    const config = parseRepoConfig({});
    const results = await runOrchestrator([], config);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/orchestrator/index.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 src/orchestrator/index.ts**

```typescript
import { bugAgent } from '../agents/bug.agent.js';
import { securityAgent } from '../agents/security.agent.js';
import { performanceAgent } from '../agents/performance.agent.js';
import { styleAgent } from '../agents/style.agent.js';
import { testAgent } from '../agents/test.agent.js';
import { customAgent } from '../agents/custom.agent.js';
import type { CodeChunk, ReviewComment } from '../agents/types.js';
import type { RepoConfig } from '../config/schema.js';

const ALL_AGENTS = [
  { name: 'bug', fn: bugAgent },
  { name: 'security', fn: securityAgent },
  { name: 'performance', fn: performanceAgent },
  { name: 'style', fn: styleAgent },
  { name: 'test', fn: testAgent },
  { name: 'custom', fn: customAgent },
];

export async function runOrchestrator(
  chunks: CodeChunk[],
  config: RepoConfig
): Promise<ReviewComment[]> {
  if (chunks.length === 0) return [];

  const allComments: ReviewComment[] = [];

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      ALL_AGENTS.map(agent => agent.fn(chunk, config))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        allComments.push(...result.value);
      } else {
        console.warn(`[ai-review] Agent "${ALL_AGENTS[i].name}" failed for ${chunk.file}:`, result.reason);
      }
    }
  }

  return allComments;
}
```

- [ ] **Step 4: 运行 orchestrator 测试**

```bash
npx vitest run tests/orchestrator/index.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: 写 self-critique 失败测试**

创建 `tests/filter/self-critique.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/agents/base.js', () => ({
  callDeepSeek: vi.fn().mockResolvedValue(
    '[{"file":"a.ts","line":1,"side":"RIGHT","severity":"error","category":"bug","message":"bug","confidence":0.9}]'
  ),
  extractJsonArray: (await import('../../src/agents/base.js')).extractJsonArray,
}));

import { selfCritique } from '../../src/filter/self-critique.js';
import { parseRepoConfig } from '../../src/config/schema.js';
import type { ReviewComment, CodeChunk } from '../../src/agents/types.js';

const comment: ReviewComment = {
  file: 'a.ts', line: 1, side: 'RIGHT',
  severity: 'error', category: 'bug',
  message: 'bug found', confidence: 0.9,
};
const chunk: CodeChunk = {
  file: 'a.ts', language: 'typescript',
  diffContent: '+const x = 1;', fullContext: 'const x = 1;',
  startLine: 1, endLine: 1, diffPosition: 1,
};

describe('selfCritique', () => {
  it('returns comments with confidence above threshold', async () => {
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([comment], [chunk], config);
    expect(result).toHaveLength(1);
  });

  it('filters out comments below threshold', async () => {
    const { callDeepSeek } = await import('../../src/agents/base.js');
    vi.mocked(callDeepSeek).mockResolvedValueOnce(
      '[{"file":"a.ts","line":1,"side":"RIGHT","severity":"error","category":"bug","message":"bug","confidence":0.3}]'
    );
    const config = parseRepoConfig({ selfCritiqueThreshold: 0.6 });
    const result = await selfCritique([comment], [chunk], config);
    expect(result).toHaveLength(0);
  });

  it('returns original comments on filter error', async () => {
    const { callDeepSeek } = await import('../../src/agents/base.js');
    vi.mocked(callDeepSeek).mockRejectedValueOnce(new Error('API error'));
    const config = parseRepoConfig({});
    const result = await selfCritique([comment], [chunk], config);
    expect(result).toEqual([comment]);
  });
});
```

- [ ] **Step 6: 运行 self-critique 测试确认失败**

```bash
npx vitest run tests/filter/self-critique.test.ts
```
Expected: FAIL

- [ ] **Step 7: 实现 src/filter/self-critique.ts**

```typescript
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
    const filtered = extractJsonArray(raw) as ReviewComment[];
    return filtered.filter(c => c.confidence >= config.selfCritiqueThreshold);
  } catch {
    console.warn('[ai-review] Self-critique filter failed, returning original comments');
    return comments;
  }
}
```

- [ ] **Step 8: 运行 self-critique 测试**

```bash
npx vitest run tests/filter/self-critique.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add src/orchestrator/ src/filter/ tests/orchestrator/ tests/filter/
git commit -m "feat: orchestrator and self-critique filter"
```

---

### Task 6: Summary Agent + Markdown Report Builder

**Files:**
- Create: `src/agents/summary.agent.ts`
- Create: `src/reporter/markdown.reporter.ts`
- Create: `tests/reporter/markdown.reporter.test.ts`

**Interfaces:**
- Consumes: `callDeepSeek` from `src/agents/base.ts`; `ReviewComment`, `PRSummary` from `src/agents/types.ts`
- Produces:
  ```typescript
  // src/agents/summary.agent.ts
  export async function summaryAgent(prTitle: string, files: ParsedFile[], config: RepoConfig): Promise<PRSummary>;
  // src/reporter/markdown.reporter.ts
  export function buildPRBody(summary: PRSummary, originalBody: string): string;
  export function buildInlineCommentBody(comment: ReviewComment): string;
  ```

- [ ] **Step 1: 写 markdown reporter 失败测试**

创建 `tests/reporter/markdown.reporter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildPRBody, buildInlineCommentBody } from '../../src/reporter/markdown.reporter.js';
import type { PRSummary, ReviewComment } from '../../src/agents/types.js';

const summary: PRSummary = {
  overview: '本次 PR 修复了用户认证 Bug。',
  walkthrough: [{ file: 'src/auth.ts', changes: '修复了 token 过期逻辑' }],
  mermaidDiagram: '',
};

describe('buildPRBody', () => {
  it('injects summary section into existing PR body', () => {
    const result = buildPRBody(summary, '原始 PR 描述');
    expect(result).toContain('原始 PR 描述');
    expect(result).toContain('AI Review 摘要');
    expect(result).toContain('本次 PR 修复了用户认证 Bug。');
  });

  it('replaces existing summary section on re-review', () => {
    const existingWithSummary = buildPRBody(summary, '原始描述');
    const newSummary = { ...summary, overview: '第二次 Review' };
    const result = buildPRBody(newSummary, existingWithSummary);
    expect(result).toContain('第二次 Review');
    expect(result).not.toContain('本次 PR 修复了用户认证 Bug。');
  });

  it('includes mermaid diagram when present', () => {
    const withDiagram = { ...summary, mermaidDiagram: 'sequenceDiagram\n  A->>B: hello' };
    const result = buildPRBody(withDiagram, '');
    expect(result).toContain('```mermaid');
  });
});

describe('buildInlineCommentBody', () => {
  it('formats error comment with emoji', () => {
    const comment: ReviewComment = {
      file: 'a.ts', line: 1, side: 'RIGHT',
      severity: 'error', category: 'bug',
      message: '空指针风险', confidence: 0.9,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('🔴');
    expect(result).toContain('空指针风险');
  });

  it('includes suggestion block when suggestion is provided', () => {
    const comment: ReviewComment = {
      file: 'a.ts', line: 1, side: 'RIGHT',
      severity: 'error', category: 'bug',
      message: '问题', suggestion: 'const x = value ?? default;', confidence: 0.9,
    };
    const result = buildInlineCommentBody(comment);
    expect(result).toContain('```suggestion');
    expect(result).toContain('const x = value ?? default;');
  });
});
```

- [ ] **Step 2: 运行 reporter 测试确认失败**

```bash
npx vitest run tests/reporter/markdown.reporter.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现 src/reporter/markdown.reporter.ts**

```typescript
import type { PRSummary, ReviewComment } from '../agents/types.js';

const SUMMARY_START = '<!-- ai-review-summary -->';
const SUMMARY_END = '<!-- /ai-review-summary -->';

const SEVERITY_EMOJI: Record<string, string> = {
  error: '🔴', warning: '🟡', info: '🔵',
};

const CATEGORY_LABEL: Record<string, string> = {
  bug: 'BUG', security: 'SECURITY', performance: 'PERF',
  style: 'STYLE', test: 'TEST', custom: 'RULE',
};

export function buildPRBody(summary: PRSummary, originalBody: string): string {
  // 移除旧的 summary section（幂等性）
  const cleanBody = originalBody
    .replace(new RegExp(`${SUMMARY_START}[\\s\\S]*?${SUMMARY_END}`, 'm'), '')
    .trim();

  const walkthroughTable = [
    '| 文件 | 变更内容 |',
    '|:---|:---|',
    ...summary.walkthrough.map(w => `| \`${w.file}\` | ${w.changes} |`),
  ].join('\n');

  const mermaidSection = summary.mermaidDiagram
    ? `\n### 🔄 调用流程\n\n\`\`\`mermaid\n${summary.mermaidDiagram}\n\`\`\``
    : '';

  const summarySection = `\n\n${SUMMARY_START}\n## 🤖 AI Review 摘要\n\n${summary.overview}\n\n### 📋 变更清单\n\n${walkthroughTable}${mermaidSection}\n${SUMMARY_END}`;

  return cleanBody ? `${cleanBody}${summarySection}` : summarySection.trimStart();
}

export function buildInlineCommentBody(comment: ReviewComment): string {
  const emoji = SEVERITY_EMOJI[comment.severity] ?? '🔵';
  const label = CATEGORY_LABEL[comment.category] ?? comment.category.toUpperCase();

  let body = `${emoji} **[${label}]** ${comment.message}`;

  if (comment.suggestion) {
    body += `\n\n\`\`\`suggestion\n${comment.suggestion}\n\`\`\``;
  }

  return body;
}
```

- [ ] **Step 4: 实现 src/agents/summary.agent.ts**

```typescript
import { callDeepSeek } from './base.js';
import type { PRSummary } from './types.js';
import type { ParsedFile } from '../parser/diff.parser.js';
import type { RepoConfig } from '../config/schema.js';

export async function summaryAgent(
  prTitle: string,
  files: ParsedFile[],
  _config: RepoConfig
): Promise<PRSummary> {
  const diffSummary = files.slice(0, 10).map(f =>
    `### ${f.filePath}\n${f.hunks.map(h => h.rawHunk.slice(0, 300)).join('\n')}`
  ).join('\n\n');

  const prompt = `你是一位技术文档专家。请根据以下 PR 代码变更，生成简洁的 PR 审查摘要。

【PR 标题】: ${prTitle}
【变更文件和 diff（前10个文件）】:
${diffSummary}

严格输出以下 JSON 格式（只输出 JSON，不要任何其他内容）:
{
  "overview": "1-3 句话概述 PR 目的和主要改动（中文）",
  "walkthrough": [{"file": "文件路径", "changes": "该文件变更的一句话描述（中文）"}],
  "mermaidDiagram": "如果涉及明显的函数调用链或状态流转则生成 Mermaid sequenceDiagram，否则输出空字符串"
}`;

  const defaultSummary: PRSummary = {
    overview: '本次 PR 包含代码变更，详见下方变更清单。',
    walkthrough: files.map(f => ({ file: f.filePath, changes: '代码变更' })),
    mermaidDiagram: '',
  };

  try {
    const raw = await callDeepSeek(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return defaultSummary;
    const parsed = JSON.parse(match[0]) as PRSummary;
    return parsed;
  } catch {
    return defaultSummary;
  }
}
```

- [ ] **Step 5: 运行 reporter 测试**

```bash
npx vitest run tests/reporter/markdown.reporter.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/agents/summary.agent.ts src/reporter/ tests/reporter/
git commit -m "feat: summary agent and markdown report builder"
```

---

### Task 7: GitHub 集成（Octokit + Diff Fetcher + Publisher）

**Files:**
- Create: `src/github/octokit.ts`
- Create: `src/github/diff.fetcher.ts`
- Create: `src/github/publisher.ts`
- Create: `tests/github/publisher.test.ts`

**Interfaces:**
- Consumes: `buildPRBody`, `buildInlineCommentBody` from `src/reporter/markdown.reporter.ts`; `ReviewComment`, `PRSummary` from `src/agents/types.ts`
- Produces:
  ```typescript
  // src/github/octokit.ts
  export function getOctokit(installationId: number): Promise<Octokit>;

  // src/github/diff.fetcher.ts
  export interface PRContext { owner: string; repo: string; prNumber: number; prTitle: string; installationId: number; }
  export async function fetchPRDiff(ctx: PRContext): Promise<{ rawDiff: string; fileContents: Map<string, string>; }>;

  // src/github/publisher.ts
  export async function publishReview(ctx: PRContext, summary: PRSummary, comments: ReviewComment[]): Promise<void>;
  ```

- [ ] **Step 1: 实现 src/github/octokit.ts**

```typescript
import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

let appInstance: App | null = null;

function getApp(): App {
  if (!appInstance) {
    const privateKey = (process.env.GITHUB_PRIVATE_KEY ?? '')
      .replace(/\\n/g, '\n'); // 支持环境变量中的转义换行
    appInstance = new App({
      appId: process.env.GITHUB_APP_ID ?? '',
      privateKey,
      webhooks: { secret: process.env.GITHUB_WEBHOOK_SECRET ?? '' },
    });
  }
  return appInstance;
}

export async function getOctokit(installationId: number): Promise<Octokit> {
  const app = getApp();
  return app.getInstallationOctokit(installationId) as unknown as Octokit;
}
```

- [ ] **Step 2: 实现 src/github/diff.fetcher.ts**

```typescript
import { getOctokit } from './octokit.js';

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  installationId: number;
}

export async function fetchPRDiff(ctx: PRContext): Promise<{
  rawDiff: string;
  fileContents: Map<string, string>;
  originalBody: string;
}> {
  const octokit = await getOctokit(ctx.installationId);

  // 获取 PR diff
  const { data: diffData } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    mediaType: { format: 'diff' },
  });
  const rawDiff = diffData as unknown as string;

  // 获取 PR 当前 body（用于幂等更新）
  const { data: pr } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
  });
  const originalBody = pr.body ?? '';

  // 获取变更文件列表，读取每个文件的完整内容（用于 AST 上下文扩充）
  const { data: files } = await octokit.pulls.listFiles({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    per_page: 100,
  });

  const fileContents = new Map<string, string>();
  await Promise.allSettled(
    files
      .filter(f => f.status !== 'removed')
      .slice(0, 20) // 最多 20 个文件
      .map(async f => {
        try {
          const { data } = await octokit.repos.getContent({
            owner: ctx.owner,
            repo: ctx.repo,
            path: f.filename,
            ref: pr.head.sha,
          });
          if ('content' in data && data.content) {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            fileContents.set(f.filename, content);
          }
        } catch {
          // 忽略单个文件读取失败
        }
      })
  );

  return { rawDiff, fileContents, originalBody };
}
```

- [ ] **Step 3: 写 publisher 失败测试**

创建 `tests/github/publisher.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockOctokit = {
  pulls: {
    update: vi.fn().mockResolvedValue({}),
    createReview: vi.fn().mockResolvedValue({}),
    listReviewComments: vi.fn().mockResolvedValue({ data: [] }),
  },
  issues: {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
  },
};

vi.mock('../../src/github/octokit.js', () => ({
  getOctokit: vi.fn().mockResolvedValue(mockOctokit),
}));

import { publishReview } from '../../src/github/publisher.js';
import type { PRSummary, ReviewComment } from '../../src/agents/types.js';

const ctx = { owner: 'test', repo: 'repo', prNumber: 1, prTitle: 'Test PR', installationId: 123 };
const summary: PRSummary = { overview: 'test', walkthrough: [], mermaidDiagram: '' };
const comments: ReviewComment[] = [{
  file: 'src/a.ts', line: 5, side: 'RIGHT',
  severity: 'error', category: 'bug',
  message: 'test bug', confidence: 0.9,
}];

describe('publishReview', () => {
  it('calls octokit.pulls.update to set PR body', async () => {
    await publishReview(ctx, summary, 'original body', comments);
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test', repo: 'repo', pull_number: 1 })
    );
  });

  it('calls createReview with inline comments', async () => {
    await publishReview(ctx, summary, '', comments);
    expect(mockOctokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ comments: expect.any(Array) })
    );
  });
});
```

- [ ] **Step 4: 运行 publisher 测试确认失败**

```bash
npx vitest run tests/github/publisher.test.ts
```
Expected: FAIL

- [ ] **Step 5: 实现 src/github/publisher.ts**

```typescript
import { getOctokit } from './octokit.js';
import { buildPRBody, buildInlineCommentBody } from '../reporter/markdown.reporter.js';
import type { PRSummary, ReviewComment } from '../agents/types.js';
import type { PRContext } from './diff.fetcher.js';

export async function publishReview(
  ctx: PRContext,
  summary: PRSummary,
  originalBody: string,
  comments: ReviewComment[]
): Promise<void> {
  const octokit = await getOctokit(ctx.installationId);

  // 1. 更新 PR Body（插入/替换 Summary section）
  const newBody = buildPRBody(summary, originalBody);
  await octokit.pulls.update({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    body: newBody,
  });

  // 2. 发布行级 Inline Review Comments
  if (comments.length > 0) {
    const reviewComments = comments.map(c => ({
      path: c.file,
      position: c.diffPosition ?? 1, // fallback to 1 if missing
      body: buildInlineCommentBody(c),
    }));

    // 补全 diffPosition（从 comment 里取，如果 comment 里没有则忽略）
    const validComments = reviewComments.filter(c => c.position > 0);

    await octokit.pulls.createReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.prNumber,
      event: 'COMMENT',
      comments: validComments,
    });
  }
}
```

- [ ] **Step 6: 运行 publisher 测试**

```bash
npx vitest run tests/github/publisher.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add src/github/ tests/github/
git commit -m "feat: GitHub octokit, diff fetcher and review publisher"
```

---

### Task 8: Review Pipeline（把所有模块串联）

**Files:**
- Create: `src/pipeline.ts`
- Create: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: All previous modules
- Produces:
  ```typescript
  export async function runReviewPipeline(ctx: PRContext): Promise<void>;
  ```

- [ ] **Step 1: 实现 src/pipeline.ts**

```typescript
import { fetchPRDiff } from './github/diff.fetcher.js';
import { parseDiff } from './parser/diff.parser.js';
import { chunkFiles } from './parser/chunker.js';
import { loadRepoConfig } from './config/loader.js';
import { runOrchestrator } from './orchestrator/index.js';
import { selfCritique } from './filter/self-critique.js';
import { summaryAgent } from './agents/summary.agent.js';
import { publishReview } from './github/publisher.js';
import type { PRContext } from './github/diff.fetcher.js';

export async function runReviewPipeline(ctx: PRContext): Promise<void> {
  console.log(`[ai-review] Starting review for PR #${ctx.prNumber} in ${ctx.owner}/${ctx.repo}`);

  // 1. 获取 diff + 文件内容
  const { rawDiff, fileContents, originalBody } = await fetchPRDiff(ctx);

  // 2. TODO: 从仓库读取 .ai-review.yml（暂时使用默认配置）
  const config = loadRepoConfig(null);

  // 3. 解析 diff
  const parsedFiles = parseDiff(rawDiff);

  // 4. 过滤排除文件
  // （简单实现：可后续集成 micromatch 做 glob 匹配）
  const filteredFiles = parsedFiles.filter(f =>
    !config.exclude.some(pattern => f.filePath.endsWith(pattern.replace('*', '')))
  );

  // 5. 按 maxFilesPerReview 限制
  const limitedFiles = filteredFiles.slice(0, config.maxFilesPerReview);
  if (filteredFiles.length > config.maxFilesPerReview) {
    console.warn(`[ai-review] 文件数超限，只审查前 ${config.maxFilesPerReview} 个文件`);
  }

  // 6. 语法感知分块
  const chunks = chunkFiles(limitedFiles, fileContents);

  // 7. 并发 6 Agent 审查
  const rawComments = await runOrchestrator(chunks, config);

  // 8. Self-Critique 二阶过滤
  const filteredComments = await selfCritique(rawComments, chunks, config);

  // 9. 生成 PR Summary（并发，不阻塞 review comments）
  const [summary] = await Promise.allSettled([
    summaryAgent(ctx.prTitle, limitedFiles, config),
  ]);
  const prSummary = summary.status === 'fulfilled'
    ? summary.value
    : { overview: 'AI Review 完成。', walkthrough: [], mermaidDiagram: '' };

  // 10. 发布到 GitHub
  await publishReview(ctx, prSummary, originalBody, filteredComments);

  console.log(`[ai-review] Review complete: ${filteredComments.length} comments published`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pipeline.ts
git commit -m "feat: review pipeline orchestrating all modules"
```

---

### Task 9: Webhook Server（Express）

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/webhook.handler.ts`

- [ ] **Step 1: 实现 src/server/webhook.handler.ts**

```typescript
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { runReviewPipeline } from '../pipeline.js';
import type { PRContext } from '../github/diff.fetcher.js';

function verifySignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody: Buffer = req.body; // 需要 express.raw() middleware

  if (!verifySignature(rawBody, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = req.headers['x-github-event'] as string;
  const payload = JSON.parse(rawBody.toString('utf-8'));

  // 只处理 PR opened / synchronize 事件
  if (event !== 'pull_request' || !['opened', 'synchronize'].includes(payload.action)) {
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  // Draft PR 跳过
  if (payload.pull_request?.draft) {
    res.status(200).json({ message: 'Draft PR skipped' });
    return;
  }

  // 立即返回 200（GitHub 要求 10 秒内响应）
  res.status(200).json({ message: 'Review started' });

  // 后台异步执行 Review Pipeline
  const ctx: PRContext = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    prNumber: payload.pull_request.number,
    prTitle: payload.pull_request.title,
    installationId: payload.installation.id,
  };

  setImmediate(() => {
    runReviewPipeline(ctx).catch(err => {
      console.error('[ai-review] Pipeline error:', err);
    });
  });
}
```

- [ ] **Step 2: 实现 src/server/app.ts**

```typescript
import express from 'express';
import { webhookHandler } from './webhook.handler.js';

const app = express();

// 使用 raw body（保留原始 Buffer 用于 HMAC 验证）
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.post('/webhook', webhookHandler);

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
  console.log(`[ai-review] Server listening on port ${PORT}`);
});

export default app;
```

- [ ] **Step 3: 本地测试启动**

```bash
# 复制环境变量模板
cp .env.example .env
# 填入你的 DeepSeek API Key（最少需要这个来测试）
# 启动开发服务器
npm run dev
```

预期：看到 `[ai-review] Server listening on port 3000`

- [ ] **Step 4: 测试 health 端点**

```bash
curl http://localhost:3000/health
```
Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 5: Commit**

```bash
git add src/server/
git commit -m "feat: express webhook server with HMAC verification"
```

---

### Task 10: 示例配置文件 + README

**Files:**
- Create: `.ai-review.yml`
- Create: `README.md`

- [ ] **Step 1: 创建 .ai-review.yml**

```yaml
# ai-review 配置文件
# 将此文件放到需要 Review 的仓库根目录

language: zh  # zh | en

# 公司自定义规范（违反时会被 custom agent 报告为 error）
rules:
  - "所有公共 API 函数必须有 JSDoc 注释"
  - "禁止在生产代码中使用 console.log，请使用统一日志库"
  - "数据库查询必须使用参数化查询，禁止字符串拼接"
  - "所有异步函数必须有 try-catch 或在调用方处理 Promise rejection"

# 排除文件（在默认排除规则基础上追加）
exclude:
  - "*.snap"
  - "coverage/**"
  - "__mocks__/**"

# 各维度的严重级别覆盖（默认值见文档）
# severityOverride:
#   style: warning

# Self-Critique 过滤阈值（0-1，越高越严格，默认 0.6）
selfCritiqueThreshold: 0.65

# 单次 Review 最多审查文件数（默认 20）
maxFilesPerReview: 20
```

- [ ] **Step 2: 创建 README.md**

包含：项目介绍、快速开始（GitHub App 注册步骤）、环境变量配置说明、.ai-review.yml 配置说明、本地开发指南。

- [ ] **Step 3: 运行全量测试**

```bash
npm test
```
Expected: 全部通过

- [ ] **Step 4: 最终 Commit**

```bash
git add .ai-review.yml README.md
git commit -m "docs: add example config and README"
git tag v0.1.0
```

---

## 实现完成检查清单

- [ ] `npm test` 全部通过，覆盖率 ≥ 80%
- [ ] `npm run dev` 启动后 `/health` 返回 200
- [ ] 可以用 [smee.io](https://smee.io) 或 ngrok 本地接收 GitHub Webhook 并触发 Pipeline
- [ ] PR 页面出现 AI Review 摘要 + Mermaid 图
- [ ] 行级 Inline Comment 带有 `suggestion` 块
- [ ] `.ai-review.yml` 中的自定义规范被 CustomRulesAgent 正确应用
