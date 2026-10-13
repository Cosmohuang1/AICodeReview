import type { CodeChunk, ReviewComment } from '../agents/types.js';

interface RuleDefinition {
  id: string;
  category: 'security' | 'bug';
  severity: 'error' | 'warning';
  name: string;
  match: (line: string) => { matched: boolean; message?: string; suggestion?: (line: string) => string } | null;
}

const DETERMINISTIC_RULES: RuleDefinition[] = [
  // 1. 敏感密钥与凭据泄漏 (Secrets)
  {
    id: 'sec-openai-key',
    category: 'security',
    severity: 'error',
    name: 'OpenAI API 密钥泄露',
    match: (line: string) => {
      if (/sk-[a-zA-Z0-9_-]{20,}/.test(line)) {
        return {
          matched: true,
          message: '检测到硬编码的 API Key / 密钥（sk-*）。请勿将私密凭据提交到代码库，应使用环境变量或 Secret Manager 管理。',
        };
      }
      return null;
    },
  },
  {
    id: 'sec-aws-key',
    category: 'security',
    severity: 'error',
    name: 'AWS Access Key 泄露',
    match: (line: string) => {
      if (/AKIA[0-9A-Z]{16}/.test(line)) {
        return {
          matched: true,
          message: '检测到硬编码的 AWS Access Key ID (AKIA*)。存在凭据泄露风险，请转入环境变量。',
        };
      }
      return null;
    },
  },
  {
    id: 'sec-private-key',
    category: 'security',
    severity: 'error',
    name: '私钥头部泄露',
    match: (line: string) => {
      if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(line)) {
        return {
          matched: true,
          message: '检测到硬编码的私钥（Private Key）。严禁在版本控制中提交非公开证书与私钥。',
        };
      }
      return null;
    },
  },

  // 2. SQL 注入 (SQL Injection)
  {
    id: 'sec-sql-injection-concat',
    category: 'security',
    severity: 'error',
    name: 'SQL 字符串拼接注入风险',
    match: (line: string) => {
      if (/(?:select|update|delete|insert\s+into)\b[^\n;]*\+\s*[\w.]+/i.test(line)) {
        return {
          matched: true,
          message: '检测到 SQL 语句直接通过字符串拼接变量，存在严重的 SQL 注入风险。请改用参数化查询（Parameterized Query）或 ORM 预编译。',
        };
      }
      return null;
    },
  },
  {
    id: 'sec-sql-injection-template',
    category: 'security',
    severity: 'error',
    name: 'SQL 模板插值注入风险',
    match: (line: string) => {
      if (/(?:select|update|delete|insert\s+into)\b[^\n;]*\$\{[^}]+\}/i.test(line)) {
        return {
          matched: true,
          message: '检测到 SQL 语句中直接使用了模板字符串插值 (${...})，存在 SQL 注入隐患。请使用参数化查询占位符（如 ? 或 $1）。',
        };
      }
      return null;
    },
  },

  // 3. XSS / innerHTML 风险
  {
    id: 'sec-xss-innerhtml',
    category: 'security',
    severity: 'error',
    name: 'innerHTML XSS 风险',
    match: (line: string) => {
      // 避免误报静态空字符串或常量字符串 innerHTML = ""
      if (/\.innerHTML\s*=\s*(?!\s*['"`]\s*<)[\w.]+/i.test(line)) {
        return {
          matched: true,
          message: '直接向 innerHTML 赋值未经验证的动态变量，存在跨站脚本注入（XSS）漏洞。请使用 textContent、DOMPurify 进行清洗，或使用安全框架渲染。',
        };
      }
      return null;
    },
  },
  {
    id: 'sec-xss-dangerously-set',
    category: 'security',
    severity: 'warning',
    name: 'dangerouslySetInnerHTML 风险',
    match: (line: string) => {
      if (/dangerouslySetInnerHTML\s*=\s*\{\{\s*__html:\s*(?!\s*['"`]\s*<)[\w.]+/i.test(line)) {
        return {
          matched: true,
          message: '使用了 dangerouslySetInnerHTML 渲染动态变量，可能导致 XSS 攻击。请确保内容经过了 DOMPurify.sanitize() 消毒。',
        };
      }
      return null;
    },
  },

  // 4. 代码逻辑 Bug & 反模式 (Logic Anti-patterns)
  {
    id: 'bug-nan-check',
    category: 'bug',
    severity: 'error',
    name: 'NaN 全等比较无效',
    match: (line: string) => {
      if (/[!=]==?\s*NaN\b|\bNaN\s*[!=]==?/.test(line)) {
        return {
          matched: true,
          message: 'JavaScript 中 NaN === NaN 恒为 false，直接比较 NaN 无法检测无效数值。请改用 Number.isNaN()。',
          suggestion: (orig: string) => orig.replace(/([a-zA-Z0-9_$.]+)\s*===?\s*NaN/, 'Number.isNaN($1)'),
        };
      }
      return null;
    },
  },
  {
    id: 'bug-assignment-in-if',
    category: 'bug',
    severity: 'error',
    name: 'if 条件中误用赋值操作符',
    match: (line: string) => {
      // 匹配 if (a = b) 或 if (user = getUser())
      if (/\bif\s*\(\s*[\w.]+\s*=\s*[^=]/.test(line)) {
        return {
          matched: true,
          message: '在 if 判断条件中使用了单等号赋值操作符（=）而非比较操作符（===），这通常是手误导致的不符合预期逻辑。',
          suggestion: (orig: string) => orig.replace(/(\bif\s*\(\s*[\w.]+)\s*=\s*([^=])/, '$1 === $2'),
        };
      }
      return null;
    },
  },
];

/**
 * 确定性静态规则引擎
 * 针对 Unified Diff 中的新增行进行 100% 精确度、0 Token 开销的规约校验
 */
export function runDeterministicRules(chunk: CodeChunk): ReviewComment[] {
  const comments: ReviewComment[] = [];
  const lines = chunk.diffContent.split('\n');

  let currentLine = chunk.startLine;

  for (const rawLine of lines) {
    // 处理 hunk 头行 @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      const addedContent = rawLine.slice(1);

      for (const rule of DETERMINISTIC_RULES) {
        const result = rule.match(addedContent);
        if (result && result.matched) {
          const suggestion = result.suggestion ? result.suggestion(addedContent) : undefined;
          comments.push({
            file: chunk.file,
            line: currentLine,
            side: 'RIGHT',
            severity: rule.severity,
            category: rule.category,
            message: `[${rule.name}] ${result.message}`,
            suggestion,
            confidence: 1.0,
          });
        }
      }

      currentLine++;
    } else if (rawLine.startsWith(' ') || (!rawLine.startsWith('-') && !rawLine.startsWith('@'))) {
      currentLine++;
    }
  }

  return comments;
}

export default runDeterministicRules;
