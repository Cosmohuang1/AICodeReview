import path from 'node:path';

export interface McpConfigSnippet {
  mcpServers: {
    'ai-review': {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

/**
 * 生成供 Claude Desktop / Cursor / Antigravity 使用的 MCP 配置文件代码片段
 */
export function generateMcpIdeConfig(baseDir: string = process.cwd()): McpConfigSnippet {
  const serverPath = path.resolve(baseDir, 'dist', 'mcp', 'server.js').replace(/\\/g, '/');
  const tsxServerPath = path.resolve(baseDir, 'src', 'mcp', 'server.ts').replace(/\\/g, '/');

  return {
    mcpServers: {
      'ai-review': {
        command: 'npx',
        args: ['tsx', tsxServerPath],
        env: {
          NODE_ENV: 'production',
        },
      },
    },
  };
}
