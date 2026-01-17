/**
 * Grep tool - Search file contents using ripgrep.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-i'?: boolean;
  '-n'?: boolean;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
}

const MAX_OUTPUT_LENGTH = 50_000;

export const grepTool: ToolDefinition = {
  name: 'Grep',
  description: `A powerful search tool built on ripgrep.

Usage:
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx")
- Output modes:
  - "files_with_matches" (default): shows only file paths
  - "content": shows matching lines with context
  - "count": shows match counts per file
- Use -A/-B/-C for context lines (requires output_mode: "content")
- Use -i for case insensitive search
- Use multiline: true for patterns spanning multiple lines

Examples:
- Search for function: pattern="function foo"
- Find imports: pattern="import.*from", glob="*.ts"
- Case insensitive: pattern="error", -i: true`,

  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to current working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")',
      },
      type: {
        type: 'string',
        description: 'File type to search (e.g., "js", "py", "rust")',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'Output mode. Defaults to "files_with_matches".',
      },
      '-A': {
        type: 'number',
        description: 'Number of lines to show after each match',
      },
      '-B': {
        type: 'number',
        description: 'Number of lines to show before each match',
      },
      '-C': {
        type: 'number',
        description: 'Number of lines to show before and after each match',
      },
      '-i': {
        type: 'boolean',
        description: 'Case insensitive search',
      },
      '-n': {
        type: 'boolean',
        description: 'Show line numbers. Defaults to true for content mode.',
      },
      head_limit: {
        type: 'number',
        description: 'Limit output to first N lines/entries',
      },
      offset: {
        type: 'number',
        description: 'Skip first N lines/entries',
      },
      multiline: {
        type: 'boolean',
        description: 'Enable multiline mode for patterns spanning lines',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as GrepInput;
    let searchPath = params.path ?? context.workingDir;

    // Resolve relative paths
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(context.workingDir, searchPath);
    }

    // Build ripgrep arguments
    const args: string[] = [];

    // Output mode
    const outputMode = params.output_mode ?? 'files_with_matches';
    if (outputMode === 'files_with_matches') {
      args.push('-l'); // files with matches only
    } else if (outputMode === 'count') {
      args.push('-c'); // count mode
    }

    // Context lines (only for content mode)
    if (outputMode === 'content') {
      if (params['-C'] !== undefined) {
        args.push('-C', String(params['-C']));
      } else {
        if (params['-A'] !== undefined) args.push('-A', String(params['-A']));
        if (params['-B'] !== undefined) args.push('-B', String(params['-B']));
      }

      // Line numbers (default true for content mode)
      if (params['-n'] !== false) {
        args.push('-n');
      }
    }

    // Case insensitive
    if (params['-i']) {
      args.push('-i');
    }

    // Multiline
    if (params.multiline) {
      args.push('-U', '--multiline-dotall');
    }

    // File type filter
    if (params.type) {
      args.push('--type', params.type);
    }

    // Glob filter
    if (params.glob) {
      args.push('--glob', params.glob);
    }

    // Common ignores
    args.push('--glob', '!node_modules/**');
    args.push('--glob', '!.git/**');
    args.push('--glob', '!dist/**');
    args.push('--glob', '!build/**');
    args.push('--glob', '!coverage/**');

    // Color off for machine parsing
    args.push('--color', 'never');

    // Add pattern and path
    args.push(params.pattern);
    args.push(searchPath);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('rg', args, {
        cwd: context.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        // ripgrep might not be installed, fall back to grep
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({
            content: 'Error: ripgrep (rg) not found. Please install ripgrep.',
            is_error: true,
          });
          return;
        }

        resolve({
          content: `Error executing grep: ${error.message}`,
          is_error: true,
        });
      });

      proc.on('close', (code) => {
        // Exit code 1 means no matches (not an error)
        if (code === 1 && !stderr) {
          resolve({
            content: `No matches found for pattern '${params.pattern}'`,
            is_error: false,
          });
          return;
        }

        if (code !== 0 && code !== 1) {
          resolve({
            content: `Grep error (exit code ${code}): ${stderr || 'Unknown error'}`,
            is_error: true,
          });
          return;
        }

        let output = stdout;

        // Apply offset and limit
        if (params.offset || params.head_limit) {
          const lines = output.split('\n');
          const offset = params.offset ?? 0;
          const limit = params.head_limit ?? lines.length;
          output = lines.slice(offset, offset + limit).join('\n');
        }

        // Truncate if too long
        if (output.length > MAX_OUTPUT_LENGTH) {
          const truncated = output.slice(0, MAX_OUTPUT_LENGTH);
          const remaining = output.length - MAX_OUTPUT_LENGTH;
          output = `${truncated}\n\n[Output truncated - ${remaining} more characters]`;
        }

        if (!output.trim()) {
          output = `No matches found for pattern '${params.pattern}'`;
        }

        resolve({
          content: output,
          is_error: false,
        });
      });
    });
  },
};
