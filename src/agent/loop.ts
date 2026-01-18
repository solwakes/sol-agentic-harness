/**
 * AgentLoop - The main agentic execution loop.
 *
 * Streams Claude responses, executes tools, and manages the conversation.
 */

import { randomUUID } from 'node:crypto';
import { AnthropicClient, type AnthropicClientOptions } from '../client/api-client.js';
import type {
  Message,
  ContentBlock,
  Usage,
  StreamEvent,
  ThinkingConfig,
} from '../client/types.js';
import { ToolRegistry } from '../tools/registry.js';
import { toAPIToolDefinition, type ToolDefinition, type ToolContext, type ToolResultContent } from '../tools/types.js';
import { getWebSearchAPITool } from '../tools/builtin/web-search.js';
import { HookRegistry } from './hooks.js';
import { TranscriptWriter, type TruncationInfo } from './transcript.js';
import type { RunParams, AgentEvent, AccumulatedContent } from './types.js';

export interface AgentLoopOptions extends AnthropicClientOptions {
  /** Default working directory */
  workingDir?: string;
  /** Default tool timeout in milliseconds */
  toolTimeout?: number;
  /** Enable JSONL transcript writing (default: true) */
  transcripts?: boolean;
}

/**
 * Result of loading a session, including any truncation info.
 */
export interface LoadSessionResult {
  loaded: boolean;
  messageCount: number;
  truncation: TruncationInfo;
}

export class AgentLoop {
  private client: AnthropicClient;
  private toolRegistry: ToolRegistry;
  private defaultWorkingDir: string;
  private cancelled = false;
  private transcriptWriter: TranscriptWriter;

  // Conversation state - persists across run() calls
  private conversationHistory: Message[] = [];
  private currentSessionId: string | null = null;

  constructor(options: AgentLoopOptions = {}) {
    this.client = new AnthropicClient(options);
    this.toolRegistry = new ToolRegistry({ defaultTimeout: options.toolTimeout });
    this.defaultWorkingDir = options.workingDir ?? process.cwd();
    this.transcriptWriter = new TranscriptWriter({
      cwd: this.defaultWorkingDir,
      enabled: options.transcripts ?? true,
    });
  }

  /**
   * Clear conversation history and start fresh.
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.currentSessionId = null;
  }

  /**
   * Get the current conversation history.
   */
  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Get the current session ID.
   */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Register tools with the agent.
   */
  registerTools(tools: ToolDefinition[]): void {
    this.toolRegistry.registerAll(tools);
  }

  /**
   * Load a session from a transcript file.
   * Restores conversation history and session ID for continuity across restarts.
   * Returns info about whether the session was loaded and any truncation that occurred.
   */
  async loadSession(sessionId: string, workingDir?: string): Promise<LoadSessionResult> {
    const cwd = workingDir ?? this.defaultWorkingDir;
    this.transcriptWriter.setCwd(cwd);

    const result = await this.transcriptWriter.loadTranscript(sessionId);
    if (result.messages.length === 0) {
      return { loaded: false, messageCount: 0, truncation: { truncated: false } };
    }

    this.conversationHistory = result.messages;
    this.currentSessionId = sessionId;
    console.log(`[AgentLoop] Loaded session ${sessionId} with ${result.messages.length} messages`);
    
    if (result.truncation.truncated) {
      console.warn(`[AgentLoop] Session was truncated: ${result.truncation.reason}`);
    }
    
    return {
      loaded: true,
      messageCount: result.messages.length,
      truncation: result.truncation,
    };
  }

  /**
   * Check if a transcript exists for a session.
   */
  hasTranscript(sessionId: string, workingDir?: string): boolean {
    const cwd = workingDir ?? this.defaultWorkingDir;
    this.transcriptWriter.setCwd(cwd);
    return this.transcriptWriter.transcriptExists(sessionId);
  }

  /**
   * Run the agent loop.
   *
   * If the loop has existing conversation history, new messages are appended to it.
   * The conversation history is updated after each run completes.
   */
  async *run(params: RunParams): AsyncGenerator<AgentEvent> {
    this.cancelled = false;

    const {
      messages: newMessages,
      system,
      model = 'claude-sonnet-4-5-20250929',
      tools = [],
      hooks = new HookRegistry(),
      maxTurns = Infinity,
      maxTokens = 16384,
      thinking = { enabled: true, budgetTokens: 10000 },
      workingDir = this.defaultWorkingDir,
      sessionId: providedSessionId,
      abortSignal,
      autoCompact = { enabled: false },
      maxContextTokens = 200_000,
    } = params;

    // Session management: reuse existing or create new
    if (this.currentSessionId === null) {
      this.currentSessionId = providedSessionId ?? randomUUID();
    }
    const sessionId = this.currentSessionId;

    // Auto-compact configuration
    const compactThreshold = (autoCompact.thresholdPercent ?? 80) / 100;

    // Register tools for this run
    const toolRegistry = new ToolRegistry();
    toolRegistry.registerAll([...this.toolRegistry.getAll(), ...tools]);

    // Build tool context
    const toolContext: ToolContext = {
      workingDir,
      sessionId,
      hooks,
      abortSignal,
    };

    // Build conversation: existing history + new messages
    // If there's existing history, append new messages to it
    // Otherwise, start fresh with the new messages
    let messages: Message[] = this.conversationHistory.length > 0
      ? [...this.conversationHistory, ...newMessages]
      : [...newMessages];
    let turnNumber = 0;

    // Update transcript writer cwd if different
    this.transcriptWriter.setCwd(workingDir);

    // Write new user messages to transcript (async, don't await)
    for (const msg of newMessages) {
      if (msg.role === 'user') {
        this.transcriptWriter.writeUserMessage(sessionId, msg.content).catch((err) => {
          console.error('[AgentLoop] Failed to write user message to transcript:', err);
        });
      }
    }
    const totalUsage: Usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };

    // Handle abort signal
    abortSignal?.addEventListener(
      'abort',
      () => {
        this.cancelled = true;
      },
      { once: true }
    );

    // Main loop
    while (turnNumber < maxTurns && !this.cancelled) {
      turnNumber++;

      try {
        // Build API request
        // Include both regular tools and server-side tools (like web_search)
        const regularTools = toolRegistry.getAll().map(toAPIToolDefinition);
        const apiTools = [
          ...regularTools,
          getWebSearchAPITool(), // Add web search server-side tool
        ];
        const thinkingConfig: ThinkingConfig | undefined = thinking.enabled
          ? { type: 'enabled', budget_tokens: thinking.budgetTokens ?? 10000 }
          : undefined;

        // Stream the response
        const accumulated: AccumulatedContent[] = [];
        let currentBlockIndex = -1;
        let stopReason: string | null = null;
        let turnUsage: Usage = {
          input_tokens: 0,
          output_tokens: 0,
        };

        for await (const event of this.client.streamMessage({
          model,
          messages,
          max_tokens: maxTokens,
          system,
          tools: apiTools.length > 0 ? apiTools : undefined,
          thinking: thinkingConfig,
        })) {
          if (this.cancelled) break;

          const agentEvent = this.processStreamEvent(
            event,
            accumulated,
            currentBlockIndex
          );

          if (agentEvent) {
            // Update current block index for deltas
            if (event.type === 'content_block_start') {
              currentBlockIndex = event.index;
            }

            yield agentEvent;
          }

          // Track message completion
          if (event.type === 'message_start') {
            turnUsage = event.message.usage;
          }

          if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason;
            turnUsage.output_tokens = event.usage.output_tokens;
          }
        }

        if (this.cancelled) {
          yield {
            type: 'done',
            totalUsage,
            stopReason: 'cancelled',
            turnCount: turnNumber,
            sessionId,
          };
          return;
        }

        // Update total usage
        totalUsage.input_tokens += turnUsage.input_tokens;
        totalUsage.output_tokens += turnUsage.output_tokens;
        totalUsage.cache_creation_input_tokens =
          (totalUsage.cache_creation_input_tokens ?? 0) +
          (turnUsage.cache_creation_input_tokens ?? 0);
        totalUsage.cache_read_input_tokens =
          (totalUsage.cache_read_input_tokens ?? 0) +
          (turnUsage.cache_read_input_tokens ?? 0);

        yield {
          type: 'turn_complete',
          usage: turnUsage,
          turnNumber,
          sessionId,
        };

        // Build assistant message from accumulated content
        const assistantContent = this.buildAssistantContent(accumulated);
        messages = [
          ...messages,
          { role: 'assistant', content: assistantContent },
        ];

        // Write assistant message to transcript with usage data (async, don't await)
        this.transcriptWriter.writeAssistantMessage(
          sessionId,
          model,
          `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          assistantContent,
          turnUsage,
          stopReason,
        ).catch((err) => {
          console.error('[AgentLoop] Failed to write assistant message to transcript:', err);
        });

        // Persist conversation history after each turn
        this.conversationHistory = [...messages];

        // Check for auto-compact
        if (autoCompact.enabled && autoCompact.onCompact) {
          // Estimate context usage from total input tokens
          // input_tokens already includes the context, cache_read doesn't count toward limit
          const effectiveTokens = turnUsage.input_tokens - (turnUsage.cache_read_input_tokens ?? 0);
          const contextPercent = effectiveTokens / maxContextTokens;

          if (contextPercent >= compactThreshold) {
            const previousCount = messages.length;
            try {
              messages = await autoCompact.onCompact(messages, sessionId);
              // Update history with compacted messages
              this.conversationHistory = [...messages];
              yield {
                type: 'compact',
                previousMessageCount: previousCount,
                newMessageCount: messages.length,
                sessionId,
              };
            } catch (error) {
              // Log but don't fail on compaction errors
              console.error('[AgentLoop] Auto-compact failed:', error);
            }
          }
        }

        // Check stop reason
        if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
          yield {
            type: 'done',
            totalUsage,
            stopReason: stopReason as 'end_turn' | 'max_tokens',
            turnCount: turnNumber,
            sessionId,
          };
          return;
        }

        // Execute tools if stop_reason is tool_use
        if (stopReason === 'tool_use') {
          const toolUses = accumulated.filter(
            (c): c is AccumulatedContent & { type: 'tool_use' } =>
              c.type === 'tool_use' && !!c.id && !!c.name
          );

          const toolResults: ContentBlock[] = [];

          for (const toolUse of toolUses) {
            // Parse input JSON
            let input: unknown;
            try {
              input = toolUse.input ? JSON.parse(toolUse.input) : {};
            } catch {
              input = {};
            }

            // Run pre-hook
            const preHookResult = await hooks.run('PreToolUse', {
              tool: toolUse.name!,
              input,
            });

            if (!preHookResult.allow) {
              yield {
                type: 'tool_result',
                id: toolUse.id!,
                name: toolUse.name!,
                content: `Tool blocked: ${preHookResult.reason ?? 'Unknown reason'}`,
                is_error: true,
              };

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id!,
                content: `Tool blocked: ${preHookResult.reason ?? 'Unknown reason'}`,
                is_error: true,
              });
              continue;
            }

            // Apply modified input if hook changed it
            const effectiveInput = preHookResult.modified ?? input;

            // Execute the tool
            try {
              const result = await toolRegistry.execute(
                toolUse.name!,
                effectiveInput,
                toolContext
              );

              yield {
                type: 'tool_result',
                id: toolUse.id!,
                name: toolUse.name!,
                content: result.content,
                is_error: result.is_error ?? false,
              };

              // Format content for API - convert ToolResultContent to string if needed
              let apiContent =
                typeof result.content === 'string'
                  ? result.content
                  : this.toolResultContentToString(result.content);

              // Run post-hook - allows appending content to result
              const hookResult = await hooks.run('PostToolUse', {
                tool: toolUse.name!,
                input: effectiveInput,
                result: result.content,
                is_error: result.is_error ?? false,
              });
              
              // If hook returned content to append, add it to the tool result
              if (hookResult.appendToResult) {
                apiContent += '\n\n' + hookResult.appendToResult;
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id!,
                content: apiContent,
                is_error: result.is_error,
              });
            } catch (error) {
              const errorMessage = `Error: ${(error as Error).message}`;

              yield {
                type: 'tool_result',
                id: toolUse.id!,
                name: toolUse.name!,
                content: errorMessage,
                is_error: true,
              };

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id!,
                content: errorMessage,
                is_error: true,
              });
            }
          }

          // Add tool results to messages
          messages = [
            ...messages,
            { role: 'user', content: toolResults },
          ];

          // Write tool results to transcript (async, don't await)
          this.transcriptWriter.writeToolResultMessage(sessionId, toolResults).catch((err) => {
            console.error('[AgentLoop] Failed to write tool results to transcript:', err);
          });

          // Persist conversation history after tool results
          this.conversationHistory = [...messages];
        }
      } catch (error) {
        yield {
          type: 'error',
          error: error as Error,
        };

        yield {
          type: 'done',
          totalUsage,
          stopReason: 'end_turn',
          turnCount: turnNumber,
          sessionId,
        };
        return;
      }
    }

    // Reached max turns
    yield {
      type: 'done',
      totalUsage,
      stopReason: 'max_turns',
      turnCount: turnNumber,
      sessionId,
    };
  }

  /**
   * Cancel the current run.
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Get the underlying API client.
   */
  getClient(): AnthropicClient {
    return this.client;
  }

  /**
   * Process a stream event and return an agent event if applicable.
   */
  private processStreamEvent(
    event: StreamEvent,
    accumulated: AccumulatedContent[],
    _currentBlockIndex: number
  ): AgentEvent | null {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block;

        if (block.type === 'text') {
          accumulated[event.index] = { 
            type: 'text', 
            text: block.text,
            citations: block.citations,
          };
        } else if (block.type === 'tool_use') {
          // Start accumulating tool_use - don't yield yet, wait for complete input
          accumulated[event.index] = {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: '',
          };
        } else if (block.type === 'thinking') {
          accumulated[event.index] = {
            type: 'thinking',
            text: block.thinking,
            signature: block.signature,  // Capture signature for API round-trip
          };
        } else if (block.type === 'server_tool_use') {
          // Server-side tool (like web_search) - executed by Anthropic
          accumulated[event.index] = {
            type: 'server_tool_use',
            id: block.id,
            name: block.name,
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
          };
          // Yield immediately since we have the input
          return {
            type: 'server_tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          };
        } else if (block.type === 'web_search_tool_result') {
          // Web search results from server
          accumulated[event.index] = {
            type: 'web_search_tool_result',
            tool_use_id: block.tool_use_id,
            searchResults: block.content,
          };
          // Yield the results
          return {
            type: 'web_search_result',
            tool_use_id: block.tool_use_id,
            results: block.content,
          };
        }
        return null;
      }

      case 'content_block_delta': {
        const acc = accumulated[event.index];
        if (!acc) return null;

        const delta = event.delta;

        if (delta.type === 'text_delta' && acc.type === 'text') {
          acc.text = (acc.text ?? '') + delta.text;
          return { type: 'text', content: delta.text };
        }

        if (delta.type === 'input_json_delta' && acc.type === 'tool_use') {
          acc.input = (acc.input ?? '') + delta.partial_json;
          return null; // Don't yield partial JSON
        }

        if (delta.type === 'thinking_delta' && acc.type === 'thinking') {
          acc.text = (acc.text ?? '') + delta.thinking;
          // Don't emit thinking deltas - accumulate and emit at block stop
          return null;
        }

        if (delta.type === 'signature_delta' && acc.type === 'thinking') {
          // Capture the signature for the thinking block
          acc.signature = (acc.signature ?? '') + delta.signature;
          return null;
        }

        return null;
      }

      case 'content_block_stop': {
        const acc = accumulated[event.index];
        // Emit complete thinking block when it finishes
        if (acc?.type === 'thinking' && acc.text) {
          return { type: 'thinking', content: acc.text };
        }
        // Emit complete tool_use block with full parsed input
        if (acc?.type === 'tool_use' && acc.id && acc.name) {
          let parsedInput: unknown;
          try {
            parsedInput = acc.input ? JSON.parse(acc.input) : {};
          } catch {
            parsedInput = {};
          }
          return {
            type: 'tool_use',
            id: acc.id,
            name: acc.name,
            input: parsedInput,
          };
        }
        return null;
      }

      case 'error':
        return {
          type: 'error',
          error: new Error(event.error.message),
        };

      default:
        return null;
    }
  }

  /**
   * Build assistant content blocks from accumulated content.
   * Includes thinking blocks with their signatures for proper API round-tripping.
   */
  private buildAssistantContent(accumulated: AccumulatedContent[]): ContentBlock[] {
    return accumulated
      .filter((c) => c !== undefined)
      .map((c): ContentBlock => {
        if (c.type === 'thinking') {
          // Include thinking blocks with signatures for API verification
          return {
            type: 'thinking',
            thinking: c.text ?? '',
            signature: c.signature,
          };
        }
        if (c.type === 'text') {
          // Include citations if present
          const textBlock: ContentBlock = { type: 'text', text: c.text ?? '' };
          if (c.citations && c.citations.length > 0) {
            (textBlock as ContentBlock & { citations?: unknown[] }).citations = c.citations;
          }
          return textBlock;
        }
        if (c.type === 'tool_use') {
          let parsedInput: unknown;
          try {
            parsedInput = c.input ? JSON.parse(c.input) : {};
          } catch {
            parsedInput = {};
          }
          return {
            type: 'tool_use',
            id: c.id ?? '',
            name: c.name ?? '',
            input: parsedInput,
          };
        }
        if (c.type === 'server_tool_use') {
          // Server-side tool use - pass through as-is
          let parsedInput: unknown;
          try {
            parsedInput = c.input ? JSON.parse(c.input) : {};
          } catch {
            parsedInput = {};
          }
          return {
            type: 'server_tool_use',
            id: c.id ?? '',
            name: c.name ?? '',
            input: parsedInput,
          } as ContentBlock;
        }
        if (c.type === 'web_search_tool_result') {
          // Web search results - pass through as-is
          return {
            type: 'web_search_tool_result',
            tool_use_id: c.tool_use_id ?? '',
            content: c.searchResults ?? [],
          } as ContentBlock;
        }
        return { type: 'text', text: '' };
      });
  }

  /**
   * Convert ToolResultContent array to string for API.
   */
  private toolResultContentToString(content: ToolResultContent[]): string {
    return content
      .map((c) => {
        if (c.type === 'text' && c.text) {
          return c.text;
        }
        if (c.type === 'image' && c.source) {
          return `[Image: ${c.source.media_type}]`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}
