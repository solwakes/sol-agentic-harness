/**
 * Type definitions for the Anthropic API client.
 */

// OAuth credential types
export interface ClaudeOAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Milliseconds since epoch
  subscriptionType?: 'pro' | 'max';
  rateLimitTier?: string;
  scopes?: string[];
}

export interface Credentials {
  claudeAiOauth?: ClaudeOAuth;
}

export interface SubscriptionInfo {
  type: 'pro' | 'max' | 'unknown';
  tier: string;
  scopes: string[];
}

// Cache control for prompt caching
export interface CacheControl {
  type: 'ephemeral';
}

// API message types
export interface TextContent {
  type: 'text';
  text: string;
  cache_control?: CacheControl;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  cache_control?: CacheControl;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
  cache_control?: CacheControl;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
  cache_control?: CacheControl;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string; // Required when sending thinking blocks back to API
  // Note: thinking blocks cannot have cache_control directly per Anthropic docs
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ToolDefinitionAPI {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

export interface MessageParams {
  model: string;
  messages: Message[];
  max_tokens: number;
  system?: string | SystemBlock[];
  tools?: ToolDefinitionAPI[];
  thinking?: ThinkingConfig;
  temperature?: number;
  stream?: boolean;
}

// API response types
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface APIMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  stop_sequence?: string;
  usage: Usage;
}

// Streaming event types
export interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: Usage;
  };
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'thinking'; thinking: string; signature?: string };
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'input_json_delta'; partial_json: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'signature_delta'; signature: string };
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
    stop_sequence?: string;
  };
  usage: {
    output_tokens: number;
  };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

export interface PingEvent {
  type: 'ping';
}

export interface ErrorEvent {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | PingEvent
  | ErrorEvent;

// Error types
export class APIError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class RateLimitError extends APIError {
  constructor(
    public retryAfter: number | null,
    message: string
  ) {
    super(429, 'rate_limit_error', message);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends APIError {
  constructor(message: string) {
    super(401, 'authentication_error', message);
    this.name = 'AuthenticationError';
  }
}

export class OverloadedError extends APIError {
  constructor(message: string) {
    super(529, 'overloaded_error', message);
    this.name = 'OverloadedError';
  }
}
