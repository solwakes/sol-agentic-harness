/**
 * Hook system for intercepting agent events.
 */

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'WorkerStart' | 'WorkerStop';

export interface PreToolUseInput {
  tool: string;
  input: unknown;
}

export interface PostToolUseInput {
  tool: string;
  input: unknown;
  result: unknown;
  is_error: boolean;
}

export interface WorkerStartInput {
  workerId: string;
  description: string;
  model: string;
}

export interface WorkerStopInput {
  workerId: string;
  success: boolean;
  error?: string;
}

export type HookInput<E extends HookEvent> = E extends 'PreToolUse'
  ? PreToolUseInput
  : E extends 'PostToolUse'
    ? PostToolUseInput
    : E extends 'WorkerStart'
      ? WorkerStartInput
      : E extends 'WorkerStop'
        ? WorkerStopInput
        : never;

export interface HookResult {
  /** Whether to allow the action (for PreToolUse: block tool execution) */
  allow: boolean;
  /** Explanation if blocked */
  reason?: string;
  /** Modified input (for PreToolUse) */
  modified?: unknown;
}

export interface Hook<E extends HookEvent = HookEvent> {
  event: E;
  handler: (input: HookInput<E>) => Promise<HookResult> | HookResult;
}

export class HookRegistry {
  private hooks: Map<HookEvent, Array<Hook<HookEvent>>> = new Map();

  /**
   * Register a hook for an event.
   */
  register<E extends HookEvent>(hook: Hook<E>): void {
    const eventHooks = this.hooks.get(hook.event) ?? [];
    eventHooks.push(hook as Hook<HookEvent>);
    this.hooks.set(hook.event, eventHooks);
  }

  /**
   * Unregister all hooks for an event.
   */
  clear(event?: HookEvent): void {
    if (event) {
      this.hooks.delete(event);
    } else {
      this.hooks.clear();
    }
  }

  /**
   * Run all hooks for an event.
   * Returns combined result - if any hook disallows, the result is disallowed.
   */
  async run<E extends HookEvent>(event: E, input: HookInput<E>): Promise<HookResult> {
    const eventHooks = this.hooks.get(event) ?? [];

    let currentInput = input;
    const reasons: string[] = [];

    for (const hook of eventHooks) {
      try {
        const result = await hook.handler(currentInput as HookInput<typeof hook.event>);

        if (!result.allow) {
          return {
            allow: false,
            reason: result.reason ?? 'Hook blocked the action',
          };
        }

        // Apply modifications for PreToolUse
        if (event === 'PreToolUse' && result.modified !== undefined) {
          currentInput = {
            ...currentInput,
            input: result.modified,
          } as HookInput<E>;
        }

        if (result.reason) {
          reasons.push(result.reason);
        }
      } catch (error) {
        // Hook error - log and continue (don't block on hook errors)
        console.error(`Hook error for ${event}:`, error);
      }
    }

    return {
      allow: true,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      modified: event === 'PreToolUse' ? (currentInput as PreToolUseInput).input : undefined,
    };
  }

  /**
   * Check if any hooks are registered for an event.
   */
  hasHooks(event: HookEvent): boolean {
    return (this.hooks.get(event)?.length ?? 0) > 0;
  }
}
