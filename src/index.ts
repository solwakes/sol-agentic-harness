/**
 * Sol Agentic Harness
 *
 * A standalone TypeScript library for building agentic applications
 * with Claude using subscription authentication.
 */

// Client exports
export { AnthropicClient, TokenManager, type AnthropicClientOptions } from './client/api-client.js';
export type { TokenManagerOptions } from './client/token-manager.js';
export type {
  Message,
  ContentBlock,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  ThinkingContent,
  SystemBlock,
  Usage,
  StreamEvent,
  APIError,
  RateLimitError,
  AuthenticationError,
  OverloadedError,
} from './client/types.js';

// Agent exports
export { AgentLoop, type AgentLoopOptions, type LoadSessionResult } from './agent/loop.js';
export type {
  RunParams,
  ThinkingConfig,
  AutoCompactConfig,
  AgentEvent,
  ThinkingEvent,
  TextEvent,
  ToolUseEvent,
  ToolResultEvent,
  TurnCompleteEvent,
  DoneEvent,
  ErrorEvent,
  CompactEvent,
} from './agent/types.js';
export { HookRegistry, type Hook, type HookEvent, type HookResult } from './agent/hooks.js';
export {
  ContextTracker,
  estimateTokens,
  formatContextStatus,
  type ContextThresholds,
  type ContextStatus,
} from './agent/context.js';
export {
  loadRules,
  rulesToSystemBlocks,
  loadSingleRulesFile,
  clearRulesCache,
  type RulesLoaderOptions,
  type LoadedRules,
} from './agent/rules.js';
export {
  TranscriptWriter,
  type TranscriptWriterOptions,
  type TruncationInfo,
  type LoadTranscriptResult,
} from './agent/transcript.js';

// Tool exports
export type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolResultContent as ToolOutputContent,
  JSONSchema,
} from './tools/types.js';
export { toAPIToolDefinition, ToolTimeoutError, ToolNotFoundError } from './tools/types.js';
export { ToolRegistry, type ToolRegistryOptions } from './tools/registry.js';

// Built-in tools
export {
  builtinTools,
  getBuiltinTool,
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
  todoWriteTool,
  taskOutputTool,
  killShellTool,
  askUserQuestionTool,
  setTodoChangeCallback,
  getCurrentTodos,
  clearTodos,
  setAskUserHandler,
  clearAskUserHandler,
  type AskUserHandler,
} from './tools/builtin/index.js';

// Task/Worker exports
export {
  taskTool,
  WorkerManager,
  setWorkerManager,
  getWorkerManager,
  clearWorkerManager,
  type WorkerModel,
  type WorkerConfig,
  type WorkerInfo,
  type WorkerResult,
} from './tools/task/index.js';

// MCP exports
export {
  MCPClient,
  MCPServerManager,
  MCPServerUnavailableError,
  MCPRequestTimeoutError,
  MCPCallError,
  type MCPClientOptions,
  type MCPManagerConfig,
  type MCPServerConfig,
  type MCPServerInfo,
  type MCPServerStatus,
  type MCPToolDefinition,
  type MCPToolCallResult,
} from './mcp/index.js';

// Utility exports
export { parseSSE, collectStreamEvents } from './utils/streaming.js';

