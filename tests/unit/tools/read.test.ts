/**
 * Read tool unit tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock fs module
vi.mock('node:fs/promises');

import { readTool } from '../../../src/tools/builtin/read.js';
import type { ToolContext } from '../../../src/tools/types.js';

const mockContext: ToolContext = {
  workingDir: '/home/test',
};

describe('Read tool', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads a file with line numbers', async () => {
    const fileContent = 'line 1\nline 2\nline 3';
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue(fileContent);

    const result = await readTool.execute(
      { file_path: '/test/file.txt' },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('1\t');
    expect(result.content).toContain('line 1');
    expect(result.content).toContain('2\t');
    expect(result.content).toContain('line 2');
  });

  it('returns error for missing files', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(fs.stat).mockRejectedValue(error);

    const result = await readTool.execute(
      { file_path: '/nonexistent.txt' },
      mockContext
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('File not found');
  });

  it('returns error for directories', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

    const result = await readTool.execute({ file_path: '/test/dir' }, mockContext);

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('is a directory');
  });

  it('respects offset parameter', async () => {
    const fileContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue(fileContent);

    const result = await readTool.execute(
      { file_path: '/test/file.txt', offset: 3 },
      mockContext
    );

    expect(result.is_error).toBe(false);
    // Should start at line 3
    expect(result.content).toContain('3\t');
    expect(result.content).toContain('line 3');
    expect(result.content).not.toContain('1\tline 1');
  });

  it('respects limit parameter', async () => {
    const fileContent = 'line 1\nline 2\nline 3\nline 4\nline 5';
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue(fileContent);

    const result = await readTool.execute(
      { file_path: '/test/file.txt', limit: 2 },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('line 1');
    expect(result.content).toContain('line 2');
    // Should show "more lines not shown"
    expect(result.content).toContain('more lines not shown');
  });

  it('truncates long lines', async () => {
    const longLine = 'x'.repeat(3000);
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue(longLine);

    const result = await readTool.execute(
      { file_path: '/test/file.txt' },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('[truncated]');
    expect(result.content.length).toBeLessThan(3000);
  });

  it('resolves relative paths against working directory', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue('content');

    await readTool.execute({ file_path: 'relative/path.txt' }, mockContext);

    expect(fs.stat).toHaveBeenCalledWith(
      expect.stringContaining('/home/test/relative/path.txt')
    );
  });

  it('handles empty files', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(fs.readFile).mockResolvedValue('');

    const result = await readTool.execute(
      { file_path: '/test/empty.txt' },
      mockContext
    );

    // Empty files still have a line 1 (empty line), result should not be an error
    expect(result.is_error).toBe(false);
    // The formatted output will have line number prefix even for empty file
    expect(result.content).toContain('1\t');
  });

  it('returns error for permission denied', async () => {
    const error = new Error('EACCES') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    vi.mocked(fs.stat).mockRejectedValue(error);

    const result = await readTool.execute(
      { file_path: '/restricted/file.txt' },
      mockContext
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Permission denied');
  });
});
