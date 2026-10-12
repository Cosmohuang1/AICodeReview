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
}
