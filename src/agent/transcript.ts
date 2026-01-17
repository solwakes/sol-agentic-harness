/**
 * JSONL Transcript Writer
 *
 * Writes conversation transcripts in the format compatible with Claude SDK / ccusage.
 * Transcripts are stored in ~/.claude/projects/{project-dir}/{sessionId}.jsonl
 */

import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Message, Usage } from '../client/types.js';

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
}
