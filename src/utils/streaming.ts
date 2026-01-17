/**
 * SSE (Server-Sent Events) streaming utilities.
 */

import type { StreamEvent } from '../client/types.js';

/**
 * Parse SSE events from a stream of bytes.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const events = parseSSEBuffer(buffer);
          for (const event of events) {
            yield event;
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete events (double newline delimited)
      const events = extractCompleteEvents(buffer);
      buffer = events.remaining;

      for (const event of events.complete) {
        const parsed = parseSSEEvent(event);
        if (parsed) {
          yield parsed;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface ExtractedEvents {
  complete: string[];
  remaining: string;
}

function extractCompleteEvents(buffer: string): ExtractedEvents {
  const complete: string[] = [];

  // SSE events are separated by double newlines
  const parts = buffer.split(/\n\n/);

  // All but the last part are complete events
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].trim()) {
      complete.push(parts[i]);
    }
  }

  // Last part may be incomplete
  return {
    complete,
    remaining: parts[parts.length - 1],
  };
}

function parseSSEBuffer(buffer: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  const parts = buffer.split(/\n\n/);

  for (const part of parts) {
    const event = parseSSEEvent(part);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

function parseSSEEvent(eventText: string): StreamEvent | null {
  const lines = eventText.split('\n');
  let eventType = '';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    } else if (line === 'data:') {
      // Empty data line
      data = '';
    }
  }

  if (!eventType || !data) {
    return null;
  }

  try {
    const parsed = JSON.parse(data);
    return parsed as StreamEvent;
  } catch {
    // Invalid JSON, skip
    return null;
  }
}

/**
 * Helper to collect all stream events into an array (for testing).
 */
export async function collectStreamEvents(
  stream: AsyncIterable<StreamEvent>
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
