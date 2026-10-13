import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from './types.js';

export async function readFileTool(
  cwd: string,
  args: { path: string; startLine?: number; endLine?: number }
): Promise<ToolResult> {
  const relPath = args.path;
  if (!relPath || typeof relPath !== 'string') {
    return { success: false, output: '错误: 必须提供文件相对路径 path', error: '缺少路径参数' };
  }

  const resolved = path.resolve(cwd, relPath);
  const root = path.resolve(cwd);

  if (!resolved.startsWith(root)) {
    return { success: false, output: `安全错误: 路径越界，禁止访问工作区外部文件: ${relPath}`, error: '路径越界' };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, output: `文件不存在: ${relPath}`, error: `文件不存在: ${relPath}` };
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return { success: false, output: `指定路径不是文件: ${relPath}`, error: '路径不是文件' };
    }

    const fileContent = fs.readFileSync(resolved, 'utf-8');
    const lines = fileContent.split(/\r?\n/);
    const totalLines = lines.length;

    let start = typeof args.startLine === 'number' && args.startLine >= 1 ? args.startLine : 1;
    let end = typeof args.endLine === 'number' && args.endLine >= start ? args.endLine : totalLines;

    if (start > totalLines) {
      start = totalLines;
    }
    if (end > totalLines) {
      end = totalLines;
    }

    const maxLines = 500;
    if (end - start + 1 > maxLines) {
      end = start + maxLines - 1;
    }

    const selectedLines = lines.slice(start - 1, end);
    const formatted = selectedLines
      .map((line, idx) => `L${start + idx}: ${line}`)
      .join('\n');

    return {
      success: true,
      output: `--- 文件: ${relPath} (第 ${start} 行至第 ${end} 行，共 ${totalLines} 行) ---\n${formatted}`,
      content: formatted,
      totalLines,
      linesShown: `${start}-${end}`
    };
  } catch (err: any) {
    return { success: false, output: `读取文件失败: ${err.message}`, error: err.message };
  }
}
