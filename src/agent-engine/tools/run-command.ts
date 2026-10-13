import { exec } from 'node:child_process';
import type { ToolResult } from './types.js';

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[/~]/i,
  /\brmdir\s+\/s\s+\/q\s+[c-z]:\\/i,
  /\bmkfs\b/i,
  /\bformat\s+[c-z]:/i,
  /\bshutdown\b/i,
  /\bdrop\s+database\b/i,
];

export async function runCommandTool(
  cwd: string,
  args: { command: string; timeoutMs?: number }
): Promise<ToolResult> {
  const cmd = args.command?.trim();
  if (!cmd) {
    return { success: false, output: '错误: 必须提供待执行的命令 command', error: '缺少命令参数' };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        success: false,
        output: `安全拦截: 命令包含高危破坏性指令，已拒绝执行: "${cmd}"`,
        error: '高危命令已被安全拦截',
        exitCode: 126
      };
    }
  }

  const timeout = args.timeoutMs || 45000;

  return new Promise((resolve) => {
    try {
      exec(cmd, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const outStr = (stdout || '').toString();
        const errStr = (stderr || '').toString();
        const exitCode = err && typeof err.code === 'number' ? err.code : (err ? 1 : 0);

        const truncate = (s: string, limit = 4000) => {
          if (s.length <= limit) return s;
          return s.slice(0, limit) + `\n... (输出过长，已截断剩余 ${s.length - limit} 字符)`;
        };

        const combinedOutput = [
          outStr ? truncate(outStr) : '',
          errStr ? `[stderr]\n${truncate(errStr)}` : ''
        ].filter(Boolean).join('\n') || (exitCode === 0 ? '(命令执行完成，无控制台输出)' : `(命令退出码: ${exitCode})`);

        resolve({
          success: exitCode === 0,
          exitCode,
          stdout: outStr,
          stderr: errStr,
          output: combinedOutput
        });
      });
    } catch (err: any) {
      resolve({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        output: `执行命令失败: ${err.message}`,
        error: err.message
      });
    }
  });
}
