/**
 * TodoWrite tool - Manage a task list for tracking progress.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

interface TodoWriteInput {
  todos: TodoItem[];
}

// Global todo state (can be injected/overridden)
let currentTodos: TodoItem[] = [];
let todoChangeCallback: ((todos: TodoItem[]) => void) | null = null;

export const todoWriteTool: ToolDefinition = {
  name: 'TodoWrite',
  description: `Use this tool to manage a structured task list for tracking progress.

When to use:
- Complex multi-step tasks (3+ steps)
- Tasks that require careful planning
- When the user provides multiple tasks to complete

Task states:
- pending: Task not yet started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Task finished successfully

Each todo needs:
- content: What needs to be done (e.g., "Run tests")
- activeForm: Present continuous form (e.g., "Running tests")
- status: Current state

Mark tasks completed IMMEDIATELY after finishing. Don't batch completions.`,

  input_schema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The updated todo list',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              minLength: 1,
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
            },
            activeForm: {
              type: 'string',
              minLength: 1,
            },
          },
          required: ['content', 'status', 'activeForm'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as TodoWriteInput;

    // Validate todos
    for (const todo of params.todos) {
      if (!todo.content?.trim()) {
        return {
          content: 'Error: Todo content cannot be empty',
          is_error: true,
        };
      }
      if (!todo.activeForm?.trim()) {
        return {
          content: 'Error: Todo activeForm cannot be empty',
          is_error: true,
        };
      }
      if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
        return {
          content: `Error: Invalid status '${todo.status}'. Must be pending, in_progress, or completed.`,
          is_error: true,
        };
      }
    }

    // Check for multiple in_progress
    const inProgressCount = params.todos.filter((t) => t.status === 'in_progress').length;
    if (inProgressCount > 1) {
      return {
        content: `Warning: ${inProgressCount} tasks marked as in_progress. Best practice is to have only ONE task in_progress at a time.`,
        is_error: false,
      };
    }

    // Update global state
    currentTodos = params.todos;

    // Notify callback if set
    if (todoChangeCallback) {
      todoChangeCallback(currentTodos);
    }

    // Format response
    const pending = params.todos.filter((t) => t.status === 'pending');
    const inProgress = params.todos.filter((t) => t.status === 'in_progress');
    const completed = params.todos.filter((t) => t.status === 'completed');

    let response = 'Todos have been modified successfully.';

    if (inProgress.length > 0) {
      response += ` Currently working on: ${inProgress.map((t) => t.activeForm).join(', ')}.`;
    }

    if (pending.length > 0) {
      response += ` ${pending.length} task(s) pending.`;
    }

    if (completed.length > 0) {
      response += ` ${completed.length} task(s) completed.`;
    }

    return {
      content: response,
      is_error: false,
    };
  },
};

/**
 * Set a callback to be notified when todos change.
 */
export function setTodoChangeCallback(callback: (todos: TodoItem[]) => void): void {
  todoChangeCallback = callback;
}

/**
 * Get the current todos.
 */
export function getCurrentTodos(): TodoItem[] {
  return [...currentTodos];
}

/**
 * Clear all todos.
 */
export function clearTodos(): void {
  currentTodos = [];
}
