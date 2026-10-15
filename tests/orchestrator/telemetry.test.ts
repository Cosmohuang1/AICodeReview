import { describe, expect, it } from 'vitest';
import { recordAgentFailure, traceAgent } from '../../src/agents/telemetry.js';

describe('model failure telemetry', () => {
  it('records errors inside async agent contexts even if the agent swallows its own error', async () => {
    const telemetry = { failures: [] as string[] };
    await traceAgent(telemetry, async () => {
      await Promise.resolve();
      recordAgentFailure(new Error('DeepSeek timed out'));
    });
    expect(telemetry.failures).toEqual(['DeepSeek timed out']);
  });

  it('does not leak failure records between concurrent agents', async () => {
    const a = { failures: [] as string[] }, b = { failures: [] as string[] };
    await Promise.all([
      traceAgent(a, async () => { await Promise.resolve(); recordAgentFailure('first'); }),
      traceAgent(b, async () => { await Promise.resolve(); recordAgentFailure('second'); })
    ]);
    expect(a.failures).toEqual(['first']);
    expect(b.failures).toEqual(['second']);
  });
});
