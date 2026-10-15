import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentTelemetry {
  failures: string[];
}

const context = new AsyncLocalStorage<AgentTelemetry>();

export function traceAgent<T>(telemetry: AgentTelemetry, task: () => Promise<T>): Promise<T> {
  return context.run(telemetry, task);
}

export function recordAgentFailure(error: unknown): void {
  const current = context.getStore();
  if (!current) return;
  const message = error instanceof Error ? error.message : String(error);
  current.failures.push(message.slice(0, 300));
}
