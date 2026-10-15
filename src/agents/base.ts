import 'dotenv/config';
import OpenAI from 'openai';
import type { ReviewComment } from './types.js';
import { recordAgentFailure } from './telemetry.js';

let cachedClient: OpenAI | null = null;
let lastApiKey: string | undefined;
let lastBaseUrl: string | undefined;

export function _resetClient(): void {
  cachedClient = null;
  lastApiKey = undefined;
  lastBaseUrl = undefined;
}

function getClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

  if (!cachedClient || lastApiKey !== apiKey || lastBaseUrl !== baseURL) {
    cachedClient = new OpenAI({ apiKey, baseURL });
    lastApiKey = apiKey;
    lastBaseUrl = baseURL;
  }
  return cachedClient;
}

export async function callDeepSeek(
  prompt: string,
  timeoutMs = 60_000,
  maxRetries = 2
): Promise<string> {
  const client = getClient();
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        },
        { signal: controller.signal }
      );
      return response.choices[0]?.message?.content ?? '';
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        // 指数退避等待 (100ms, 200ms, ...)
        const backoffMs = Math.min(1000, 100 * Math.pow(2, attempt));
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  recordAgentFailure(lastError);
  throw lastError;
}

export function extractJsonArray<T = ReviewComment>(text: string): T[] {
  // 尝试提取 markdown 代码块中的 JSON
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  // 找到第一个 [ 和最后一个 ] 之间的内容
  const start = jsonText.indexOf('[');
  const end = jsonText.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(jsonText.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch {
    return [];
  }
}
