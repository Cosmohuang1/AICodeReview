import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server as HttpServer } from 'http';
import { app } from '../../src/server/app.js';
import { createMcpServer, MCP_TOOLS } from '../../src/mcp/server.js';
import { mcpManager } from '../../src/mcp/client.js';
import { generateMcpIdeConfig } from '../../src/mcp/config.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('Model Context Protocol (MCP) Server & Client Suite', () => {
  let server: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await mcpManager.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('MCP Server Tools Registration', () => {
    it('defines 5 standard tools matching MCP specification', () => {
      expect(MCP_TOOLS.length).toBe(5);
      const toolNames = MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('scan_and_check_rules');
      expect(toolNames).toContain('ast_chunk_files');
      expect(toolNames).toContain('build_target_projects');
      expect(toolNames).toContain('inspect_file_symbol');
      expect(toolNames).toContain('execute_command');
    });

    it('can connect client and query ListTools over InMemoryTransport', async () => {
      const mcpServer = createMcpServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      const client = new Client(
        { name: 'test-client', version: '1.0.0' },
        { capabilities: {} }
      );

      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const listResult = await client.listTools();
      expect(listResult.tools.length).toBe(5);

      await client.close();
      await mcpServer.close();
    });
  });

  describe('MCP Tool Execution: scan_and_check_rules', () => {
    it('detects hardcoded host absolute path and leftover debug exception', async () => {
      const mcpServer = createMcpServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const mockDiff = `diff --git a/Services/DataService.cs b/Services/DataService.cs
--- a/Services/DataService.cs
+++ b/Services/DataService.cs
@@ -10,3 +10,5 @@ namespace Test;
+var dbPath = @"d:\\opc\\ACLPlugins\\ACLPlugins.Host\\App_Data\\acl.db";
+throw new Exception($"RESULT => TOTAL: {page.Total}");
`;

      const result = await client.callTool({
        name: 'scan_and_check_rules',
        arguments: {
          diffText: mockDiff,
          filePath: 'Services/DataService.cs',
        },
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');

      const parsedData = JSON.parse((result.content[0] as any).text);
      expect(parsedData.success).toBe(true);
      expect(parsedData.totalViolations).toBeGreaterThanOrEqual(2);

      const messages = parsedData.violations.map((v: any) => v.message);
      expect(messages.some((m: string) => m.includes('宿主机绝对路径'))).toBe(true);
      expect(messages.some((m: string) => m.includes('调试排查异常抛出遗留'))).toBe(true);

      await client.close();
      await mcpServer.close();
    });
  });

  describe('MCP Tool Execution: ast_chunk_files', () => {
    it('parses diff and produces AST chunks', async () => {
      const mcpServer = createMcpServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);

      const mockDiff = `diff --git a/index.ts b/index.ts
--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,4 @@
 export function hello() {
+  console.log("world");
 }
`;

      const result = await client.callTool({
        name: 'ast_chunk_files',
        arguments: {
          diffText: mockDiff,
          maxTokens: 4000,
        },
      });

      const parsedData = JSON.parse((result.content[0] as any).text);
      expect(parsedData.success).toBe(true);
      expect(parsedData.fileCount).toBe(1);
      expect(parsedData.chunkCount).toBe(1);
      expect(parsedData.chunks[0].file).toBe('index.ts');

      await client.close();
      await mcpServer.close();
    });
  });

  describe('McpClientManager lifecycle', () => {
    it('manages singleton connection and reports live status with PID', async () => {
      await mcpManager.start();
      const status = mcpManager.getStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
      expect(status.toolCount).toBe(5);
      expect(status.tools.length).toBe(5);

      // Call tool via manager
      const callRes = await mcpManager.callTool('scan_and_check_rules', {
        diffText: '+const apiKey = "sk-1234567890abcdef1234567890";',
      });
      const data = JSON.parse(callRes.content[0].text);
      expect(data.totalViolations).toBeGreaterThanOrEqual(1);
    });
  });

  describe('MCP HTTP Endpoints', () => {
    it('GET /api/mcp/status returns live status with tool count and PID', async () => {
      const res = await fetch(`${baseUrl}/api/mcp/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.running).toBe(true);
      expect(data.pid).toBe(process.pid);
      expect(data.toolCount).toBe(5);
      expect(Array.isArray(data.tools)).toBe(true);
    });

    it('POST /api/mcp/call invokes MCP tool over HTTP', async () => {
      const res = await fetch(`${baseUrl}/api/mcp/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'scan_and_check_rules',
          arguments: {
            diffText: '+var path = "C:\\\\Secret\\\\data.db";',
          },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.tool).toBe('scan_and_check_rules');

      const toolContent = JSON.parse(data.result.content[0].text);
      expect(toolContent.totalViolations).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/mcp/config returns IDE configuration for Claude Desktop / Cursor', async () => {
      const res = await fetch(`${baseUrl}/api/mcp/config`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.config.mcpServers['ai-review']).toBeDefined();
      expect(data.config.mcpServers['ai-review'].command).toBe('npx');
    });
  });
});
