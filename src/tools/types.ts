/**
 * Tool system type definitions.
 */

import type { HookRegistry } from '../agent/hooks.js';

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
}

export interface ToolContext {
  /** Current working directory */
  workingDir: string;
  /** Session ID if available */
  sessionId?: string;
  /** Hook registry for pre/post tool execution hooks */
  hooks?: HookRegistry;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Environment variables to use for commands */
  env?: Record<string, string>;
}

export interface ToolResult {
  /** Result content - string or structured content blocks */
  content: string | ToolResultContent[];
  /** Whether this result represents an error */
  is_error?: boolean;
}

export interface ToolResultContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface ToolDefinition {
  /** Tool name (used in API requests) */
  name: string;
  /** Tool description (shown to Claude) */
  description: string;
  /** JSON Schema for tool input */
  input_schema: JSONSchema;
  /** Execute the tool with given input and context */
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

/**
 * Convert a ToolDefinition to the API format (without execute function).
 */
export function toAPIToolDefinition(tool: ToolDefinition): {
  name: string;
  description: string;
  input_schema: JSONSchema;
} {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}

/**
 * Error thrown when a tool execution times out.
 */
export class ToolTimeoutError extends Error {
  constructor(
    public toolName: string,
    public timeoutMs: number
  ) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

/**
 * Error thrown when a tool is not found.
 */
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) {
    super(`Tool '${toolName}' not found`);
    this.name = 'ToolNotFoundError';
  }
}
