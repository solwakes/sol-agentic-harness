/**
 * WebSearch tool - Search the web using Anthropic's web search.
 *
 * Note: This tool uses Anthropic's built-in web_search tool via the API's tool system.
 * It requires the web-search-2025-03-05 beta feature.
 * If subscription auth doesn't support this, we stub it with an error.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface WebSearchInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export const webSearchTool: ToolDefinition = {
  name: 'WebSearch',
  description: `Search the web for current information.

Usage:
- Provide a search query to find up-to-date information
- Use allowed_domains to restrict results to specific sites
- Use blocked_domains to exclude specific sites
- Always include sources at the end of your response

Note: This tool uses Anthropic's built-in web search capability.
Results include relevant URLs that should be cited as sources.`,

  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        description: 'The search query to use',
      },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only include search results from these domains',
      },
      blocked_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Never include search results from these domains',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as WebSearchInput;

    // This is a placeholder implementation.
    // In the actual agent loop, WebSearch should be handled specially by
    // passing it through to the API as a native tool (web_search_20250305).
    // If we reach here, it means the native tool isn't available.

    return {
      content:
        `Web search is handled as a native Anthropic API tool.\n\n` +
        `If you're seeing this message, the web search capability may not be available ` +
        `with the current authentication method.\n\n` +
        `Query: "${params.query}"\n` +
        (params.allowed_domains?.length
          ? `Allowed domains: ${params.allowed_domains.join(', ')}\n`
          : '') +
        (params.blocked_domains?.length
          ? `Blocked domains: ${params.blocked_domains.join(', ')}\n`
          : '') +
        `\nConsider using WebFetch to directly fetch content from known URLs instead.`,
      is_error: true,
    };
  },
};

/**
 * Generate the Anthropic API tool definition for web search.
 * This should be included in the API request when web search is needed.
 */
export function getWebSearchAPITool(): {
  type: 'web_search_20250305';
  name: 'web_search';
  allowed_domains?: string[];
  blocked_domains?: string[];
} {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
  };
}
