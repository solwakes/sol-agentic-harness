/**
 * Anthropic API Client with streaming support and Claude subscription auth.
 */

import { TokenManager, type TokenManagerOptions } from './token-manager.js';
import {
  type MessageParams,
  type StreamEvent,
  type SystemBlock,
  type Message,
  type ContentBlock,
  type CacheControl,
  APIError,
  RateLimitError,
  AuthenticationError,
  OverloadedError,
} from './types.js';
import { parseSSE } from '../utils/streaming.js';

// Constants
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Beta features required for OAuth authentication
const ANTHROPIC_BETA_FEATURES = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'fine-grained-tool-streaming-2025-05-14',
];

// Required system prompt prefix for subscription auth
const REQUIRED_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.";

export interface AnthropicClientOptions extends TokenManagerOptions {
  /** Additional beta features to enable */
  additionalBetas?: string[];
  /** Request timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
}

export class AnthropicClient {
  private tokenManager: TokenManager;
  private betaFeatures: string[];
  private timeout: number;

  constructor(options: AnthropicClientOptions = {}) {
    this.tokenManager = new TokenManager(options);
    this.betaFeatures = [...ANTHROPIC_BETA_FEATURES, ...(options.additionalBetas ?? [])];
    this.timeout = options.timeout ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Build the system prompt array, ensuring the required prefix comes first.
   * Adds cache_control to system blocks for prompt caching optimization.
   */
  private buildSystemPrompt(system?: string | SystemBlock[]): SystemBlock[] {
    const result: SystemBlock[] = [
      {
        type: 'text',
        text: REQUIRED_SYSTEM_PREFIX,
        cache_control: { type: 'ephemeral' },
      },
    ];

    if (!system) {
      return result;
    }

    if (typeof system === 'string') {
      // Add cache_control to user's system prompt for caching
      result.push({
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      });
    } else {
      // Filter out any duplicate prefix if caller accidentally included it
      // Add cache_control to the last block for optimal caching
      const userBlocks = system.filter(block => block.text !== REQUIRED_SYSTEM_PREFIX);
      for (let i = 0; i < userBlocks.length; i++) {
        const block = userBlocks[i];
        const isLast = i === userBlocks.length - 1;
        result.push({
          ...block,
          // Add cache_control to the last block (most efficient caching point)
          ...(isLast && !block.cache_control ? { cache_control: { type: 'ephemeral' } } : {}),
        });
      }
    }

    return result;
  }

  /**
   * Inject cache breakpoints into message history for prompt caching.
   * 
   * Strategy: Add cache_control to the last content block of the second-to-last
   * user message. This caches all conversation history up to that point,
   * so only the most recent exchange needs to be processed fresh.
   * 
   * Per Anthropic docs:
   * - Cache prefixes are created in order: tools, system, then messages
   * - The system checks backwards up to 20 blocks from breakpoint
   * - Minimum cacheable length: 4096 tokens (Opus 4.5), 1024 tokens (Sonnet/others)
   */
  private injectCacheBreakpoints(messages: Message[]): Message[] {
    if (messages.length < 3) {
      // Not enough messages to benefit from caching
      return messages;
    }

    // Deep clone to avoid mutating the original
    const result = messages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string'
        ? msg.content
        : msg.content.map(block => ({ ...block }))
    }));

    // Find the second-to-last user message (the one before the current turn)
    let userMessageCount = 0;
    let targetIndex = -1;
    
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        userMessageCount++;
        if (userMessageCount === 2) {
          targetIndex = i;
          break;
        }
      }
    }

    // If we found a target, add cache_control to its last content block
    if (targetIndex >= 0) {
      const msg = result[targetIndex];
      if (Array.isArray(msg.content) && msg.content.length > 0) {
        const lastBlock = msg.content[msg.content.length - 1];
        // Don't add to thinking blocks (per docs, they can't have cache_control)
        if (lastBlock.type !== 'thinking') {
          (lastBlock as ContentBlock & { cache_control?: CacheControl }).cache_control = { type: 'ephemeral' };
        }
      }
    }

    return result;
  }

  /**
   * Build request headers.
   */
  private async buildHeaders(forceRefresh = false): Promise<Record<string, string>> {
    const accessToken = await this.tokenManager.getAccessToken(forceRefresh);

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': this.betaFeatures.join(','),
    };
  }

  /**
   * Parse error response into appropriate error type.
   */
  private async parseError(response: Response): Promise<APIError> {
    let errorBody: { error?: { type?: string; message?: string } } = {};

    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // Couldn't parse JSON, use status text
    }

    const errorType = errorBody.error?.type ?? 'unknown_error';
    const errorMessage = errorBody.error?.message ?? response.statusText ?? 'Unknown error';

    switch (response.status) {
      case 401:
        return new AuthenticationError(errorMessage);

      case 429: {
        const retryAfter = response.headers.get('retry-after');
        return new RateLimitError(
          retryAfter ? parseInt(retryAfter, 10) : null,
          errorMessage
        );
      }

      case 529:
        return new OverloadedError(errorMessage);

      default:
        return new APIError(response.status, errorType, errorMessage);
    }
  }

  /**
   * Stream a message request, yielding events as they arrive.
   */
  async *streamMessage(params: MessageParams): AsyncGenerator<StreamEvent> {
    // Inject cache breakpoints into messages for prompt caching
    const messagesWithCache = this.injectCacheBreakpoints(params.messages);

    // Build request body
    const body = {
      ...params,
      messages: messagesWithCache,
      system: this.buildSystemPrompt(params.system),
      stream: true,
    };

    // First attempt
    let headers = await this.buildHeaders();
    let response = await this.fetchWithTimeout(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Retry on 401 with token refresh
    if (response.status === 401) {
      headers = await this.buildHeaders(true);
      response = await this.fetchWithTimeout(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    }

    // Handle errors
    if (!response.ok) {
      throw await this.parseError(response);
    }

    // Stream the response
    const stream = response.body;
    if (!stream) {
      throw new Error('Response body is null');
    }

    yield* parseSSE(stream);
  }

  /**
   * Fetch with timeout support.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get the token manager for direct access (e.g., subscription info).
   */
  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  /**
   * Add a beta feature to requests.
   */
  addBetaFeature(feature: string): void {
    if (!this.betaFeatures.includes(feature)) {
      this.betaFeatures.push(feature);
    }
  }
}

export { TokenManager };
