/**
 * Edit tool - Perform exact string replacements in files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const editTool: ToolDefinition = {
  name: 'Edit',
  description: `Performs exact string replacements in files.

Usage:
- The edit will FAIL if old_string is not unique in the file (unless using replace_all)
- Provide enough surrounding context in old_string to make it unique
- Use replace_all for renaming variables or replacing all instances
- Preserve exact indentation (tabs/spaces) when editing
- Prefer editing existing files over creating new ones`,

  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'The absolute path to the file to modify',
      },
      old_string: {
        type: 'string',
        description: 'The text to replace',
      },
      new_string: {
        type: 'string',
        description: 'The text to replace it with (must be different from old_string)',
      },
      replace_all: {
        type: 'boolean',
        default: false,
        description: 'Replace all occurrences of old_string (default false)',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const params = input as EditInput;
    let filePath = params.file_path;

    // Resolve relative paths against working directory
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.workingDir, filePath);
    }

    // Validate inputs
    if (params.old_string === params.new_string) {
      return {
        content: 'Error: old_string and new_string must be different',
        is_error: true,
      };
    }

    if (!params.old_string) {
      return {
        content: 'Error: old_string cannot be empty',
        is_error: true,
      };
    }

    try {
      // Read the file
      const content = await fs.readFile(filePath, 'utf-8');

      // Find occurrences
      const occurrences = countOccurrences(content, params.old_string);

      if (occurrences === 0) {
        return {
          content: `Error: old_string not found in file '${filePath}'.\n\nSearched for:\n${params.old_string}`,
          is_error: true,
        };
      }

      // Check uniqueness unless replace_all is set
      if (!params.replace_all && occurrences > 1) {
        return {
          content: `Error: old_string appears ${occurrences} times in the file. Either provide a more specific string with more surrounding context to make it unique, or use replace_all: true to replace all occurrences.`,
          is_error: true,
        };
      }

      // Perform the replacement
      let newContent: string;
      if (params.replace_all) {
        newContent = content.split(params.old_string).join(params.new_string);
      } else {
        newContent = content.replace(params.old_string, params.new_string);
      }

      // Write the file
      await fs.writeFile(filePath, newContent, 'utf-8');

      const message = params.replace_all
        ? `Successfully replaced ${occurrences} occurrence(s) in ${filePath}`
        : `Successfully edited ${filePath}`;

      return {
        content: message,
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
        content: `Error editing file '${filePath}': ${err.message}`,
        is_error: true,
      };
    }
  },
};

function countOccurrences(str: string, search: string): number {
  let count = 0;
  let pos = 0;

  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }

  return count;
}
