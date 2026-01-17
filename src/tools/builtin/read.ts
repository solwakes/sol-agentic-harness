/**
 * Read tool - Read files with line numbers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

const MAX_LINE_LENGTH = 2000;
const DEFAULT_LIMIT = 2000;

export const readTool: ToolDefinition = {
  name: 'Read',
  description: `Reads a file from the local filesystem.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_LIMIT} lines starting from the beginning of the file
- You can optionally specify a line offset and limit for long files
- Any lines longer than ${MAX_LINE_LENGTH} characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (PNG, JPG, etc), PDFs, and Jupyter notebooks
- You can call multiple tools in parallel for efficiency`,

  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed). Only provide if the file is too large to read at once.',
      },
      limit: {
        type: 'number',
        description: 'The number of lines to read. Only provide if the file is too large to read at once.',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as ReadInput;
    let filePath = params.file_path;

    // Resolve relative paths against working directory
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.workingDir, filePath);
    }

    try {
      // Check if file exists and get stats
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        return {
          content: `Error: '${filePath}' is a directory. Use Bash with 'ls' to list directory contents.`,
          is_error: true,
        };
      }

      // Check if it's an image file
      const ext = path.extname(filePath).toLowerCase();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'];

      if (imageExtensions.includes(ext)) {
        return await readImageFile(filePath, ext);
      }

      // Read text file
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Apply offset and limit
      const offset = params.offset ? Math.max(0, params.offset - 1) : 0; // Convert to 0-indexed
      const limit = params.limit ?? DEFAULT_LIMIT;
      const selectedLines = lines.slice(offset, offset + limit);

      // Format with line numbers (cat -n style)
      const formatted = selectedLines
        .map((line, idx) => {
          const lineNum = offset + idx + 1;
          const truncatedLine =
            line.length > MAX_LINE_LENGTH
              ? line.slice(0, MAX_LINE_LENGTH) + '... [truncated]'
              : line;
          // cat -n format: right-aligned line number with tab
          return `${String(lineNum).padStart(6)}\t${truncatedLine}`;
        })
        .join('\n');

      // Add note if truncated
      let result = formatted;
      if (offset + limit < lines.length) {
        const remaining = lines.length - (offset + limit);
        result += `\n\n[${remaining} more lines not shown. Use offset=${offset + limit + 1} to continue reading.]`;
      }

      if (result.trim() === '') {
        return {
          content: `File '${filePath}' exists but is empty.`,
          is_error: false,
        };
      }

      return {
        content: result,
        is_error: false,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code === 'ENOENT') {
        return {
          content: `Error: File not found: '${filePath}'`,
          is_error: true,
        };
      }

      if (err.code === 'EACCES') {
        return {
          content: `Error: Permission denied: '${filePath}'`,
          is_error: true,
        };
      }

      return {
        content: `Error reading file '${filePath}': ${err.message}`,
        is_error: true,
      };
    }
  },
};

async function readImageFile(filePath: string, ext: string): Promise<ToolResult> {
  const data = await fs.readFile(filePath);
  const base64 = data.toString('base64');

  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
  };

  const mediaType = mimeTypes[ext] ?? 'application/octet-stream';

  return {
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64,
        },
      },
    ],
    is_error: false,
  };
}
