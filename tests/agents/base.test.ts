import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractJsonArray, callDeepSeek } from '../../src/agents/base.js';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation((options) => ({
      options,
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

describe('extractJsonArray', () => {
  it('extracts JSON array from clean response', () => {
    const input = '[{"file":"a.ts","line":1,"side":"RIGHT","severity":"error","category":"bug","message":"test","confidence":0.9}]';
    const result = extractJsonArray(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'a.ts',
      line: 1,
      side: 'RIGHT',
      severity: 'error',
      category: 'bug',
      message: 'test',
      confidence: 0.9,
    });
  });

  it('extracts JSON array from response with surrounding text and markdown block', () => {
    const input = '以下是审查结果：\n```json\n[{"file":"b.ts","line":2,"side":"RIGHT","severity":"warning","category":"style","message":"命名问题","confidence":0.7}]\n```\n请参考';
    const result = extractJsonArray(input);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('b.ts');
    expect(result[0].category).toBe('style');
  });

  it('extracts JSON array wrapped in code block without json tag', () => {
    const input = '```\n[{"file":"c.ts","line":10,"side":"RIGHT","severity":"info","category":"performance","message":"建议优化","confidence":0.8}]\n```';
    const result = extractJsonArray(input);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('c.ts');
  });

  it('returns empty array when no JSON found', () => {
    const result = extractJsonArray('没有发现问题');
    expect(result).toEqual([]);
  });

  it('returns empty array when JSON is not an array', () => {
    const result = extractJsonArray('{"error": "invalid"}');
    expect(result).toEqual([]);
  });

  it('returns empty array when JSON within brackets is malformed', () => {
    const result = extractJsonArray('Some text [not valid json] other text');
    expect(result).toEqual([]);
  });
});

describe('callDeepSeek', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('calls OpenAI chat completions with correct model and prompt', async () => {
    process.env.DEEPSEEK_MODEL = 'deepseek-chat';
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'mock response',
          },
        },
      ],
    });

    const result = await callDeepSeek('review prompt');
    expect(result).toBe('mock response');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'review prompt' }],
        temperature: 0.1,
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('handles empty choices gracefully by returning empty string', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [],
    });

    const result = await callDeepSeek('another prompt');
    expect(result).toBe('');
  });

  it('uses environment variables DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL when present', async () => {
    process.env.DEEPSEEK_API_KEY = 'custom-key';
    process.env.DEEPSEEK_BASE_URL = 'https://custom.api.deepseek.com';
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
    });

    const OpenAI = (await import('openai')).default;
    await callDeepSeek('test');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: 'custom-key',
      baseURL: 'https://custom.api.deepseek.com',
    });
  });

  it('propagates error when OpenAI API fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API failure'));

    await expect(callDeepSeek('failing prompt')).rejects.toThrow('API failure');
  });
});
