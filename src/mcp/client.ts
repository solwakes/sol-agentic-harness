/**
 * MCP Client - JSON-RPC 2.0 communication over stdio.
 */

import type { ChildProcess } from 'node:child_process';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPToolsListResult,
  MCPToolCallParams,
  MCPToolCallResult,
} from './types.js';
import { MCPRequestTimeoutError, MCPCallError } from './types.js';

export interface MCPClientOptions {
  serverName: string;
  requestTimeout?: number;
}

export class MCPClient {
  private process: ChildProcess;
  private serverName: string;
  private requestTimeout: number;
  private requestId = 0;
  private pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private buffer = '';
  private initialized = false;

  constructor(process: ChildProcess, options: MCPClientOptions) {
    this.process = process;
    this.serverName = options.serverName;
    this.requestTimeout = options.requestTimeout ?? 30000;

    this.setupStdio();
  }

  private setupStdio(): void {
    // Handle incoming data
    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    // Handle errors
    this.process.stderr?.on('data', (data: Buffer) => {
      // Log stderr but don't fail
      console.error(`[MCP:${this.serverName}] stderr:`, data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`MCP server exited with code ${code}`));
        this.pendingRequests.delete(id);
      }
    });
  }

  private processBuffer(): void {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        // Invalid JSON, skip
        console.error(`[MCP:${this.serverName}] Invalid JSON:`, line);
      }
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    // Check if this is a response to a pending request
    if ('id' in message && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(
            new MCPCallError(
              this.serverName,
              'unknown',
              message.error.code,
              message.error.message
            )
          );
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // Notifications (no id) are handled silently for now
  }

  private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new MCPRequestTimeoutError(this.serverName, this.requestTimeout));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send the request
      const json = JSON.stringify(request) + '\n';
      this.process.stdin?.write(json);
    });
  }

  /**
   * Initialize the MCP connection.
   */
  async initialize(): Promise<MCPInitializeResult> {
    const params: MCPInitializeParams = {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: {
        name: 'sol-agentic-harness',
        version: '1.0.0',
      },
    };

    const result = await this.sendRequest<MCPInitializeResult>('initialize', params);
    this.initialized = true;

    // Send initialized notification
    const notification = {
      jsonrpc: '2.0' as const,
      method: 'notifications/initialized',
    };
    this.process.stdin?.write(JSON.stringify(notification) + '\n');

    return result;
  }

  /**
   * List available tools.
   */
  async listTools(): Promise<MCPToolsListResult> {
    if (!this.initialized) {
      throw new Error('MCP client not initialized');
    }

    return this.sendRequest<MCPToolsListResult>('tools/list');
  }

  /**
   * Call a tool.
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<MCPToolCallResult> {
    if (!this.initialized) {
      throw new Error('MCP client not initialized');
    }

    const params: MCPToolCallParams = {
      name,
      arguments: args,
    };

    return this.sendRequest<MCPToolCallResult>('tools/call', params);
  }

  /**
   * Send a ping to check if the server is responsive.
   */
  async ping(): Promise<boolean> {
    try {
      await this.sendRequest('ping');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the connection gracefully.
   */
  async shutdown(): Promise<void> {
    try {
      await this.sendRequest('shutdown');
    } catch {
      // Ignore errors during shutdown
    }
  }

  /**
   * Check if the client is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if the process is still running.
   */
  isAlive(): boolean {
    return this.process.exitCode === null && !this.process.killed;
  }
}
