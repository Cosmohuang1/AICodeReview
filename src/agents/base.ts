import OpenAI from 'openai';
import type { ReviewComment } from './types.js';

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  });
}

export async function callDeepSeek(prompt: string, timeoutMs = 60_000): Promise<string> {
  const client = getClient();
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

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
  } finally {
    clearTimeout(timer);
  }
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
