/**
 * MCP Server Manager - Spawn and manage MCP server processes.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Health checks
 * - Graceful degradation
 * - Process cleanup
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { MCPClient } from './client.js';
import type {
  MCPServerConfig,
  MCPServerInfo,
  MCPServerStatus,
  MCPToolDefinition,
  MCPToolCallResult,
} from './types.js';
import { MCPServerUnavailableError } from './types.js';
import type { ToolDefinition, ToolResult } from '../tools/types.js';

export interface MCPManagerConfig {
  servers: Record<string, MCPServerConfig>;
}

interface ManagedServer {
  config: MCPServerConfig;
  process: ChildProcess | null;
  client: MCPClient | null;
  tools: MCPToolDefinition[];
  status: MCPServerStatus;
  error?: string;
  restartCount: number;
  lastHealthCheck: number;
  healthCheckTimer?: NodeJS.Timeout;
}

export class MCPServerManager {
  private servers: Map<string, ManagedServer> = new Map();
  private shuttingDown = false;

  constructor(config?: MCPManagerConfig) {
    if (config?.servers) {
      for (const [name, serverConfig] of Object.entries(config.servers)) {
        this.addServer(name, serverConfig);
      }
    }

    // Clean up on process exit
    process.on('exit', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Add a server configuration.
   */
  addServer(name: string, config: MCPServerConfig): void {
    this.servers.set(name, {
      config: {
        restartOnCrash: true,
        maxRestarts: 3,
        healthCheckInterval: 30000,
        requestTimeout: 30000,
        ...config,
      },
      process: null,
      client: null,
      tools: [],
      status: 'disconnected',
      restartCount: 0,
      lastHealthCheck: 0,
    });
  }

  /**
   * Connect to a server.
   */
  async connect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`MCP server '${name}' not configured`);
    }

    if (server.status === 'connected' && server.client?.isAlive()) {
      return; // Already connected
    }

    server.status = 'connecting';

    try {
      await this.spawnServer(name, server);
      server.status = 'connected';
      server.restartCount = 0;

      // Start health checks
      this.startHealthCheck(name, server);
    } catch (error) {
      server.status = 'error';
      server.error = (error as Error).message;
      throw error;
    }
  }

  private async spawnServer(name: string, server: ManagedServer): Promise<void> {
    const { config } = server;

    // Spawn the process
    const proc = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    server.process = proc;

    // Create client
    const client = new MCPClient(proc, {
      serverName: name,
      requestTimeout: config.requestTimeout,
    });

    server.client = client;

    // Handle process exit
    proc.on('exit', (code) => {
      if (this.shuttingDown) return;

      console.error(`[MCP:${name}] Process exited with code ${code}`);
      server.status = 'disconnected';
      server.process = null;
      server.client = null;

      // Auto-restart if enabled
      if (
        config.restartOnCrash &&
        server.restartCount < (config.maxRestarts ?? 3)
      ) {
        server.restartCount++;
        const delay = Math.min(1000 * Math.pow(2, server.restartCount - 1), 30000);
        console.log(
          `[MCP:${name}] Restarting in ${delay}ms (attempt ${server.restartCount})`
        );

        setTimeout(() => {
          if (!this.shuttingDown) {
            this.connect(name).catch((err) => {
              console.error(`[MCP:${name}] Restart failed:`, err.message);
            });
          }
        }, delay);
      }
    });

    // Initialize
    await client.initialize();

    // List tools
    const toolsResult = await client.listTools();
    server.tools = toolsResult.tools;

    console.log(`[MCP:${name}] Connected with ${server.tools.length} tools`);
  }

  private startHealthCheck(name: string, server: ManagedServer): void {
    if (server.healthCheckTimer) {
      clearInterval(server.healthCheckTimer);
    }

    const interval = server.config.healthCheckInterval ?? 30000;

    server.healthCheckTimer = setInterval(async () => {
      if (server.client && server.status === 'connected') {
        const healthy = await server.client.ping();
        server.lastHealthCheck = Date.now();

        if (!healthy) {
          console.warn(`[MCP:${name}] Health check failed`);
          // The exit handler will trigger reconnection
          server.process?.kill();
        }
      }
    }, interval);
  }

  /**
   * Get a connected server, connecting if necessary.
   */
  private async ensureConnected(name: string): Promise<ManagedServer> {
    const server = this.servers.get(name);
    if (!server) {
      throw new MCPServerUnavailableError(name);
    }

    if (server.status !== 'connected' || !server.client?.isAlive()) {
      await this.connect(name);
    }

    return server;
  }

  /**
   * Call a tool on an MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<MCPToolCallResult> {
    const server = await this.ensureConnected(serverName);

    if (!server.client) {
      throw new MCPServerUnavailableError(serverName);
    }

    return server.client.callTool(toolName, args);
  }

  /**
   * Get all tools from all connected servers as ToolDefinitions.
   */
  async getAllToolDefinitions(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];

    for (const [serverName, server] of this.servers.entries()) {
      // Try to connect if not connected
      if (server.status !== 'connected') {
        try {
          await this.connect(serverName);
        } catch {
          // Skip unavailable servers
          continue;
        }
      }

      for (const mcpTool of server.tools) {
        tools.push(this.mcpToolToToolDefinition(serverName, mcpTool));
      }
    }

    return tools;
  }

  /**
   * Get tools from a specific server.
   */
  async getServerTools(serverName: string): Promise<ToolDefinition[]> {
    const server = await this.ensureConnected(serverName);

    return server.tools.map((t) => this.mcpToolToToolDefinition(serverName, t));
  }

  /**
   * Convert an MCP tool to a ToolDefinition.
   */
  private mcpToolToToolDefinition(
    serverName: string,
    mcpTool: MCPToolDefinition
  ): ToolDefinition {
    const fullName = `mcp__${serverName}__${mcpTool.name}`;

    return {
      name: fullName,
      description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
      input_schema: mcpTool.inputSchema as import('../tools/types.js').JSONSchema,
      execute: async (input: unknown): Promise<ToolResult> => {
        try {
          const result = await this.callTool(
            serverName,
            mcpTool.name,
            input as Record<string, unknown>
          );

          // Convert MCP result to ToolResult
          const content = result.content
            .map((c) => {
              if (c.type === 'text') return c.text ?? '';
              if (c.type === 'image') return `[Image: ${c.mimeType}]`;
              return `[Resource]`;
            })
            .join('\n');

          return {
            content,
            is_error: result.isError,
          };
        } catch (error) {
          return {
            content: `MCP error: ${(error as Error).message}`,
            is_error: true,
          };
        }
      },
    };
  }

  /**
   * Get server info.
   */
  getServerInfo(name: string): MCPServerInfo | undefined {
    const server = this.servers.get(name);
    if (!server) return undefined;

    return {
      name,
      config: server.config,
      status: server.status,
      tools: server.tools,
      error: server.error,
      pid: server.process?.pid,
      restartCount: server.restartCount,
      lastHealthCheck: server.lastHealthCheck,
    };
  }

  /**
   * Get all server info.
   */
  getAllServerInfo(): MCPServerInfo[] {
    const info: MCPServerInfo[] = [];
    for (const [name] of this.servers.entries()) {
      const serverInfo = this.getServerInfo(name);
      if (serverInfo) info.push(serverInfo);
    }
    return info;
  }

  /**
   * Disconnect a specific server.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    if (server.healthCheckTimer) {
      clearInterval(server.healthCheckTimer);
      server.healthCheckTimer = undefined;
    }

    if (server.client) {
      try {
        await server.client.shutdown();
      } catch {
        // Ignore errors
      }
    }

    if (server.process) {
      server.process.kill();
      server.process = null;
    }

    server.client = null;
    server.status = 'disconnected';
  }

  /**
   * Shutdown all servers.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    const disconnectPromises: Promise<void>[] = [];
    for (const [name] of this.servers.entries()) {
      disconnectPromises.push(this.disconnect(name));
    }

    await Promise.all(disconnectPromises);
  }
}
