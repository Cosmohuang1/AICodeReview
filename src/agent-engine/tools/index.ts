import { readFileTool } from './read-file.js';
import { editFileTool } from './edit-file.js';
import { runCommandTool, type CommandProgress } from './run-command.js';
import { searchCodeTool } from './search-code.js';
import { listDirTool } from './list-dir.js';
import type { AgentToolDefinition, ToolResult } from './types.js';

export { readFileTool, editFileTool, runCommandTool, searchCodeTool, listDirTool };
export type { ToolResult, AgentToolDefinition };

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区中指定文件的文本内容，支持行号切片。返回带行号的内容，用于精准分析。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径，如 src/index.ts' },
          startLine: { type: 'number', description: '起始行号 (从 1 开始，可选)' },
          endLine: { type: 'number', description: '结束行号 (包含，可选)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '采用 Aider 范式精准替换文件中的局部代码块。必须提供待替换的确切原始代码 targetContent 与新代码 replacementContent。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径' },
          targetContent: { type: 'string', description: '待替换的原始代码片段（必须在文件中唯一存在）' },
          replacementContent: { type: 'string', description: '替换后的新代码片段' }
        },
        required: ['path', 'targetContent', 'replacementContent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在当前工程根目录执行真实的系统终端命令（如 npm test, git status, git diff, tsc --noEmit 等），并捕获完整的退出码、标准输出和标准错误。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '待执行的终端命令字符串' },
          timeoutMs: { type: 'number', description: '超时毫秒数，默认 45000' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: '在工作区源代码中搜索指定的关键词或正则表达式，返回匹配的文件路径和行号。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或正则表达式' },
          path: { type: 'string', description: '搜索限定子目录路径 (可选)' },
          maxResults: { type: 'number', description: '最大返回结果数，默认 50' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出指定目录下的子文件与子文件夹列表，标注目录结构与 Git 信息。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对目录路径，默认当前根目录 .' }
        },
        required: []
      }
    }
  }
];

export async function executeAgentTool(
  cwd: string,
  toolName: string,
  args: Record<string, any>,
  progress?: CommandProgress
): Promise<ToolResult> {
  switch (toolName) {
    case 'read_file':
      return readFileTool(cwd, args as any);
    case 'edit_file':
      return editFileTool(cwd, args as any);
    case 'run_command':
      return runCommandTool(cwd, args as any, progress);
    case 'search_code':
      return searchCodeTool(cwd, args as any);
    case 'list_dir':
      return listDirTool(cwd, args as any);
    default:
      return {
        success: false,
        output: `未知工具名称: ${toolName}。可用工具: read_file, edit_file, run_command, search_code, list_dir`,
        error: `未知工具: ${toolName}`
      };
  }
}
