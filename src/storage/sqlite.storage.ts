import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { TaskDetail, ConnectedRepoItem } from '../server/api.routes.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');



export class SqliteStorage {
  private db: DatabaseSyncType;


  constructor(dbPath = 'data/ai-review.db') {
    if (dbPath !== ':memory:') {
      const fullPath = path.resolve(dbPath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(fullPath);
    } else {
      this.db = new DatabaseSync(':memory:');
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        repo TEXT NOT NULL,
        branch TEXT NOT NULL,
        pushed_commit TEXT NOT NULL,
        author TEXT NOT NULL,
        worked_time TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        total_additions INTEGER NOT NULL,
        total_deletions INTEGER NOT NULL,
        agent_summary TEXT NOT NULL,
        edited_files TEXT NOT NULL,
        raw_diff TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        side TEXT NOT NULL,
        severity TEXT NOT NULL,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        suggestion TEXT,
        confidence REAL NOT NULL,
        diff_position INTEGER,
        priority TEXT,
        tag TEXT,
        why_priority TEXT,
        diff_snippet TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        time TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visibility TEXT NOT NULL,
        path TEXT
      );

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }


  public saveTask(task: TaskDetail): void {
    const existing = this.getTask(task.id);
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, title, repo, branch, pushed_commit, author, worked_time, timestamp,
        status, total_additions, total_deletions, agent_summary, edited_files, raw_diff, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.title,
      task.repo,
      task.branch,
      task.pushedCommit,
      task.author,
      task.workedTime,
      task.timestamp,
      task.status,
      task.totalAdditions,
      task.totalDeletions,
      JSON.stringify(task.agentSummary),
      JSON.stringify(task.editedFiles),
      task.rawDiff,
      now
    );

    // 更新 comments
    const delComments = this.db.prepare('DELETE FROM comments WHERE task_id = ?');
    delComments.run(task.id);

    if (task.comments && task.comments.length > 0) {
      const insComment = this.db.prepare(`
        INSERT INTO comments (
          id, task_id, file, line, side, severity, category, message, suggestion,
          confidence, diff_position, priority, tag, why_priority, diff_snippet
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      task.comments.forEach((c: any, idx) => {
        const commentId = `${task.id}_c_${idx}_${c.line}`;
        insComment.run(
          commentId,
          task.id,
          c.file,
          c.line,
          c.side || 'RIGHT',
          c.severity || 'warning',
          c.category || 'bug',
          c.message,
          c.suggestion || null,
          c.confidence ?? 0.8,
          c.diffPosition || null,
          c.priority || 'P1',
          c.tag || null,
          c.whyPriority || null,
          c.diffSnippet || null
        );
      });
    }

    // 保存 chatHistory（仅在新插入时，避免重复覆盖）
    if (!existing && task.chatHistory && task.chatHistory.length > 0) {
      const insChat = this.db.prepare(`
        INSERT INTO chat_messages (task_id, role, text, time, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      task.chatHistory.forEach((msg, idx) => {
        insChat.run(task.id, msg.role, msg.text, msg.time || '刚刚', now + idx);
      });
    }
  }

  public getTask(id: string): TaskDetail | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    const commentsStmt = this.db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY line ASC');
    const commentRows = commentsStmt.all(id) as any[];

    const chatStmt = this.db.prepare('SELECT * FROM chat_messages WHERE task_id = ? ORDER BY id ASC');
    const chatRows = chatStmt.all(id) as any[];

    return {
      id: row.id,
      title: row.title,
      repo: row.repo,
      branch: row.branch,
      pushedCommit: row.pushed_commit,
      author: row.author,
      workedTime: row.worked_time,
      timestamp: row.timestamp,
      status: row.status,
      totalAdditions: row.total_additions,
      totalDeletions: row.total_deletions,
      agentSummary: JSON.parse(row.agent_summary),
      editedFiles: JSON.parse(row.edited_files),
      rawDiff: row.raw_diff,
      comments: commentRows.map(c => ({
        file: c.file,
        line: c.line,
        side: c.side,
        severity: c.severity,
        category: c.category,
        message: c.message,
        suggestion: c.suggestion || undefined,
        confidence: c.confidence,
        diffPosition: c.diff_position || undefined,
        priority: c.priority || 'P1',
        tag: c.tag || undefined,
        whyPriority: c.why_priority || undefined,
        diffSnippet: c.diff_snippet || undefined,
      })),
      chatHistory: chatRows.map(m => ({
        role: m.role,
        text: m.text,
        time: m.time,
      })),
    };
  }

  public listTasks(): TaskDetail[] {
    const stmt = this.db.prepare('SELECT id FROM tasks ORDER BY created_at DESC');
    const rows = stmt.all() as { id: string }[];
    return rows.map(r => this.getTask(r.id)!).filter(Boolean);
  }

  public deleteTask(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public addChatMessage(
    taskId: string,
    message: { role: 'user' | 'agent'; text: string; time?: string }
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO chat_messages (task_id, role, text, time, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(taskId, message.role, message.text, message.time || '刚刚', Date.now());
  }

  public saveRepo(repo: ConnectedRepoItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO repositories (id, name, visibility, path)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(repo.id, repo.name, repo.visibility, repo.path || null);
  }

  public listRepos(): ConnectedRepoItem[] {
    const stmt = this.db.prepare('SELECT * FROM repositories ORDER BY name ASC');
    const rows = stmt.all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      visibility: r.visibility,
      path: r.path || undefined,
    }));
  }

  public setPreference(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO preferences (key, value)
      VALUES (?, ?)
    `);
    stmt.run(key, value);
  }

  public getPreference(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM preferences WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public close(): void {
    this.db.close();
  }
}


export const defaultSqliteStorage = new SqliteStorage();
export default SqliteStorage;
