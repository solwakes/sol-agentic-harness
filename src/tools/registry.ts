/**
 * Tool registry for managing available tools.
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { ToolNotFoundError, ToolTimeoutError } from './types.js';

export interface ToolRegistryOptions {
  /** Default timeout for tool execution in milliseconds */
  defaultTimeout?: number;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private defaultTimeout: number;

  constructor(options: ToolRegistryOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 120_000; // 2 minutes default
  }

  /**
   * Register a tool.
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools.
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all tool names.
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Remove a tool by name.
   */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Clear all tools.
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Execute a tool with timeout.
   */
  async execute(
    name: string,
    input: unknown,
    context: ToolContext,
    timeout?: number
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    const effectiveTimeout = timeout ?? this.defaultTimeout;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, effectiveTimeout);

    // Merge abort signals if context has one
    const contextWithAbort: ToolContext = {
      ...context,
      abortSignal: context.abortSignal
        ? this.mergeAbortSignals(context.abortSignal, controller.signal)
        : controller.signal,
    };

    try {
      const result = await Promise.race([
        tool.execute(input, contextWithAbort),
        this.createTimeoutPromise(name, effectiveTimeout, controller.signal),
      ]);

      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ToolTimeoutError(name, effectiveTimeout);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private createTimeoutPromise(
    toolName: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<never> {
    return new Promise((_, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new ToolTimeoutError(toolName, timeoutMs));
        },
        { once: true }
      );
    });
  }

  private mergeAbortSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();

    signal1.addEventListener('abort', abort, { once: true });
    signal2.addEventListener('abort', abort, { once: true });

    return controller.signal;
  }
}
