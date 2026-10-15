import type { Response } from 'express';

export type StreamEventType =
  | 'start'
  | 'think'
  | 'tool_call'
  | 'tool_result'
  | 'tool_output'
  | 'step'
  | 'finish'
  | 'abort'
  | 'error';

interface SessionState {
  clients: Set<Response>;
  abortController: AbortController;
  history: Array<{ event: StreamEventType; payload: any }>;
}

export class ReactStreamer {
  private sessions = new Map<string, SessionState>();

  private getOrCreateSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        clients: new Set(),
        abortController: new AbortController(),
        history: [],
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  registerClient(sessionId: string, res: Response): void {
    const session = this.getOrCreateSession(sessionId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    session.clients.add(res);

    // 回放最近的历史事件给刚连接的客户端
    for (const item of session.history) {
      const msg = `event: ${item.event}\ndata: ${JSON.stringify(item.payload)}\n\n`;
      res.write(msg);
    }

    if (typeof res.on === 'function') {
      res.on('close', () => {
        session.clients.delete(res);
      });
    }
  }

  broadcast(sessionId: string, event: StreamEventType, payload: any): void {
    const session = this.getOrCreateSession(sessionId);
    session.history.push({ event, payload });

    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of session.clients) {
      try {
        client.write(msg);
      } catch {
        session.clients.delete(client);
      }
    }
  }

  createAbortSignal(sessionId: string): AbortSignal {
    const session = this.getOrCreateSession(sessionId);
    return session.abortController.signal;
  }

  abortSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (!session.abortController.signal.aborted) {
      session.abortController.abort();
      this.broadcast(sessionId, 'abort', { message: '任务已被用户中止' });
      return true;
    }
    return false;
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const client of session.clients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    session.clients.clear();
    this.sessions.delete(sessionId);
  }
}

export const defaultReactStreamer = new ReactStreamer();
