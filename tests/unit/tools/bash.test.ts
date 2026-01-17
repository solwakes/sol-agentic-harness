/**
 * Bash tool unit tests.
 */

import { describe, it, expect } from 'vitest';
import { bashTool } from '../../../src/tools/builtin/bash.js';
import type { ToolContext } from '../../../src/tools/types.js';

const mockContext: ToolContext = {
  workingDir: process.cwd(),
};

describe('Bash tool', () => {
  it('executes a simple command and returns output', async () => {
    const result = await bashTool.execute({ command: 'echo "hello"' }, mockContext);

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('hello');
  });

  it('returns stderr content', async () => {
    const result = await bashTool.execute(
      { command: 'echo "error" >&2' },
      mockContext
    );

    // stderr is included in output but not necessarily an error
    expect(result.content).toContain('error');
  });

  it('returns error for non-zero exit code', async () => {
    const result = await bashTool.execute({ command: 'exit 1' }, mockContext);

    expect(result.is_error).toBe(true);
  });

  it('respects timeout', async () => {
    const result = await bashTool.execute(
      { command: 'sleep 10', timeout: 100 },
      mockContext
    );

    expect(result.is_error).toBe(true);
    expect(result.content).toContain('timed out');
  }, 10000);

  it('captures command output', async () => {
    const result = await bashTool.execute(
      { command: 'echo "line1" && echo "line2"' },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line2');
  });

  it('uses working directory from context', async () => {
    const result = await bashTool.execute({ command: 'pwd' }, mockContext);

    expect(result.is_error).toBe(false);
    expect(result.content).toContain(process.cwd());
  });

  it('handles environment variables from context', async () => {
    const ctxWithEnv: ToolContext = {
      ...mockContext,
      env: { TEST_VAR: 'test_value' },
    };

    const result = await bashTool.execute(
      { command: 'echo $TEST_VAR' },
      ctxWithEnv
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('test_value');
  });

  it('reports no output for silent commands', async () => {
    const result = await bashTool.execute({ command: 'true' }, mockContext);

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('no output');
  });

  it('handles commands with special characters', async () => {
    const result = await bashTool.execute(
      { command: 'echo "hello world" | grep -o "world"' },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('world');
  });

  it('runs background tasks and returns task ID', async () => {
    const result = await bashTool.execute(
      { command: 'echo "bg"', run_in_background: true },
      mockContext
    );

    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Background task started');
    expect(result.content).toContain('bg_');
  });
});
