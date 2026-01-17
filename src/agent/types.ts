/**
 * Agent loop type definitions.
 */

import type { Message, SystemBlock, Usage } from '../client/types.js';
import type { ToolResultContent } from '../tools/types.js';
import type { ToolDefinition } from '../tools/types.js';
import type { HookRegistry } from './hooks.js';

export interface ThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;
}

export interface AutoCompactConfig {
  /** Enable auto-compaction (default: false) */
  enabled: boolean;
  /** Context usage threshold percentage to trigger compaction (default: 80) */
  thresholdPercent?: number;
  /** Callback to perform compaction - receives current messages, returns compacted messages */
  onCompact?: (messages: Message[], sessionId: string) => Promise<Message[]>;
}

export interface RunParams {
  /** Conversation messages */
  messages: Message[];
  /** System prompt (string or blocks) */
  system?: string | SystemBlock[];
  /** Model to use (default: claude-sonnet-4-5-20250929) */
  model?: string;
  /** Tools available to the agent */
  tools?: ToolDefinition[];
  /** Hook registry for event interception */
  hooks?: HookRegistry;
  /** Maximum agentic turns before stopping (default: Infinity) */
  maxTurns?: number;
  /** Maximum output tokens per response (default: 16384) */
  maxTokens?: number;
  /** Extended thinking configuration */
  thinking?: ThinkingConfig;
  /** Working directory for tool execution */
  workingDir?: string;
  /** Session ID for tracking */
  sessionId?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Auto-compact configuration (disabled by default) */
  autoCompact?: AutoCompactConfig;
  /** Maximum context tokens (for auto-compact threshold calculation, default: 200000) */
  maxContextTokens?: number;
}

// Agent events yielded during execution
export interface ThinkingEvent {
  type: 'thinking';
  content: string;
}

export interface TextEvent {
  type: 'text';
  content: string;
}

export interface ToolUseEvent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  id: string;
  name: string;
  content: string | ToolResultContent[];
  is_error: boolean;
}

export interface TurnCompleteEvent {
  type: 'turn_complete';
  usage: Usage;
  turnNumber: number;
  sessionId: string;
}

export interface DoneEvent {
  type: 'done';
  totalUsage: Usage;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'max_turns' | 'cancelled';
  turnCount: number;
  sessionId: string;
}

export interface ErrorEvent {
  type: 'error';
  error: Error;
}

export interface CompactEvent {
  type: 'compact';
  previousMessageCount: number;
  newMessageCount: number;
  sessionId: string;
}

export type AgentEvent =
  | ThinkingEvent
  | TextEvent
  | ToolUseEvent
  | ToolResultEvent
  | TurnCompleteEvent
  | DoneEvent
  | ErrorEvent
  | CompactEvent;

// Accumulated message content during streaming
export interface AccumulatedContent {
  type: 'text' | 'tool_use' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: string; // JSON string, parsed later
  signature?: string; // Required for thinking blocks when sending back to API
}
