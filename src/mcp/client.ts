import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION, MCP_TOOLS } from './server.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface McpStatus {
  running: boolean;
  mode: 'in-memory' | 'stdio';
  pid: number;
  serverName: string;
  serverVersion: string;
  tools: Tool[];
  toolCount: number;
  connectedAt?: string;
  error?: string;
}

export class McpClientManager {
  private client: Client | null = null;
  private serverTransport: any = null;
  private clientTransport: any = null;
  private isRunning = false;
  private currentMode: 'in-memory' | 'stdio' = 'in-memory';
  private connectedAt?: string;
  private cachedTools: Tool[] = [];
  private lastError?: string;

  /**
   * 启动并初始化 MCP Client
   */
  async start(options: { mode?: 'in-memory' | 'stdio'; command?: string; args?: string[] } = {}): Promise<void> {
    if (this.isRunning && this.client) {
      return;
    }

    const mode = options.mode || 'in-memory';
    this.currentMode = mode;

    try {
      this.client = new Client(
        {
          name: 'ai-review-mcp-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      if (mode === 'in-memory') {
        const server = createMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        this.clientTransport = clientTransport;
        this.serverTransport = serverTransport;

        await server.connect(serverTransport);
        await this.client.connect(clientTransport);
      } else {
        const command = options.command || 'npx';
        const args = options.args || ['tsx', 'src/mcp/server.ts'];

        const transport = new StdioClientTransport({
          command,
          args,
        });
        this.clientTransport = transport;
        await this.client.connect(transport);
      }

      this.isRunning = true;
      this.connectedAt = new Date().toISOString();
      this.lastError = undefined;

      // 实时向 MCP Server 请求可用工具清单
      const result = await this.client.listTools();
      this.cachedTools = result.tools || MCP_TOOLS;
    } catch (err: any) {
      this.isRunning = false;
      this.lastError = err.message || String(err);
      console.error('[ai-review-mcp] Failed to initialize MCP client:', err);
      throw err;
    }
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    if (!this.isRunning || !this.client) {
      // 懒启动
      await this.start();
    }

    if (!this.client) {
      throw new Error('MCP client is not available');
    }

    const response = await this.client.callTool({
      name,
      arguments: args,
    });

    return response;
  }

  /**
   * 获取 MCP 服务的真实运行状态
   */
  getStatus(): McpStatus {
    return {
      running: this.isRunning,
      mode: this.currentMode,
      pid: process.pid,
      serverName: MCP_SERVER_NAME,
      serverVersion: MCP_SERVER_VERSION,
      tools: this.cachedTools.length > 0 ? this.cachedTools : MCP_TOOLS,
      toolCount: (this.cachedTools.length > 0 ? this.cachedTools : MCP_TOOLS).length,
      connectedAt: this.connectedAt,
      error: this.lastError,
    };
  }

  /**
   * 关闭 MCP 连接
   */
  async stop(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.clientTransport && typeof this.clientTransport.close === 'function') {
        await this.clientTransport.close();
      }
      if (this.serverTransport && typeof this.serverTransport.close === 'function') {
        await this.serverTransport.close();
      }
    } catch {
      // ignore
    } finally {
      this.client = null;
      this.clientTransport = null;
      this.serverTransport = null;
      this.isRunning = false;
    }
  }
}

export const mcpManager = new McpClientManager();
