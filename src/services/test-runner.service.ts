import { exec } from 'node:child_process';

export interface TestRunResult {
  command: string;
  exitCode: number;
  success: boolean;
  durationMs: number;
  passed: number;
  failed: number;
  total: number;
  outputSnippet: string;
  timedOut?: boolean;
}

export class TestRunnerService {
  /**
   * 解析测试输出文本 (匹配 Vitest, Jest 等测试输出格式)
   */
  parseTestOutput(rawOutput: string, exitCode: number, durationMs: number): TestRunResult {
    let passed = 0;
    let failed = 0;
    let total = 0;

    // 匹配 Vitest/Jest: Tests  2 failed | 10 passed (12)
    const complexMatch = rawOutput.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(?:(\d+)\s+passed)?(?:\s+\((\d+)\))?/i);
    if (complexMatch) {
      failed = complexMatch[1] ? parseInt(complexMatch[1], 10) : 0;
      passed = complexMatch[2] ? parseInt(complexMatch[2], 10) : 0;
      total = complexMatch[3] ? parseInt(complexMatch[3], 10) : (passed + failed);
    } else {
      // 简单匹配: Tests  12 passed (12) 或 12 passed
      const passMatch = rawOutput.match(/(\d+)\s+passed/i);
      const failMatch = rawOutput.match(/(\d+)\s+failed/i);

      if (passMatch) passed = parseInt(passMatch[1], 10);
      if (failMatch) failed = parseInt(failMatch[1], 10);
      total = passed + failed;
    }

    // Do not manufacture a passed test for a silent exit 0.
    // An empty/unrecognized summary means the case count is unknown.
    if (total === 0) {
      passed = 0;
      failed = 0;
    }

    // 提取最后 30 行或 1500 字符作为 snippet
    const lines = rawOutput.trim().split('\n');
    const snippetLines = lines.slice(-30);
    const outputSnippet = snippetLines.join('\n').slice(-1500);

    return {
      command: '',
      exitCode,
      success: exitCode === 0,
      durationMs,
      passed,
      failed,
      total,
      outputSnippet
    };
  }

  /**
   * 运行测试套件
   */
  runTestSuite(cwd: string, cmd = 'npm test', timeoutMs = 60000): Promise<TestRunResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const combined = `${stdout}\n${stderr}`;
        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        const timedOut = !!(error && error.killed);

        const result = this.parseTestOutput(combined, exitCode, durationMs);
        result.command = cmd;
        result.timedOut = timedOut;
        resolve(result);
      });
    });
  }
}
