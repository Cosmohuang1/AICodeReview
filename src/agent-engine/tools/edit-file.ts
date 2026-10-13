import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from './types.js';

export async function editFileTool(
  cwd: string,
  args: { path: string; targetContent: string; replacementContent: string }
): Promise<ToolResult> {
  const relPath = args.path;
  if (!relPath || typeof relPath !== 'string') {
    return { success: false, output: '错误: 必须提供待修改文件路径 path', error: '缺少路径参数' };
  }
  if (typeof args.targetContent !== 'string') {
    return { success: false, output: '错误: 必须提供待替换的代码片段 targetContent', error: '缺少 targetContent' };
  }
  if (typeof args.replacementContent !== 'string') {
    return { success: false, output: '错误: 必须提供新代码片段 replacementContent', error: '缺少 replacementContent' };
  }

  const resolved = path.resolve(cwd, relPath);
  const root = path.resolve(cwd);

  if (!resolved.startsWith(root)) {
    return { success: false, output: `安全错误: 路径越界，禁止修改工作区外部文件: ${relPath}`, error: '路径越界' };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, output: `文件不存在: ${relPath}，如需新建文件请确认路径`, error: `文件不存在: ${relPath}` };
  }

  try {
    const originalContent = fs.readFileSync(resolved, 'utf-8');

    // 统一处理换行符匹配
    const normalize = (s: string) => s.replace(/\r\n/g, '\n');
    const normOriginal = normalize(originalContent);
    const normTarget = normalize(args.targetContent);
    const normReplacement = normalize(args.replacementContent);

    let matchCount = normOriginal.split(normTarget).length - 1;

    // 若未直接匹配，尝试去除首尾空行/空白重试
    let actualTarget = normTarget;
    if (matchCount === 0 && normTarget.trim().length > 0) {
      const trimmedTarget = normTarget.trim();
      const trimmedCount = normOriginal.split(trimmedTarget).length - 1;
      if (trimmedCount === 1) {
        actualTarget = trimmedTarget;
        matchCount = 1;
      }
    }

    if (matchCount === 0) {
      return {
        success: false,
        output: `修改失败: 在文件 ${relPath} 中未找到目标代码块 targetContent。\n请先调用 read_file 工具核对目标文件对应行号的具体内容与缩进格式后再重试。`,
        error: '未找到匹配的代码块'
      };
    }

    if (matchCount > 1) {
      return {
        success: false,
        output: `修改失败: 在文件 ${relPath} 中发现 ${matchCount} 处匹配的代码块。\n请在 targetContent 中多包含前后 2~3 行上下文代码，以确保唯确定位。`,
        error: `发现 ${matchCount} 处匹配，存在多处匹配无法唯确定位`
      };
    }

    const updatedContent = normOriginal.replace(actualTarget, normReplacement);
    fs.writeFileSync(resolved, updatedContent, 'utf-8');

    const targetLines = actualTarget.split('\n').length;
    const replacementLines = normReplacement.split('\n').length;

    return {
      success: true,
      path: relPath,
      replacedLines: targetLines,
      newLines: replacementLines,
      output: `成功修改文件 ${relPath}！替换了 ${targetLines} 行代码为 ${replacementLines} 行新代码。`
    };
  } catch (err: any) {
    return { success: false, output: `修改文件异常: ${err.message}`, error: err.message };
  }
}
