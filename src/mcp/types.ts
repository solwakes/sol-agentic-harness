/**
 * MCP (Model Context Protocol) type definitions.
 *
 * Based on the MCP specification for JSON-RPC 2.0 over stdio.
 */

// JSON-RPC 2.0 types
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// MCP-specific types
export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPToolsListResult {
  tools: MCPToolDefinition[];
}

export interface MCPToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export interface MCPInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: Record<string, unknown>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// Server configuration
export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Auto-restart on crash (default: true) */
  restartOnCrash?: boolean;
  /** Maximum restart attempts (default: 3) */
  maxRestarts?: number;
  /** Health check interval in ms (default: 30000) */
  healthCheckInterval?: number;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
}

// Server status
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MCPServerInfo {
  name: string;
  config: MCPServerConfig;
  status: MCPServerStatus;
  tools: MCPToolDefinition[];
  error?: string;
  pid?: number;
  restartCount: number;
  lastHealthCheck?: number;
}

// Custom errors
export class MCPServerUnavailableError extends Error {
  constructor(public serverName: string) {
    super(`MCP server '${serverName}' is unavailable`);
    this.name = 'MCPServerUnavailableError';
  }
}

export class MCPRequestTimeoutError extends Error {
  constructor(
    public serverName: string,
    public timeoutMs: number
  ) {
    super(`MCP request to '${serverName}' timed out after ${timeoutMs}ms`);
    this.name = 'MCPRequestTimeoutError';
  }
}

export class MCPCallError extends Error {
  constructor(
    public serverName: string,
    public toolName: string,
    public code: number,
    message: string
  ) {
    super(`MCP call to ${serverName}.${toolName} failed: ${message}`);
    this.name = 'MCPCallError';
  }
}
