import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readFileTool,
  editFileTool,
  runCommandTool,
  searchCodeTool,
  listDirTool,
  AGENT_TOOLS,
  executeAgentTool,
} from '../../src/agent-engine/tools/index.js';

describe('Agent Toolbox (原子工具箱)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('read_file', () => {
    it('读取文件并带上行号，支持起止行切片', async () => {
      const filePath = path.join(tmpDir, 'demo.txt');
      fs.writeFileSync(filePath, 'line 1\nline 2\nline 3\nline 4\nline 5\n', 'utf-8');

      const fullRes = await readFileTool(tmpDir, { path: 'demo.txt' });
      expect(fullRes.success).toBe(true);
      expect(fullRes.content).toContain('L1: line 1');
      expect(fullRes.content).toContain('L5: line 5');

      const sliceRes = await readFileTool(tmpDir, { path: 'demo.txt', startLine: 2, endLine: 4 });
      expect(sliceRes.success).toBe(true);
      expect(sliceRes.content).toContain('L2: line 2');
      expect(sliceRes.content).toContain('L4: line 4');
      expect(sliceRes.content).not.toContain('L1: line 1');
      expect(sliceRes.content).not.toContain('L5: line 5');
    });

    it('文件不存在或路径越界时安全报错', async () => {
      const notFound = await readFileTool(tmpDir, { path: 'not-exist.txt' });
      expect(notFound.success).toBe(false);
      expect(notFound.error).toContain('不存在');

      const traverse = await readFileTool(tmpDir, { path: '../../evil.txt' });
      expect(traverse.success).toBe(false);
      expect(traverse.error).toContain('越界');
    });
  });

  describe('edit_file (Aider 范式精准替换)', () => {
    it('精准替换单个匹配块并落盘', async () => {
      const filePath = path.join(tmpDir, 'sample.ts');
      fs.writeFileSync(
        filePath,
        'function calc(a: number) {\n  const res = a * 2;\n  return res;\n}\n',
        'utf-8'
      );

      const res = await editFileTool(tmpDir, {
        path: 'sample.ts',
        targetContent: '  const res = a * 2;',
        replacementContent: '  const res = a * 10;\n  console.log(res);',
      });

      expect(res.success).toBe(true);
      const after = fs.readFileSync(filePath, 'utf-8');
      expect(after).toContain('const res = a * 10;');
      expect(after).not.toContain('const res = a * 2;');
    });

    it('未找到 targetContent 时报错提示', async () => {
      const filePath = path.join(tmpDir, 'sample.ts');
      fs.writeFileSync(filePath, 'hello world\n', 'utf-8');

      const res = await editFileTool(tmpDir, {
        path: 'sample.ts',
        targetContent: 'non existent content',
        replacementContent: 'replacement',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('未找到');
    });

    it('存在多处重复 targetContent 时要求提供更多上下文', async () => {
      const filePath = path.join(tmpDir, 'sample.ts');
      fs.writeFileSync(filePath, 'const x = 1;\nconst x = 1;\n', 'utf-8');

      const res = await editFileTool(tmpDir, {
        path: 'sample.ts',
        targetContent: 'const x = 1;',
        replacementContent: 'const x = 2;',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('多处匹配');
    });
  });

  describe('run_command', () => {
    it('执行命令并返回 exitCode, stdout 与 stderr', async () => {
      const res = await runCommandTool(tmpDir, { command: 'node -e "console.log(\'hello-agent\')"' });
      expect(res.success).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('hello-agent');
    });

    it('命令失败时捕获非零 exitCode', async () => {
      const res = await runCommandTool(tmpDir, { command: 'node -e "process.exit(2)"' });
      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(2);
    });

    it('拦截高危破坏性命令', async () => {
      const res = await runCommandTool(tmpDir, { command: 'rm -rf /' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('高危命令');
    });
  });


  describe('live command output', () => {
    it('forwards stdout/stderr before command completion with the actual exit code', async () => {
      const chunks: Array<{ stream: string; chunk: string }> = [];
      const res = await runCommandTool(tmpDir, {
        command: 'node -e "process.stdout.write(\'compile-start\\n\'); setTimeout(() => { console.error(\'compile-error\'); process.exit(3); }, 80)"'
      }, { onOutput: (stream, chunk) => chunks.push({ stream, chunk }) });
      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(3);
      expect(res.durationMs).toBeGreaterThan(0);
      expect(chunks.some(item => item.stream === 'stdout' && item.chunk.includes('compile-start'))).toBe(true);
      expect(chunks.some(item => item.stream === 'stderr' && item.chunk.includes('compile-error'))).toBe(true);
    });
  });
  describe('search_code', () => {
    it('在目录下递归搜索匹配行', async () => {
      const f1 = path.join(tmpDir, 'a.ts');
      const f2 = path.join(tmpDir, 'b.ts');
      fs.writeFileSync(f1, 'export const secret = 12345;\n', 'utf-8');
      fs.writeFileSync(f2, 'const nothing = 0;\n', 'utf-8');

      const res = await searchCodeTool(tmpDir, { query: 'secret' });
      expect(res.success).toBe(true);
      expect(res.matches.length).toBe(1);
      expect(res.matches[0].file).toBe('a.ts');
      expect(res.matches[0].line).toBe(1);
    });
  });

  describe('list_dir', () => {
    it('列出指定目录下子文件与子目录', async () => {
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hi');

      const res = await listDirTool(tmpDir, {});
      expect(res.success).toBe(true);
      expect(res.entries.some((e: any) => e.name === 'subdir' && e.isDirectory)).toBe(true);
      expect(res.entries.some((e: any) => e.name === 'file.txt' && !e.isDirectory)).toBe(true);
    });
  });

  describe('executeAgentTool 调度器与 AGENT_TOOLS 规范', () => {
    it('提供标准的 OpenAI 兼容 tools 契约', () => {
      expect(Array.isArray(AGENT_TOOLS)).toBe(true);
      expect(AGENT_TOOLS.length).toBe(5);
      const toolNames = AGENT_TOOLS.map((t: any) => t.function.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('run_command');
      expect(toolNames).toContain('search_code');
      expect(toolNames).toContain('list_dir');
    });

    it('通过统一门面 executeAgentTool 调度工具', async () => {
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello dispatcher');
      const res = await executeAgentTool(tmpDir, 'read_file', { path: 'test.txt' });
      expect(res.success).toBe(true);
      expect(res.output).toContain('hello dispatcher');
    });
  });
});
