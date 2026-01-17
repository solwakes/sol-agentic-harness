/**
 * Task tool - Spawn worker agents to handle complex tasks.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { WorkerManager, type WorkerModel } from './worker-manager.js';

interface TaskInput {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: WorkerModel;
  max_turns?: number;
  run_in_background?: boolean;
  resume?: string;
}

// Global worker manager instance (can be injected)
let workerManager: WorkerManager | null = null;

export const taskTool: ToolDefinition = {
  name: 'Task',
  description: `Launch a specialized agent to handle complex, multi-step tasks autonomously.

Available agent types:
- general-purpose: For research, code exploration, and multi-step tasks
- Explore: Fast codebase exploration (file patterns, keyword search)
- Plan: Software architect for designing implementation plans

Model selection:
- haiku: Fast, cheap - good for quick tasks, Playwright, routine work
- sonnet: Balanced - default for most tasks
- opus: Most capable - for complex analysis, nuanced judgment

Usage:
- Include a short description (3-5 words) of what the agent will do
- Launch multiple agents in parallel when possible
- Use run_in_background for long tasks you don't need immediately
- Worker results are not visible to the user - summarize when done`,

  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'A short (3-5 word) description of the task',
      },
      prompt: {
        type: 'string',
        description: 'The task for the agent to perform',
      },
      subagent_type: {
        type: 'string',
        description: 'The type of specialized agent to use',
      },
      model: {
        type: 'string',
        enum: ['sonnet', 'opus', 'haiku'],
        description: 'Model to use (default: sonnet)',
      },
      max_turns: {
        type: 'integer',
        minimum: 1,
        description: 'Maximum agentic turns before stopping',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run in background, return task ID for later retrieval',
      },
      resume: {
        type: 'string',
        description: 'Optional agent ID to resume from previous execution',
      },
    },
    required: ['description', 'prompt', 'subagent_type'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as TaskInput;

    if (!workerManager) {
      workerManager = new WorkerManager(context.hooks, context.workingDir);
    }

    // Handle resume (placeholder - would need to persist worker state)
    if (params.resume) {
      const existing = workerManager.get(params.resume);
      if (existing) {
        const result = await workerManager.getOutput(params.resume);
        if (result) {
          return {
            content: result.output,
            is_error: !result.success,
          };
        }
      }
      return {
        content: `Could not resume worker ${params.resume} - not found or no state available`,
        is_error: true,
      };
    }

    // Build system prompt based on agent type
    const systemPrompt = buildSystemPrompt(params.subagent_type);

    try {
      if (params.run_in_background) {
        // Background execution - return task ID
        const taskId = await workerManager.spawn({
          prompt: params.prompt,
          description: params.description,
          model: params.model,
          maxTurns: params.max_turns,
          workingDir: context.workingDir,
          background: true,
          system: systemPrompt,
        });

        return {
          content:
            `Background task started with ID: ${taskId}\n\n` +
            `Use TaskOutput with task_id="${taskId}" to check status and retrieve results.`,
          is_error: false,
        };
      } else {
        // Foreground execution - wait for result
        const result = await workerManager.spawn({
          prompt: params.prompt,
          description: params.description,
          model: params.model,
          maxTurns: params.max_turns,
          workingDir: context.workingDir,
          background: false,
          system: systemPrompt,
        });

        return {
          content: result,
          is_error: false,
        };
      }
    } catch (error) {
      return {
        content: `Error spawning worker: ${(error as Error).message}`,
        is_error: true,
      };
    }
  },
};

/**
 * Build a system prompt for a specific agent type.
 */
function buildSystemPrompt(agentType: string): string {
  const basePrompt = `You are a specialized worker agent. Complete the task you've been given efficiently and thoroughly. Report your findings clearly.`;

  switch (agentType) {
    case 'general-purpose':
      return `${basePrompt}\n\nYou are a general-purpose agent capable of research, code exploration, and multi-step tasks. Use the available tools to accomplish your task.`;

    case 'Explore':
      return `${basePrompt}\n\nYou are a fast exploration agent. Your job is to quickly find files, search code, and answer questions about the codebase. Use Glob for file patterns and Grep for content search. Be thorough but efficient.`;

    case 'Plan':
      return `${basePrompt}\n\nYou are a software architect agent. Design implementation plans, identify critical files, and consider architectural trade-offs. Focus on creating clear, actionable plans.`;

    default:
      return basePrompt;
  }
}

/**
 * Set the worker manager instance.
 */
export function setWorkerManager(manager: WorkerManager): void {
  workerManager = manager;
}

/**
 * Get the worker manager instance.
 */
export function getWorkerManager(): WorkerManager | null {
  return workerManager;
}

/**
 * Clear the worker manager.
 */
export function clearWorkerManager(): void {
  workerManager = null;
}
