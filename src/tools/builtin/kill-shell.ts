/**
 * KillShell tool - Kill a background shell task.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { killBackgroundTask } from './bash.js';

interface KillShellInput {
  shell_id: string;
}

export const killShellTool: ToolDefinition = {
  name: 'KillShell',
  description: `Kills a running background bash shell by its ID.

Usage:
- Takes a shell_id parameter identifying the shell to kill
- Returns success or failure status
- Use when you need to terminate a long-running shell
- Shell IDs can be found in the output of background Bash commands`,

  input_schema: {
    type: 'object',
    properties: {
      shell_id: {
        type: 'string',
        description: 'The ID of the background shell to kill',
      },
    },
    required: ['shell_id'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as KillShellInput;

    return killBackgroundTask(params.shell_id);
  },
};
