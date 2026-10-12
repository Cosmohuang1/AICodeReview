import { callDeepSeek, extractJsonArray } from './base.js';
import type { AgentFn, ReviewComment } from './types.js';

export const securityAgent: AgentFn = async (chunk, config) => {
  const langPrompt = config.language === 'en' ? 'English' : '中文';
  const prompt = `你是一位专注于安全漏洞审查的资深安全专家。请审查以下代码变更，只关注安全风险：
- SQL 注入 / NoSQL 注入风险
- XSS (跨站脚本攻击) 与 HTML / 脚本未转义
- CSRF (跨站请求伪造) 保护缺失
- 硬编码明文密钥、Token、密码、敏感证书或凭证泄露
- 未鉴权或权限校验漏洞（越权访问、BOLA/IDOR）
- 命令注入与危险的系统调用执行
- 路径穿越 (Path Traversal) 与非受信文件操作
- 不安全的反序列化 / SSRF 风险

【文件】: ${chunk.file} (${chunk.language})
【代码上下文】:
\`\`\`${chunk.language}
${chunk.fullContext}
\`\`\`

【变更内容（diff）】:
\`\`\`diff
${chunk.diffContent}
\`\`\`

输出语言要求: ${langPrompt}。
严格输出 JSON 数组（不要任何其他文字）:
[{"file":"${chunk.file}","line":行号,"side":"RIGHT","severity":"error|warning|info","category":"security","message":"具体安全问题描述","suggestion":"安全修复后的完整代码（可选）","confidence":0.0到1.0}]

如无问题则输出: []`;

  try {
    const raw = await callDeepSeek(prompt);
    const comments = extractJsonArray<ReviewComment>(raw);
    return comments.map(c => ({
      ...c,
      file: c.file || chunk.file,
      line: typeof c.line === 'number' ? c.line : chunk.startLine,
      side: 'RIGHT' as const,
      category: 'security' as const,
    }));
  } catch {
    return [];
  }
};

export default securityAgent;
