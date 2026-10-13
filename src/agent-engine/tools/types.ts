export interface ToolResult {
  success: boolean;
  output: string;
  exitCode?: number;
  error?: string;
  [key: string]: any;
}

export interface AgentToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}
