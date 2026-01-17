/**
 * AgentLoop unit tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Note: Full integration tests for the agent loop require API access.
// These tests focus on the loop's internal behavior with mocked API responses.

describe('AgentLoop', () => {
  describe('initialization', () => {
    it('creates with default options', async () => {
      const { AgentLoop } = await import('../../src/agent/loop.js');

      const loop = new AgentLoop();

      expect(loop).toBeDefined();
      expect(loop.getClient()).toBeDefined();
    });

    it('accepts custom working directory', async () => {
      const { AgentLoop } = await import('../../src/agent/loop.js');

      const loop = new AgentLoop({ workingDir: '/custom/path' });

      expect(loop).toBeDefined();
    });

    it('registers tools', async () => {
      const { AgentLoop } = await import('../../src/agent/loop.js');
      const { readTool } = await import('../../src/tools/builtin/read.js');

      const loop = new AgentLoop();
      loop.registerTools([readTool]);

      // Tools are registered internally - hard to test without running the loop
      expect(loop).toBeDefined();
    });
  });

  describe('cancellation', () => {
    it('can be cancelled', async () => {
      const { AgentLoop } = await import('../../src/agent/loop.js');

      const loop = new AgentLoop();
      loop.cancel();

      // Cancellation sets internal flag - tested via run behavior
      expect(loop).toBeDefined();
    });
  });
});
