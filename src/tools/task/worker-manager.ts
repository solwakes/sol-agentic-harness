/**
 * WorkerManager - Manages spawned worker agents.
 *
 * Workers are sub-agents that run with their own context.
 */

import { AgentLoop } from '../../agent/loop.js';
import { HookRegistry } from '../../agent/hooks.js';
import { builtinTools } from '../builtin/index.js';
import type { ToolDefinition } from '../types.js';
import type { AgentEvent } from '../../agent/types.js';

export type WorkerModel = 'opus' | 'sonnet' | 'haiku';

export interface WorkerConfig {
  prompt: string;
  description: string;
  model?: WorkerModel;
  tools?: ToolDefinition[];
  maxTurns?: number;
  workingDir?: string;
  background?: boolean;
  system?: string;
}

export interface WorkerInfo {
  id: string;
  description: string;
  model: WorkerModel;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  result?: string;
  error?: string;
}

export interface WorkerResult {
  id: string;
  success: boolean;
  output: string;
  error?: string;
}

// Map model names to API model IDs (all Claude 4.5 versions)
const MODEL_MAP: Record<WorkerModel, string> = {
  opus: 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
};

// All 4.5 models support 64K max output tokens
// Using 16384 as default (sufficient for most tasks, saves cost)
const MAX_TOKENS_MAP: Record<WorkerModel, number> = {
  opus: 16384,
  sonnet: 16384,
  haiku: 16384,
};

export class WorkerManager {
  private workers: Map<string, WorkerInfo> = new Map();
  private runningWorkers: Map<string, { loop: AgentLoop; promise: Promise<WorkerResult> }> =
    new Map();
  private workerIdCounter = 0;
  private hooks: HookRegistry;
  private defaultWorkingDir: string;

  constructor(hooks: HookRegistry = new HookRegistry(), workingDir: string = process.cwd()) {
    this.hooks = hooks;
    this.defaultWorkingDir = workingDir;
  }

  /**
   * Spawn a new worker agent.
   */
  async spawn(config: WorkerConfig): Promise<string> {
    const workerId = `worker_${++this.workerIdCounter}_${Date.now()}`;
    const model = config.model ?? 'sonnet';

    const workerInfo: WorkerInfo = {
      id: workerId,
      description: config.description,
      model,
      status: 'running',
      startTime: Date.now(),
    };

    this.workers.set(workerId, workerInfo);

    // Fire WorkerStart hook
    await this.hooks.run('WorkerStart', {
      workerId,
      description: config.description,
      model,
    });

    // Create worker agent loop
    const loop = new AgentLoop({
      workingDir: config.workingDir ?? this.defaultWorkingDir,
    });

    // Register tools (builtins + custom)
    loop.registerTools([...builtinTools, ...(config.tools ?? [])]);

    // Run the worker
    const promise = this.runWorker(loop, workerId, config, workerInfo);

    if (config.background) {
      // Store for later retrieval
      this.runningWorkers.set(workerId, { loop, promise });
      return workerId;
    } else {
      // Wait for completion and return result
      const result = await promise;
      return result.output;
    }
  }

  private async runWorker(
    loop: AgentLoop,
    workerId: string,
    config: WorkerConfig,
    workerInfo: WorkerInfo
  ): Promise<WorkerResult> {
    const output: string[] = [];

    try {
      // All 4.5 models support extended thinking
      const workerModel = config.model ?? 'sonnet';

      for await (const event of loop.run({
        messages: [{ role: 'user', content: config.prompt }],
        system: config.system,
        model: MODEL_MAP[workerModel],
        maxTokens: MAX_TOKENS_MAP[workerModel],
        maxTurns: config.maxTurns ?? 50,
        workingDir: config.workingDir ?? this.defaultWorkingDir,
        thinking: { enabled: true, budgetTokens: 5000 },
      })) {
        this.processWorkerEvent(event, output);
      }

      // Mark completed
      workerInfo.status = 'completed';
      workerInfo.endTime = Date.now();
      workerInfo.result = output.join('');

      // Fire WorkerStop hook
      await this.hooks.run('WorkerStop', {
        workerId,
        success: true,
      });

      return {
        id: workerId,
        success: true,
        output: workerInfo.result,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Mark failed
      workerInfo.status = 'failed';
      workerInfo.endTime = Date.now();
      workerInfo.error = errorMessage;

      // Fire WorkerStop hook
      await this.hooks.run('WorkerStop', {
        workerId,
        success: false,
        error: errorMessage,
      });

      return {
        id: workerId,
        success: false,
        output: output.join(''),
        error: errorMessage,
      };
    } finally {
      this.runningWorkers.delete(workerId);
    }
  }

  private processWorkerEvent(event: AgentEvent, output: string[]): void {
    switch (event.type) {
      case 'text':
        output.push(event.content);
        break;
      case 'error':
        output.push(`\nError: ${event.error.message}\n`);
        break;
      case 'tool_result':
        if (event.is_error) {
          output.push(`\n[Tool ${event.name} error: ${event.content}]\n`);
        }
        break;
    }
  }

  /**
   * Get output from a worker (blocking or non-blocking).
   */
  async getOutput(workerId: string, block = true, timeout = 30000): Promise<WorkerResult | null> {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) {
      return null;
    }

    // If already completed
    if (workerInfo.status === 'completed' || workerInfo.status === 'failed') {
      return {
        id: workerId,
        success: workerInfo.status === 'completed',
        output: workerInfo.result ?? '',
        error: workerInfo.error,
      };
    }

    // If running and we should wait
    const running = this.runningWorkers.get(workerId);
    if (running && block) {
      // Wait with timeout
      const result = await Promise.race([
        running.promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
      ]);

      if (result === null) {
        return {
          id: workerId,
          success: false,
          output: `Worker still running after ${timeout}ms`,
        };
      }

      return result;
    }

    // Return current status for running worker (non-blocking)
    return {
      id: workerId,
      success: false,
      output: `Worker ${workerId} is still running`,
    };
  }

  /**
   * Cancel a running worker.
   */
  cancel(workerId: string): boolean {
    const running = this.runningWorkers.get(workerId);
    if (!running) {
      return false;
    }

    running.loop.cancel();
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.status = 'cancelled';
      workerInfo.endTime = Date.now();
    }

    return true;
  }

  /**
   * List all workers.
   */
  list(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get info for a specific worker.
   */
  get(workerId: string): WorkerInfo | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Clear completed workers from the list.
   */
  clearCompleted(): number {
    let cleared = 0;
    for (const [id, info] of this.workers.entries()) {
      if (info.status !== 'running') {
        this.workers.delete(id);
        cleared++;
      }
    }
    return cleared;
  }
}
