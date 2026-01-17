/**
 * Bash tool - Execute shell commands.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface BashInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_TIMEOUT = 600_000; // 10 minutes
const MAX_OUTPUT_LENGTH = 30_000;

// Background tasks storage
const backgroundTasks = new Map<
  string,
  {
    process: ChildProcess;
    output: string;
    error: string;
    done: boolean;
    exitCode: number | null;
  }
>();

let taskIdCounter = 0;

export const bashTool: ToolDefinition = {
  name: 'Bash',
  description: `Executes bash commands in a persistent shell session.

Important:
- Use for terminal operations like git, npm, docker, etc.
- Do NOT use for file operations - use Read, Write, Edit, Glob, Grep instead
- Always quote file paths with spaces using double quotes
- Commands timeout after 2 minutes by default (max 10 minutes)
- Output over 30000 characters will be truncated
- Use run_in_background: true for long-running commands

Git Safety:
- NEVER use git commit --amend unless explicitly requested
- NEVER force push or hard reset without explicit request
- NEVER skip hooks (--no-verify) unless requested

Prefer specialized tools over bash:
- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)`,

  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      description: {
        type: 'string',
        description: 'Clear, concise description of what this command does',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds (max 600000)',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Set to true to run this command in the background',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as BashInput;

    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    if (params.run_in_background) {
      return runInBackground(params.command, context);
    }

    return runCommand(params.command, context, timeout);
  },
};

async function runCommand(
  command: string,
  context: ToolContext,
  timeout: number
): Promise<ToolResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('bash', ['-c', command], {
      cwd: context.workingDir,
      env: {
        ...process.env,
        ...context.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, timeout);

    // Handle abort signal
    context.abortSignal?.addEventListener(
      'abort',
      () => {
        killed = true;
        proc.kill('SIGKILL');
      },
      { once: true }
    );

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        content: `Error executing command: ${error.message}`,
        is_error: true,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        resolve({
          content: `Command timed out after ${timeout}ms and was terminated.\n\nPartial output:\n${truncateOutput(stdout + stderr)}`,
          is_error: true,
        });
        return;
      }

      let output = '';

      if (stdout) {
        output += stdout;
      }

      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }

      output = truncateOutput(output);

      if (!output) {
        output = code === 0 ? '(no output)' : `Command failed with exit code ${code}`;
      }

      resolve({
        content: output,
        is_error: code !== 0,
      });
    });
  });
}

function runInBackground(command: string, context: ToolContext): ToolResult {
  const taskId = `bg_${++taskIdCounter}`;

  const proc = spawn('bash', ['-c', command], {
    cwd: context.workingDir,
    env: {
      ...process.env,
      ...context.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });

  const task = {
    process: proc,
    output: '',
    error: '',
    done: false,
    exitCode: null as number | null,
  };

  backgroundTasks.set(taskId, task);

  proc.stdout?.on('data', (data: Buffer) => {
    task.output += data.toString();
  });

  proc.stderr?.on('data', (data: Buffer) => {
    task.error += data.toString();
  });

  proc.on('close', (code) => {
    task.done = true;
    task.exitCode = code;
  });

  proc.on('error', (error) => {
    task.done = true;
    task.error += `\nProcess error: ${error.message}`;
  });

  return {
    content: `Background task started with ID: ${taskId}\n\nUse TaskOutput tool with task_id="${taskId}" to check status and retrieve output.`,
    is_error: false,
  };
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) {
    return output;
  }

  const truncated = output.slice(0, MAX_OUTPUT_LENGTH);
  const remaining = output.length - MAX_OUTPUT_LENGTH;

  return `${truncated}\n\n[Output truncated - ${remaining} more characters not shown]`;
}

/**
 * Get output from a background task (used by TaskOutput tool).
 */
export function getBackgroundTaskOutput(taskId: string): ToolResult {
  const task = backgroundTasks.get(taskId);

  if (!task) {
    return {
      content: `Error: No background task found with ID '${taskId}'`,
      is_error: true,
    };
  }

  const output = truncateOutput(task.output + (task.error ? `\nStderr:\n${task.error}` : ''));

  if (task.done) {
    backgroundTasks.delete(taskId);

    return {
      content: `Task ${taskId} completed with exit code ${task.exitCode}.\n\nOutput:\n${output}`,
      is_error: task.exitCode !== 0,
    };
  }

  return {
    content: `Task ${taskId} is still running.\n\nCurrent output:\n${output}`,
    is_error: false,
  };
}

/**
 * Kill a background task.
 */
export function killBackgroundTask(taskId: string): ToolResult {
  const task = backgroundTasks.get(taskId);

  if (!task) {
    return {
      content: `Error: No background task found with ID '${taskId}'`,
      is_error: true,
    };
  }

  try {
    task.process.kill('SIGKILL');
    backgroundTasks.delete(taskId);

    return {
      content: `Task ${taskId} has been killed.`,
      is_error: false,
    };
  } catch (error) {
    return {
      content: `Error killing task ${taskId}: ${(error as Error).message}`,
      is_error: true,
    };
  }
}
