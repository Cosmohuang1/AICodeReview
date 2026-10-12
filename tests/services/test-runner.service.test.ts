import { describe, it, expect } from 'vitest';
import { TestRunnerService } from '../../src/services/test-runner.service.js';
import path from 'node:path';

describe('TestRunnerService', () => {
  it('正确解析成功的测试命令输出 (vitest 模拟输出)', () => {
    const runner = new TestRunnerService();
    const vitestOutput = `
 RUN  v1.6.1 C:/Users/admin/scratch/ai-review

 ✓ tests/config/loader.test.ts  (7 tests) 15ms
 ✓ tests/services/git.service.test.ts  (5 tests) 20ms

 Test Files  2 passed (2)
      Tests  12 passed (12)
   Duration  1.25s
`;
    const parsed = runner.parseTestOutput(vitestOutput, 0, 1250);
    expect(parsed.success).toBe(true);
    expect(parsed.passed).toBe(12);
    expect(parsed.failed).toBe(0);
    expect(parsed.total).toBe(12);
    expect(parsed.durationMs).toBe(1250);
  });

  it('正确解析包含失败用例的测试输出', () => {
    const runner = new TestRunnerService();
    const vitestFailOutput = `
 ❯ tests/services/sample.test.ts > fails assertion
     AssertionError: expected false to be true

 Test Files  1 failed (1)
      Tests  2 failed | 10 passed (12)
   Duration  850ms
`;
    const parsed = runner.parseTestOutput(vitestFailOutput, 1, 850);
    expect(parsed.success).toBe(false);
    expect(parsed.failed).toBe(2);
    expect(parsed.passed).toBe(10);
    expect(parsed.total).toBe(12);
  });

  it('真实执行 node 命令测试', async () => {
    const runner = new TestRunnerService();
    // 运行一个快速的 node 命令模拟测试
    const result = await runner.runTestSuite(process.cwd(), 'node -e "console.log(\'1 passed\'); process.exit(0)"');
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('捕获命令执行失败与非 0 退出码', async () => {
    const runner = new TestRunnerService();
    const result = await runner.runTestSuite(process.cwd(), 'node -e "console.error(\'SyntaxError\'); process.exit(1)"');
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
    expect(result.outputSnippet).toContain('SyntaxError');
  });
});
