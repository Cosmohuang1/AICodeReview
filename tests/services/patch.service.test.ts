import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PatchService } from '../../src/services/patch.service.js';

describe('PatchService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-service-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('成功修改已有文件并保留备份', () => {
    const existingFile = path.join(tempDir, 'src', 'index.ts');
    fs.mkdirSync(path.dirname(existingFile), { recursive: true });
    fs.writeFileSync(existingFile, 'const original = true;\n');

    const patchService = new PatchService();
    const session = patchService.applyFileChanges(tempDir, [
      { path: 'src/index.ts', content: 'const modified = true;\n' }
    ]);

    expect(session.appliedFiles).toContain('src/index.ts');
    expect(fs.readFileSync(existingFile, 'utf-8')).toBe('const modified = true;\n');

    // 触发回滚
    session.rollback();
    expect(fs.readFileSync(existingFile, 'utf-8')).toBe('const original = true;\n');
  });

  it('成功创建新文件并支持回滚删除', () => {
    const newFile = path.join(tempDir, 'src', 'new-util.ts');

    const patchService = new PatchService();
    const session = patchService.applyFileChanges(tempDir, [
      { path: 'src/new-util.ts', content: 'export const util = 1;\n' }
    ]);

    expect(fs.existsSync(newFile)).toBe(true);
    expect(fs.readFileSync(newFile, 'utf-8')).toBe('export const util = 1;\n');

    // 回滚
    session.rollback();
    expect(fs.existsSync(newFile)).toBe(false);
  });

  it('防止跨目录路径穿越 (Security check)', () => {
    const patchService = new PatchService();
    expect(() => {
      patchService.applyFileChanges(tempDir, [
        { path: '../outside.txt', content: 'hack' }
      ]);
    }).toThrow(/路径穿越/);
  });

  it('安全将建议替换目标行，保持换行符并支持回滚', () => {
    const file = path.join(tempDir, 'main.ts');
    fs.writeFileSync(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');

    const patchService = new PatchService();
    const session = patchService.applyLineSuggestion(tempDir, 'main.ts', 2, 'const b = 200;\nconst extra = true;');

    const modified = fs.readFileSync(file, 'utf-8');
    expect(modified).toBe('const a = 1;\nconst b = 200;\nconst extra = true;\nconst c = 3;\n');

    session.rollback();
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = 1;\nconst b = 2;\nconst c = 3;\n');
  });

  it('applyLineSuggestion 防止路径穿越', () => {
    const patchService = new PatchService();
    expect(() => {
      patchService.applyLineSuggestion(tempDir, '../../etc/passwd', 1, 'bad');
    }).toThrow(/路径穿越/);
  });
});
