declare module 'node:sqlite' {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    all(...params: any[]): any[];
    get(...params: any[]): any | undefined;
    run(...params: any[]): RunResult;
  }

  export class DatabaseSync {
    constructor(location: string, options?: { open?: boolean });
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
