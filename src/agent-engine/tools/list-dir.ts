import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from './types.js';

export async function listDirTool(
  cwd: string,
  args: { path?: string }
): Promise<ToolResult> {
  const relPath = args.path || '.';
  const targetDir = path.resolve(cwd, relPath);
  const root = path.resolve(cwd);

  if (!targetDir.startsWith(root)) {
    return { success: false, output: '安全错误: 目录越界', error: '路径越界' };
  }

  if (!fs.existsSync(targetDir)) {
    return { success: false, output: `目录不存在: ${relPath}`, error: '目录不存在' };
  }

  try {
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      return { success: false, output: `指定路径不是目录: ${relPath}`, error: '不是目录' };
    }

    const rawEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    const entries: Array<{ name: string; isDirectory: boolean; isGit?: boolean }> = [];

    for (const e of rawEntries) {
      if (e.name.startsWith('$') || e.name === 'node_modules' || e.name === '.git') continue;
      const isDir = e.isDirectory();
      let isGit = false;
      if (isDir) {
        try {
          isGit = fs.existsSync(path.join(targetDir, e.name, '.git'));
        } catch {
          // ignore
        }
      }
      entries.push({ name: e.name, isDirectory: isDir, isGit });
    }

    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const lines = entries.map(e => `${e.isDirectory ? '[DIR] ' : '      '}${e.name}${e.isGit ? ' (git)' : ''}`);

    return {
      success: true,
      currentDir: path.relative(cwd, targetDir) || '.',
      entries,
      output: `--- 目录: ${relPath} (${entries.length} 项) ---\n` + lines.join('\n')
    };
  } catch (err: any) {
    return { success: false, output: `读取目录失败: ${err.message}`, error: err.message };
  }
}
