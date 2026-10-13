import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from './types.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.superpowers']);
const MAX_SEARCH_RESULTS = 50;

export async function searchCodeTool(
  cwd: string,
  args: { query: string; path?: string; maxResults?: number }
): Promise<ToolResult> {
  const query = args.query?.trim();
  if (!query) {
    return { success: false, output: '错误: 必须提供搜索查询词 query', error: '缺少 query' };
  }

  const targetDir = args.path ? path.resolve(cwd, args.path) : path.resolve(cwd);
  if (!targetDir.startsWith(path.resolve(cwd))) {
    return { success: false, output: '安全错误: 搜索路径越界', error: '路径越界' };
  }

  if (!fs.existsSync(targetDir)) {
    return { success: false, output: `搜索目录不存在: ${args.path || '.'}`, error: '目录不存在' };
  }

  const matches: Array<{ file: string; line: number; text: string }> = [];
  const limit = args.maxResults || MAX_SEARCH_RESULTS;

  let regex: RegExp;
  try {
    regex = new RegExp(query, 'i');
  } catch {
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  function traverse(dir: string) {
    if (matches.length >= limit) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= limit) break;
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            traverse(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          // 只搜索常见源码与配置文件
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(cwd, fullPath).replace(/\\/g, '/');
          if (relPath.startsWith('.env') || relPath.endsWith('.lock')) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= limit) break;
              if (regex.test(lines[i])) {
                matches.push({
                  file: relPath,
                  line: i + 1,
                  text: lines[i].trim().slice(0, 150)
                });
              }
            }
          } catch {
            // ignore binary / unreadable files
          }
        }
      }
    } catch {
      // ignore
    }
  }

  traverse(targetDir);

  if (matches.length === 0) {
    return {
      success: true,
      matches: [],
      output: `在工程中未找到包含 "${query}" 的代码行。`
    };
  }

  const formatted = matches
    .map(m => `${m.file}:${m.line}: ${m.text}`)
    .join('\n');

  return {
    success: true,
    matches,
    output: `找到 ${matches.length} 处匹配 "${query}":\n${formatted}`
  };
}
