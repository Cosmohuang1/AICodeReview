import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runReactEngine } from '../../src/agent-engine/react-engine.js';
import { ReactStreamer } from '../../src/agent-engine/react-streamer.js';

describe('ReactEngine (自主 ReAct 自愈循环引擎)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-engine-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('模型直接回答无须修改代码时优雅退出', async () => {
    const streamer = new ReactStreamer();
    const mockLlm = vi.fn().mockResolvedValue({
      role: 'assistant',
      content: '你好！我是智能体，随时可以为你编写和审查代码。',
      tool_calls: []
    });

    const result = await runReactEngine({
      cwd: tmpDir,
      prompt: '你好',
      maxSteps: 3,
      streamer,
      autoCommit: false,
      llmCaller: mockLlm
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('你好');
    expect(mockLlm).toHaveBeenCalledTimes(1);
  });

  it('自主调用 edit_file 并根据测试错误自愈修复', async () => {
    const streamer = new ReactStreamer();
    const codeFile = path.join(tmpDir, 'math.js');
    fs.writeFileSync(codeFile, 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n');

    // 模拟多轮调用：
    // Step 1: 模型调用 edit_file 修正代码
    // Step 2: 模型完成并给出结论
    const mockLlm = vi.fn()
      .mockResolvedValueOnce({
        role: 'assistant',
        content: '我发现减号写错了，正在调用 edit_file 修复为加号。',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'edit_file',
              arguments: JSON.stringify({
                path: 'math.js',
                targetContent: 'return a - b;',
                replacementContent: 'return a + b;'
              })
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        role: 'assistant',
        content: '代码已修复完成，add 函数现在正确执行加法运算。',
        tool_calls: []
      });

    const result = await runReactEngine({
      cwd: tmpDir,
      prompt: '修复 math.js 里的加法函数',
      maxSteps: 5,
      streamer,
      autoCommit: false,
      llmCaller: mockLlm
    });

    // No project test manifest exists in this fixture. Editing works but
    // success must not be reported until a real regression test has passed.
    expect(result.success).toBe(false);
    expect(result.regressionStatus).toMatch(/找不到可运行的项目测试/);
    expect(result.projectTesting?.status).toBe('no-tests');
    expect(mockLlm).toHaveBeenCalledTimes(2);
    const updated = fs.readFileSync(codeFile, 'utf-8');
    expect(updated).toContain('return a + b;');
  });

  it('收到中止信号时提前退出', async () => {
    const streamer = new ReactStreamer();
    const sessionId = 'test-abort-session';
    const mockLlm = vi.fn().mockImplementation(async () => {
      streamer.abortSession(sessionId);
      return {
        role: 'assistant',
        content: '正在规划...',
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'list_dir', arguments: '{}' }
          }
        ]
      };
    });

    const result = await runReactEngine({
      cwd: tmpDir,
      prompt: '执行耗时任务',
      sessionId,
      maxSteps: 5,
      streamer,
      autoCommit: false,
      llmCaller: mockLlm
    });

    expect(result.aborted).toBe(true);
  });
});
