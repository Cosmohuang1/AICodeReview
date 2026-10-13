import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/sqlite.storage.js';
import type { TaskDetail, ConnectedRepoItem } from '../../src/server/api.routes.js';

describe('SqliteStorage (Embedded SQLite persistence)', () => {
  let storage: SqliteStorage;

  beforeEach(() => {
    // 使用内存数据库隔离每个测试用例
    storage = new SqliteStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  const mockTask: TaskDetail = {
    id: 'task_test_001',
    title: '重构用户鉴权机制',
    repo: 'my-project',
    branch: 'feat/auth-v2',
    pushedCommit: 'abcdef123456',
    author: 'Cosmohuang1',
    workedTime: '3.2 小时',
    timestamp: '2026-10-13 17:30',
    status: 'changes_ready',
    agentSummary: {
      commit: 'abcdef123456',
      bulletPoints: ['重构 JWT 解析中间件', '增加白名单检测'],
      riskNote: '注意生产环境秘钥轮转',
      regressionStatus: '全量通过',
      thoughtProcess: '分析了路由守卫...',
      message: '鉴权模块已重构完成',
      steps: ['分析路由', '编写测试', '执行提交'],
    },
    totalAdditions: 45,
    totalDeletions: 12,
    editedFiles: [
      { path: 'src/auth/jwt.ts', additions: 35, deletions: 10 },
      { path: 'src/routes/api.ts', additions: 10, deletions: 2 },
    ],
    comments: [
      {
        file: 'src/auth/jwt.ts',
        line: 25,
        side: 'RIGHT',
        severity: 'warning',
        category: 'security',
        message: '建议增加 token 过期强制核验',
        suggestion: 'if (isExpired) throw new AuthError();',
        confidence: 0.95,
        priority: 'P0',
        tag: 'Security check',
        whyPriority: 'Prevent expired token reuse',
      } as any,
    ],
    chatHistory: [
      { role: 'user', text: '请帮我检查 token 校验逻辑', time: '17:28' },
      { role: 'agent', text: '好的，正在深入审查...', time: '17:29' },
    ],
    rawDiff: 'diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts...',
  };

  describe('Task persistence & retrieval', () => {
    it('saves a task and retrieves it with all fields intact', () => {
      storage.saveTask(mockTask);

      const retrieved = storage.getTask('task_test_001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('task_test_001');
      expect(retrieved?.title).toBe('重构用户鉴权机制');
      expect(retrieved?.repo).toBe('my-project');
      expect(retrieved?.branch).toBe('feat/auth-v2');
      expect(retrieved?.totalAdditions).toBe(45);
      expect(retrieved?.totalDeletions).toBe(12);
      expect(retrieved?.editedFiles).toHaveLength(2);
      expect(retrieved?.agentSummary.bulletPoints).toEqual(['重构 JWT 解析中间件', '增加白名单检测']);
      expect(retrieved?.comments).toHaveLength(1);
      expect(retrieved?.comments[0].message).toBe('建议增加 token 过期强制核验');
      expect(retrieved?.chatHistory).toHaveLength(2);
    });

    it('returns null when task id does not exist', () => {
      expect(storage.getTask('non_existent')).toBeNull();
    });

    it('lists all saved tasks ordered by timestamp/creation', () => {
      storage.saveTask(mockTask);
      storage.saveTask({
        ...mockTask,
        id: 'task_test_002',
        title: '修复订单死锁缺陷',
      });

      const list = storage.listTasks();
      expect(list).toHaveLength(2);
      const ids = list.map(t => t.id);
      expect(ids).toContain('task_test_001');
      expect(ids).toContain('task_test_002');
    });

    it('upserts a task when saving with same id', () => {
      storage.saveTask(mockTask);
      storage.saveTask({
        ...mockTask,
        title: '重构用户鉴权机制 (已更新)',
        totalAdditions: 55,
      });

      const updated = storage.getTask('task_test_001');
      expect(updated?.title).toBe('重构用户鉴权机制 (已更新)');
      expect(updated?.totalAdditions).toBe(55);
      expect(storage.listTasks()).toHaveLength(1);
    });

    it('deletes a task and cascades related comments and chats', () => {
      storage.saveTask(mockTask);
      expect(storage.getTask('task_test_001')).not.toBeNull();

      const deleted = storage.deleteTask('task_test_001');
      expect(deleted).toBe(true);
      expect(storage.getTask('task_test_001')).toBeNull();
      expect(storage.listTasks()).toHaveLength(0);
    });
  });

  describe('Chat history appending', () => {
    it('appends chat messages to existing task', () => {
      storage.saveTask(mockTask);

      storage.addChatMessage('task_test_001', {
        role: 'user',
        text: '能自动帮我修复这个问题吗？',
        time: '17:35',
      });

      const task = storage.getTask('task_test_001');
      expect(task?.chatHistory).toHaveLength(3);
      expect(task?.chatHistory[2].text).toBe('能自动帮我修复这个问题吗？');
      expect(task?.chatHistory[2].role).toBe('user');
    });
  });

  describe('Connected repositories persistence', () => {
    it('saves and lists connected repositories', () => {
      const repo: ConnectedRepoItem = {
        id: 'repo_01',
        name: 'ai-review',
        visibility: 'Public',
        path: 'C:/repos/ai-review',
      };

      storage.saveRepo(repo);
      const repos = storage.listRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0]).toEqual(repo);
    });

    it('upserts repository on duplicate id', () => {
      storage.saveRepo({
        id: 'repo_01',
        name: 'ai-review',
        visibility: 'Public',
      });
      storage.saveRepo({
        id: 'repo_01',
        name: 'ai-review-renamed',
        visibility: 'Private',
      });

      const repos = storage.listRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0].name).toBe('ai-review-renamed');
      expect(repos[0].visibility).toBe('Private');
    });
  });

  describe('Preferences / Active workspace persistence', () => {
    it('persists and retrieves user preferences such as active repo path', () => {
      expect(storage.getPreference('activeRepoPath')).toBeNull();

      storage.setPreference('activeRepoPath', 'D:/projects/my-app');
      expect(storage.getPreference('activeRepoPath')).toBe('D:/projects/my-app');

      // Update preference
      storage.setPreference('activeRepoPath', 'D:/projects/another-app');
      expect(storage.getPreference('activeRepoPath')).toBe('D:/projects/another-app');
    });
  });
});

