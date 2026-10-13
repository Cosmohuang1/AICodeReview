import { describe, it, expect, vi } from 'vitest';
import { ReactStreamer } from '../../src/agent-engine/react-streamer.js';

describe('ReactStreamer (SSE 实时流分发器)', () => {
  it('正确注册客户端并设置 SSE 头信息', () => {
    const streamer = new ReactStreamer();
    const mockRes: any = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    streamer.registerClient('session-1', mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('向客户端广播结构化 SSE 事件', () => {
    const streamer = new ReactStreamer();
    const mockRes: any = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    streamer.registerClient('session-2', mockRes);
    streamer.broadcast('session-2', 'think', { text: '正在分析工作区...' });

    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('event: think\n'));
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining('"text":"正在分析工作区..."'));
  });

  it('支持创建 AbortSignal 与触发任务中止', () => {
    const streamer = new ReactStreamer();
    const signal = streamer.createAbortSignal('session-3');
    expect(signal.aborted).toBe(false);

    const aborted = streamer.abortSession('session-3');
    expect(aborted).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('关闭会话并清理资源', () => {
    const streamer = new ReactStreamer();
    const mockRes: any = {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    streamer.registerClient('session-4', mockRes);
    streamer.closeSession('session-4');

    expect(mockRes.end).toHaveBeenCalled();
  });
});
