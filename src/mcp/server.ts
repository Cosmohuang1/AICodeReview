import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseDiff } from '../parser/diff.parser.js';
import { chunkFiles } from '../parser/chunker.js';
import { runDeterministicRules } from '../rules/deterministic.engine.js';
import type { CodeChunk } from '../agents/types.js';

const execAsync = promisify(exec);

export const MCP_SERVER_NAME = 'ai-review-mcp-server';
export const MCP_SERVER_VERSION = '1.0.0';

export const MCP_TOOLS: Tool[] = [
  {
    name: 'scan_and_check_rules',
    description: '使用确定性规则引擎扫描代码补丁/改动，秒级检测硬编码绝对路径(Windows/Unix盘符)、私有密钥泄漏、遗留调试断点/throw、SQL注入等违规项。',
    inputSchema: {
      type: 'object',
      properties: {
        diffText: {
          type: 'string',
          description: '待检测的统一 Diff 文本 (Unified Diff)',
        },
        filePath: {
          type: 'string',
          description: '可选的文件路径标识',
        },
      },
      required: ['diffText'],
    },
  },
  {
    name: 'ast_chunk_files',
    description: '基于语法结构感知对 Diff 进行语义分块并提取上下文与行号范围，适配 LLM 审查窗口。',
    inputSchema: {
      type: 'object',
      properties: {
        diffText: {
          type: 'string',
          description: 'Unified Diff 文本',
        },
        maxTokens: {
          type: 'number',
          description: '单分块最大 Token 估算阈值（默认 8000）',
        },
      },
      required: ['diffText'],
    },
  },
  {
    name: 'build_target_projects',
    description: '在指定工作区目录执行增量构建或语法编译检查 (如 dotnet build, npm run build)。',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: '目标项目根目录',
        },
        command: {
          type: 'string',
          description: '执行的编译命令，默认 "dotnet build"',
        },
      },
    },
  },
  {
    name: 'inspect_file_symbol',
    description: '检索工作区中指定源码文件的定义、符号或指定行，提取带有上下文的代码段。',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '目标文件相对路径或绝对路径',
        },
        query: {
          type: 'string',
          description: '查找的类名、方法名或关键字',
        },
        cwd: {
          type: 'string',
          description: '工作区目录',
        },
        maxLines: {
          type: 'number',
          description: '最大返回行数，默认 100',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'execute_command',
    description: '安全执行开发工作区命令并捕获标准输出与标准错误。',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '待执行的命令字符串',
        },
        cwd: {
          type: 'string',
          description: '工作区目录',
        },
      },
      required: ['command'],
    },
  },
];

/**
 * 创建标准 MCP Server 实例并注册工具处理句柄
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 1. 列出可用工具
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS,
    };
  });

  // 2. 工具调用处理
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'scan_and_check_rules': {
          const diffText = String(args.diffText ?? '');
          const filePath = String(args.filePath ?? 'unknown');

          let chunks: CodeChunk[] = [];
          const parsed = parseDiff(diffText);

          if (parsed.length > 0) {
            chunks = chunkFiles(parsed, new Map());
          } else {
            // 如果传入的是没有标准 diff 头的内容，构造基础 chunk 执行规约校验
            chunks = [
              {
                file: filePath,
                language: 'unknown',
                diffContent: diffText,
                fullContext: diffText,
                startLine: 1,
                endLine: diffText.split('\n').length,
                diffPosition: 1,
              },
            ];
          }

          const violations = chunks.flatMap((chunk) => runDeterministicRules(chunk));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    totalViolations: violations.length,
                    violations,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'ast_chunk_files': {
          const diffText = String(args.diffText ?? '');
          const maxTokens = typeof args.maxTokens === 'number' ? args.maxTokens : 8000;
          const parsed = parseDiff(diffText);
          const chunks = chunkFiles(parsed, new Map(), maxTokens);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    fileCount: parsed.length,
                    chunkCount: chunks.length,
                    chunks,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'build_target_projects': {
          const cwd = String(args.cwd || process.cwd());
          const command = String(args.command || 'dotnet build');

          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd,
              timeout: 120000,
              maxBuffer: 10 * 1024 * 1024,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      exitCode: 0,
                      stdout: stdout.trim(),
                      stderr: stderr.trim(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (err: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: false,
                      exitCode: err.code ?? 1,
                      stdout: (err.stdout ?? '').toString().trim(),
                      stderr: (err.stderr ?? err.message ?? '').toString().trim(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        case 'inspect_file_symbol': {
          const cwd = String(args.cwd || process.cwd());
          const rawPath = String(args.filePath || '');
          const targetPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
          const query = args.query ? String(args.query) : null;
          const maxLines = typeof args.maxLines === 'number' ? args.maxLines : 100;

          if (!fs.existsSync(targetPath)) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: `File not found: ${targetPath}` }),
                },
              ],
            };
          }

          const fileContent = fs.readFileSync(targetPath, 'utf-8');
          const lines = fileContent.split('\n');

          if (!query) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      filePath: targetPath,
                      totalLines: lines.length,
                      content: lines.slice(0, maxLines).join('\n'),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          // 检索符号匹配及上下文
          const matches: Array<{ line: number; text: string; context: string }> = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              const start = Math.max(0, i - 5);
              const end = Math.min(lines.length - 1, i + 5);
              matches.push({
                line: i + 1,
                text: lines[i].trim(),
                context: lines.slice(start, end + 1).join('\n'),
              });
              if (matches.length >= 10) break;
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    filePath: targetPath,
                    query,
                    matchCount: matches.length,
                    matches,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        case 'execute_command': {
          const command = String(args.command || '');
          const cwd = String(args.cwd || process.cwd());

          try {
            const { stdout, stderr } = await execAsync(command, {
              cwd,
              timeout: 60000,
              maxBuffer: 5 * 1024 * 1024,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: true,
                      exitCode: 0,
                      stdout: stdout.trim(),
                      stderr: stderr.trim(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (err: any) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: false,
                      exitCode: err.code ?? 1,
                      stdout: (err.stdout ?? '').toString().trim(),
                      stderr: (err.stderr ?? err.message ?? '').toString().trim(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }

        default:
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Unknown MCP tool: ${name}` }),
              },
            ],
          };
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message || 'Internal tool execution error' }),
          },
        ],
      };
    }
  });

  return server;
}

/**
 * 启动基于标准 Stdio 的 MCP 服务 (供 Claude Desktop / Cursor / Antigravity IDE 挂载)
 */
export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[ai-review-mcp] MCP server running on stdio (PID: ${process.pid})`);
}

// 若作为直接入口脚本执行，启动 stdio 传输
const isDirectEntry =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/').toLowerCase() ===
    process.argv[1].replace(/\\/g, '/').toLowerCase();

if (isDirectEntry) {
  startStdioServer().catch((err) => {
    console.error('[ai-review-mcp] Fatal server error:', err);
    process.exit(1);
  });
}
