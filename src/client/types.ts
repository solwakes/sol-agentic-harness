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

// Server-side tool use (like web_search) - executed by Anthropic, not us
export interface ServerToolUseContent {
  type: 'server_tool_use';
  id: string;
  name: string;
  input: unknown;
}

// Web search result from server
export interface WebSearchResult {
  type: 'web_search_result';
  url: string;
  title: string;
  encrypted_content: string;
  page_age?: string;
}

// Web search tool result error
export interface WebSearchToolResultError {
  type: 'web_search_tool_result_error';
  error_code: 'too_many_requests' | 'invalid_input' | 'max_uses_exceeded' | 'query_too_long' | 'unavailable';
}

// Web search tool result content block
export interface WebSearchToolResultContent {
  type: 'web_search_tool_result';
  tool_use_id: string;
  content: WebSearchResult[] | WebSearchToolResultError;
}

// Citation for web search results
export interface WebSearchCitation {
  type: 'web_search_result_location';
  url: string;
  title: string;
  encrypted_index: string;
  cited_text: string;
}

// Text content with optional citations
export interface TextContentWithCitations extends TextContent {
  citations?: WebSearchCitation[];
}

export type ContentBlock =
  | TextContent
  | TextContentWithCitations
  | ImageContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent
  | ServerToolUseContent
  | WebSearchToolResultContent;

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

// Web search tool definition (server-side tool)
export interface WebSearchToolDefinition {
  type: 'web_search_20250305';
  name: 'web_search';
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_location?: {
    type: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
}

// Union of all tool types that can be passed to the API
export type APIToolInput = ToolDefinitionAPI | WebSearchToolDefinition;

export interface ThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

export interface MessageParams {
  model: string;
  messages: Message[];
  max_tokens: number;
  system?: string | SystemBlock[];
  tools?: APIToolInput[];
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
    | { type: 'text'; text: string; citations?: WebSearchCitation[] }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'thinking'; thinking: string; signature?: string }
    | { type: 'server_tool_use'; id: string; name: string; input?: unknown }
    | { type: 'web_search_tool_result'; tool_use_id: string; content: WebSearchResult[] | WebSearchToolResultError };
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
