/**
 * WebFetch tool - Fetch and process web content.
 */

import TurndownService from 'turndown';
import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface WebFetchInput {
  url: string;
  prompt: string;
}

const MAX_CONTENT_LENGTH = 100_000;
const TIMEOUT = 30_000;

// Simple in-memory cache (15 minute TTL)
const cache = new Map<string, { content: string; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export const webFetchTool: ToolDefinition = {
  name: 'WebFetch',
  description: `Fetches content from a URL and returns it as markdown.

Usage:
- Provide a URL and a prompt describing what information to extract
- HTTP URLs will be automatically upgraded to HTTPS
- Includes a 15-minute cache for faster responses on repeated fetches
- When a redirect occurs, you may need to make a new request with the redirect URL

Note: This is a basic implementation. Results may be summarized if content is very large.`,

  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        format: 'uri',
        description: 'The URL to fetch content from',
      },
      prompt: {
        type: 'string',
        description: 'The prompt describing what information to extract from the page',
      },
    },
    required: ['url', 'prompt'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as WebFetchInput;
    let url = params.url;

    // Upgrade HTTP to HTTPS
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        content: `Error: Invalid URL '${url}'`,
        is_error: true,
      };
    }

    // Check cache
    const cacheKey = url;
    const cached = cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL) {
      return {
        content: `[Cached result]\n\nFetched content from: ${url}\n\n${cached.content}\n\n---\nPrompt: ${params.prompt}`,
        is_error: false,
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; ClaudeBot/1.0; +https://anthropic.com)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          content: `Error: HTTP ${response.status} - ${response.statusText} for URL '${url}'`,
          is_error: true,
        };
      }

      // Check for redirect to different host
      const finalUrl = response.url;
      const originalHost = new URL(url).hostname;
      const finalHost = new URL(finalUrl).hostname;

      if (originalHost !== finalHost) {
        return {
          content: `Redirect detected: The URL redirected to a different host.\n\nOriginal: ${url}\nRedirected to: ${finalUrl}\n\nPlease make a new WebFetch request with the redirect URL.`,
          is_error: false,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();

      let content: string;

      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        // Convert HTML to Markdown
        content = htmlToMarkdown(text);
      } else if (contentType.includes('application/json')) {
        // Format JSON nicely
        try {
          const json = JSON.parse(text);
          content = '```json\n' + JSON.stringify(json, null, 2) + '\n```';
        } catch {
          content = text;
        }
      } else {
        // Plain text or other
        content = text;
      }

      // Truncate if too long
      if (content.length > MAX_CONTENT_LENGTH) {
        content =
          content.slice(0, MAX_CONTENT_LENGTH) +
          `\n\n[Content truncated - ${content.length - MAX_CONTENT_LENGTH} more characters]`;
      }

      // Update cache
      cache.set(cacheKey, { content, timestamp: now });

      // Clean old cache entries periodically
      if (cache.size > 100) {
        for (const [key, value] of cache.entries()) {
          if (now - value.timestamp > CACHE_TTL) {
            cache.delete(key);
          }
        }
      }

      return {
        content: `Fetched content from: ${url}\n\n${content}\n\n---\nPrompt: ${params.prompt}`,
        is_error: false,
      };
    } catch (error) {
      const err = error as Error;

      if (err.name === 'AbortError') {
        return {
          content: `Error: Request timed out after ${TIMEOUT / 1000} seconds for URL '${url}'`,
          is_error: true,
        };
      }

      return {
        content: `Error fetching URL '${url}': ${err.message}`,
        is_error: true,
      };
    }
  },
};

function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  // Remove script and style tags before conversion
  const cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  try {
    return turndownService.turndown(cleanHtml);
  } catch {
    // If turndown fails, return stripped HTML
    return cleanHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
