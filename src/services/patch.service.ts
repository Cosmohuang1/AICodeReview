import fs from 'node:fs';
import path from 'node:path';

export interface FileChange {
  path: string;
  content: string;
}

export interface PatchSession {
  id: string;
  cwd: string;
  appliedFiles: string[];
  backupMap: Map<string, string | null>;
  rollback: () => void;
}

export class PatchService {
  /**
   * 应用文件修改并记录原内容用于安全回滚
   */
  applyFileChanges(cwd: string, changes: FileChange[]): PatchSession {
    const resolvedCwd = path.resolve(cwd);
    const backupMap = new Map<string, string | null>();
    const appliedFiles: string[] = [];

    for (const change of changes) {
      // 检查路径穿越
      const fullPath = path.resolve(resolvedCwd, change.path);
      const relative = path.relative(resolvedCwd, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`检测到非法路径穿越尝试: ${change.path}`);
      }

      // 记录备份
      if (fs.existsSync(fullPath)) {
        const original = fs.readFileSync(fullPath, 'utf-8');
        backupMap.set(fullPath, original);
      } else {
        backupMap.set(fullPath, null); // 之前不存在
      }

      // 确保父目录存在
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // 写入新内容
      fs.writeFileSync(fullPath, change.content, 'utf-8');
      appliedFiles.push(change.path);
    }

    const sessionId = `patch_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    const rollback = () => {
      for (const [filePath, origContent] of backupMap.entries()) {
        try {
          if (origContent === null) {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } else {
            fs.writeFileSync(filePath, origContent, 'utf-8');
          }
        } catch {
          // ignore rollback error
        }
      }
    };

    return {
      id: sessionId,
      cwd: resolvedCwd,
      appliedFiles,
      backupMap,
      rollback
    };
  }

  /**
   * 将优化建议安全应用到目标文件的指定行（支持单行、多行以及指定结束行），保留原有换行符并生成可回滚会话
   */
  applyLineSuggestion(
    cwd: string,
    filePath: string,
    line: number,
    suggestion: string,
    endLine?: number
  ): PatchSession {
    const resolvedCwd = path.resolve(cwd);
    const fullPath = path.resolve(resolvedCwd, filePath);
    const relative = path.relative(resolvedCwd, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`检测到非法路径穿越尝试: ${filePath}`);
    }
    if (!fs.existsSync(fullPath)) {
      throw new Error(`目标文件不存在: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const isCRLF = content.includes('\r\n');
    const newline = isCRLF ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);

    const startIdx = Math.max(0, line - 1);
    const endIdx = typeof endLine === 'number' && endLine >= line ? Math.max(0, endLine - 1) : startIdx;

    let cleanSuggestion = suggestion.trim();
    if (cleanSuggestion.startsWith('```')) {
      cleanSuggestion = cleanSuggestion.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '').replace(/\r?\n```$/, '');
    }

    const suggestionLines = cleanSuggestion.split(/\r?\n/);
    lines.splice(startIdx, endIdx - startIdx + 1, ...suggestionLines);

    const newContent = lines.join(newline);
    return this.applyFileChanges(resolvedCwd, [{ path: filePath, content: newContent }]);
  }
}
