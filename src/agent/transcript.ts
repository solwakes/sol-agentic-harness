/**
 * JSONL Transcript Writer/Reader
 *
 * Writes and reads conversation transcripts in the format compatible with Claude SDK / ccusage.
 * Transcripts are stored in ~/.claude/projects/{project-dir}/{sessionId}.jsonl
 */

import { appendFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message, ContentBlock, Usage } from '../client/types.js';

// Get project directory from cwd, converting slashes to dashes
function getProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

// Get transcripts directory for a given working directory
function getTranscriptsDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', getProjectDir(cwd));
}

// Get transcript file path for a session
function getTranscriptPath(sessionId: string, cwd: string): string {
  return join(getTranscriptsDir(cwd), `${sessionId}.jsonl`);
}

export interface TranscriptWriterOptions {
  /** Working directory (used for project path) */
  cwd?: string;
  /** Whether to enable transcript writing (default: true) */
  enabled?: boolean;
}

export interface UserMessageEntry {
  type: 'user';
  message: {
    role: 'user';
    content: Message['content'];
  };
  sessionId: string;
  timestamp: string;
  uuid: string;
  cwd: string;
  version: string;
}

export interface AssistantMessageEntry {
  type: 'assistant';
  message: {
    model: string;
    id: string;
    type: 'message';
    role: 'assistant';
    content: unknown[];
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: Usage;
  };
  requestId: string;
  sessionId: string;
  timestamp: string;
  uuid: string;
}

/**
 * Transcript writer for JSONL format compatible with Claude SDK.
 */
export class TranscriptWriter {
  private cwd: string;
  private enabled: boolean;
  private initialized: boolean = false;
  private version: string = '1.0.0'; // sol-agentic-harness version

  constructor(options: TranscriptWriterOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.enabled = options.enabled ?? true;
  }

  /**
   * Ensure the transcripts directory exists.
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;

    const dir = getTranscriptsDir(this.cwd);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    this.initialized = true;
  }

  /**
   * Append a JSON line to the transcript file.
   */
  private async appendEntry(sessionId: string, entry: unknown): Promise<void> {
    if (!this.enabled) return;

    await this.ensureDir();
    const path = getTranscriptPath(sessionId, this.cwd);
    const line = JSON.stringify(entry) + '\n';
    await appendFile(path, line);
  }

  /**
   * Write a user message to the transcript.
   */
  async writeUserMessage(
    sessionId: string,
    content: Message['content']
  ): Promise<void> {
    const entry: UserMessageEntry = {
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      sessionId,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      cwd: this.cwd,
      version: this.version,
    };

    await this.appendEntry(sessionId, entry);
  }

  /**
   * Write an assistant message to the transcript.
   * This includes the usage data that ccusage reads.
   */
  async writeAssistantMessage(
    sessionId: string,
    model: string,
    messageId: string,
    content: unknown[],
    usage: Usage,
    stopReason: string | null = 'end_turn'
  ): Promise<void> {
    const entry: AssistantMessageEntry = {
      type: 'assistant',
      message: {
        model,
        id: messageId,
        type: 'message',
        role: 'assistant',
        content,
        stop_reason: stopReason,
        stop_sequence: null,
        usage,
      },
      requestId: `req_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      sessionId,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
    };

    await this.appendEntry(sessionId, entry);
  }

  /**
   * Write a tool result message to the transcript.
   * Tool results are user-role messages containing tool_result blocks.
   */
  async writeToolResultMessage(
    sessionId: string,
    content: ContentBlock[]
  ): Promise<void> {
    const entry: UserMessageEntry = {
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      sessionId,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      cwd: this.cwd,
      version: this.version,
    };

    await this.appendEntry(sessionId, entry);
  }

  /**
   * Update the working directory (creates new transcript dir if needed).
   */
  setCwd(cwd: string): void {
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      this.initialized = false;
    }
  }

  /**
   * Enable or disable transcript writing.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Load conversation history from a transcript file.
   * Returns messages in the format needed for AgentLoop.
   */
  async loadTranscript(sessionId: string): Promise<Message[]> {
    const path = getTranscriptPath(sessionId, this.cwd);

    if (!existsSync(path)) {
      return [];
    }

    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      const messages: Message[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { type: string; message?: unknown };

          if (entry.type === 'user' && entry.message) {
            const msg = entry.message as { role: string; content: Message['content'] };
            if (msg.role === 'user') {
              messages.push({
                role: 'user',
                content: msg.content,
              });
            }
          } else if (entry.type === 'assistant' && entry.message) {
            const msg = entry.message as { role: string; content: ContentBlock[] };
            if (msg.role === 'assistant') {
              messages.push({
                role: 'assistant',
                content: msg.content,
              });
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      // Validate conversation: each assistant tool_use must have a matching tool_result
      // If any message has tool_use without matching tool_result in the next message, truncate there
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const toolUses = msg.content.filter(
            (block): block is ContentBlock & { type: 'tool_use' } =>
              typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use'
          );

          if (toolUses.length > 0) {
            // Check if next message has matching tool_results
            const nextMsg = messages[i + 1];
            if (!nextMsg || nextMsg.role !== 'user' || !Array.isArray(nextMsg.content)) {
              // No matching tool_result - truncate conversation here
              console.warn(
                `[TranscriptWriter] Transcript ${sessionId} has tool_use at message ${i} without tool_result. ` +
                `Truncating to recover.`
              );
              return messages.slice(0, i);
            }

            // Verify all tool_uses have matching tool_results
            const resultIds = new Set(
              nextMsg.content
                .filter((b): b is ContentBlock & { type: 'tool_result' } =>
                  typeof b === 'object' && b !== null && 'type' in b && b.type === 'tool_result' && 'tool_use_id' in b
                )
                .map(b => (b as { tool_use_id: string }).tool_use_id)
            );

            const missingResults = toolUses.filter(t => !resultIds.has(t.id));
            if (missingResults.length > 0) {
              console.warn(
                `[TranscriptWriter] Transcript ${sessionId} has ${missingResults.length} tool_use without matching tool_result at message ${i}. ` +
                `Truncating to recover.`
              );
              return messages.slice(0, i);
            }
          }
        }
      }

      return messages;
    } catch (error) {
      console.error(`[TranscriptWriter] Failed to load transcript ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Check if a transcript exists for a session.
   */
  transcriptExists(sessionId: string): boolean {
    const path = getTranscriptPath(sessionId, this.cwd);
    return existsSync(path);
  }

  /**
   * Get the transcript file path for a session.
   */
  getTranscriptPath(sessionId: string): string {
    return getTranscriptPath(sessionId, this.cwd);
  }
}
