/**
 * Write tool - Create or overwrite files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface WriteInput {
  file_path: string;
  content: string;
}

export const writeTool: ToolDefinition = {
  name: 'Write',
  description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path
- The file_path must be an absolute path, not a relative path
- Parent directories will be created automatically if they don't exist
- Prefer editing existing files over creating new ones
- Do not create documentation files unless explicitly requested`,

  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to write (must be absolute, not relative)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as WriteInput;
    let filePath = params.file_path;

    // Resolve relative paths against working directory
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.workingDir, filePath);
    }

    try {
      // Ensure parent directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write the file
      await fs.writeFile(filePath, params.content, 'utf-8');

      return {
        content: `File created successfully at: ${filePath}`,
        is_error: false,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      if (err.code === 'EACCES') {
        return {
          content: `Error: Permission denied writing to '${filePath}'`,
          is_error: true,
        };
      }

      if (err.code === 'ENOENT') {
        return {
          content: `Error: Invalid path '${filePath}'`,
          is_error: true,
        };
      }

      return {
        content: `Error writing file '${filePath}': ${err.message}`,
        is_error: true,
      };
    }
  },
};
