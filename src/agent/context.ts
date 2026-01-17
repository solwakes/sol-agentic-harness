/**
 * Context tracking - Monitor token usage and context limits.
 */

import type { Usage } from '../client/types.js';

export interface ContextThresholds {
  /** Warning threshold (e.g., 0.7 = 70%) */
  warning: number;
  /** Critical threshold (e.g., 0.85 = 85%) */
  critical: number;
  /** Auto-compact threshold (e.g., 0.78 = 78%) */
  autoCompact: number;
}

export interface ContextStatus {
  /** Total input tokens used */
  inputTokens: number;
  /** Total output tokens used */
  outputTokens: number;
  /** Estimated total context usage */
  totalTokens: number;
  /** Context usage percentage (0-100) */
  percentUsed: number;
  /** Whether warning threshold is exceeded */
  isWarning: boolean;
  /** Whether critical threshold is exceeded */
  isCritical: boolean;
  /** Whether auto-compact threshold is exceeded */
  shouldAutoCompact: boolean;
}

const DEFAULT_CONTEXT_WINDOW = 200_000; // Claude's context window
const DEFAULT_THRESHOLDS: ContextThresholds = {
  warning: 0.7,
  critical: 0.85,
  autoCompact: 0.78,
};

export class ContextTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private contextWindow: number;
  private thresholds: ContextThresholds;

  constructor(
    contextWindow: number = DEFAULT_CONTEXT_WINDOW,
    thresholds: ContextThresholds = DEFAULT_THRESHOLDS
  ) {
    this.contextWindow = contextWindow;
    this.thresholds = thresholds;
  }

  /**
   * Update token counts from a usage report.
   */
  update(usage: Usage): void {
    this.inputTokens = usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    this.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
    this.cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  }

  /**
   * Add output tokens incrementally.
   */
  addOutputTokens(tokens: number): void {
    this.outputTokens += tokens;
  }

  /**
   * Get current context status.
   */
  getStatus(): ContextStatus {
    // Estimate total context usage
    // Input tokens includes cache_read, but cache_read doesn't count toward context limit
    // So effective input = input_tokens - cache_read_input_tokens
    const effectiveInput = this.inputTokens - this.cacheReadTokens;
    const totalTokens = effectiveInput + this.outputTokens;
    const percentUsed = (totalTokens / this.contextWindow) * 100;

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      percentUsed,
      isWarning: percentUsed >= this.thresholds.warning * 100,
      isCritical: percentUsed >= this.thresholds.critical * 100,
      shouldAutoCompact: percentUsed >= this.thresholds.autoCompact * 100,
    };
  }

  /**
   * Reset tracking.
   */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheCreationTokens = 0;
  }

  /**
   * Get raw token counts.
   */
  getRawCounts(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheCreationTokens: this.cacheCreationTokens,
    };
  }

  /**
   * Get the context window size.
   */
  getContextWindow(): number {
    return this.contextWindow;
  }

  /**
   * Get the thresholds.
   */
  getThresholds(): ContextThresholds {
    return { ...this.thresholds };
  }

  /**
   * Set new thresholds.
   */
  setThresholds(thresholds: Partial<ContextThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}

/**
 * Estimate token count for a string (rough approximation).
 * Uses ~4 characters per token as a rough estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Format context status for display.
 */
export function formatContextStatus(status: ContextStatus): string {
  const emoji = status.isCritical ? '🔴' : status.isWarning ? '🟡' : '🟢';
  return `${emoji} Context: ${status.percentUsed.toFixed(1)}% (${status.totalTokens.toLocaleString()} tokens)`;
}
