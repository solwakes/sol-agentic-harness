/**
 * TaskOutput tool - Get output from background tasks.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { getBackgroundTaskOutput } from './bash.js';

interface TaskOutputInput {
  task_id: string;
  block?: boolean;
  timeout?: number;
}

export const taskOutputTool: ToolDefinition = {
  name: 'TaskOutput',
  description: `Retrieves output from a running or completed background task.

Usage:
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs come from background Bash commands or Task tool

Works with background shells and async agents.`,

  input_schema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The task ID to get output from',
      },
      block: {
        type: 'boolean',
        default: true,
        description: 'Whether to wait for completion',
      },
      timeout: {
        type: 'number',
        default: 30000,
        minimum: 0,
        maximum: 600000,
        description: 'Max wait time in ms',
      },
    },
    required: ['task_id', 'block', 'timeout'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as TaskOutputInput;

    // For now, only support background bash tasks
    // Worker task output will be handled separately by the agent loop
    if (params.task_id.startsWith('bg_')) {
      return getBackgroundTaskOutput(params.task_id);
    }

    // Worker task IDs will be handled by WorkerManager
    return {
      content: `Task output for '${params.task_id}' - use WorkerManager for agent task output.`,
      is_error: true,
    };
  },
};
