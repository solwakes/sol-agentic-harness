/**
 * Glob tool - Fast file pattern matching.
 */

import fg from 'fast-glob';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface GlobInput {
  pattern: string;
  path?: string;
}

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
];

export const globTool: ToolDefinition = {
  name: 'Glob',
  description: `Fast file pattern matching tool that works with any codebase size.

Usage:
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time (most recent first)
- Use this tool when you need to find files by name patterns
- For searching file contents, use Grep instead
- Call multiple tools in parallel for efficiency

Examples:
- "**/*.tsx" - all TypeScript React files
- "src/**/*.test.ts" - all test files in src
- "*.{js,ts}" - all JS and TS files in current directory`,

  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against',
      },
      path: {
        type: 'string',
        description: 'The directory to search in. Defaults to current working directory.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as GlobInput;
    let searchPath = params.path ?? context.workingDir;

    // Resolve relative paths
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(context.workingDir, searchPath);
    }

    try {
      // Check if path exists
      const stats = await fs.stat(searchPath);
      if (!stats.isDirectory()) {
        return {
          content: `Error: '${searchPath}' is not a directory`,
          is_error: true,
        };
      }

      // Find matching files
      const files = await fg(params.pattern, {
        cwd: searchPath,
        absolute: true,
        ignore: DEFAULT_IGNORE,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        stats: true,
      });

      if (files.length === 0) {
        return {
          content: `No files found matching pattern '${params.pattern}' in '${searchPath}'`,
          is_error: false,
        };
      }

      // Sort by modification time (most recent first)
      const sortedFiles = files.sort((a, b) => {
        const aTime = a.stats?.mtime?.getTime() ?? 0;
        const bTime = b.stats?.mtime?.getTime() ?? 0;
        return bTime - aTime;
      });

      // Format output
      const output = sortedFiles.map((f) => f.path).join('\n');

      return {
        content: `Found ${sortedFiles.length} file(s):\n\n${output}`,
        is_error: false,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code === 'ENOENT') {
        return {
          content: `Error: Directory not found: '${searchPath}'`,
          is_error: true,
        };
      }

      if (err.code === 'EACCES') {
        return {
          content: `Error: Permission denied: '${searchPath}'`,
          is_error: true,
        };
      }

      return {
        content: `Error searching files: ${err.message}`,
        is_error: true,
      };
    }
  },
};
