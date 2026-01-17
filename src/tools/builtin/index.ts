/**
 * Built-in tools index.
 * Exports all built-in tool definitions.
 */

// Core file tools
export { readTool } from './read.js';
export { writeTool } from './write.js';
export { editTool } from './edit.js';

// Shell and search tools
export { bashTool, getBackgroundTaskOutput, killBackgroundTask } from './bash.js';
export { globTool } from './glob.js';
export { grepTool } from './grep.js';

// Web tools
export { webFetchTool } from './web-fetch.js';
export { webSearchTool, getWebSearchAPITool } from './web-search.js';

// Task management tools
export { todoWriteTool, setTodoChangeCallback, getCurrentTodos, clearTodos } from './todo-write.js';
export { taskOutputTool } from './task-output.js';
export { killShellTool } from './kill-shell.js';
export { taskTool, setWorkerManager, getWorkerManager, clearWorkerManager } from '../task/index.js';

// User interaction tools
export { askUserQuestionTool, setAskUserHandler, clearAskUserHandler, type AskUserHandler } from './ask-user.js';

import type { ToolDefinition } from '../types.js';

import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { webFetchTool } from './web-fetch.js';
import { webSearchTool } from './web-search.js';
import { todoWriteTool } from './todo-write.js';
import { taskOutputTool } from './task-output.js';
import { killShellTool } from './kill-shell.js';
import { askUserQuestionTool } from './ask-user.js';
import { taskTool } from '../task/index.js';

/**
 * All built-in tools as an array.
 */
export const builtinTools: ToolDefinition[] = [
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
  taskTool,
];

/**
 * Get a built-in tool by name.
 */
export function getBuiltinTool(name: string): ToolDefinition | undefined {
  return builtinTools.find((t) => t.name === name);
}
