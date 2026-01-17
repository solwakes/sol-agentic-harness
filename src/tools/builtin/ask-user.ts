/**
 * AskUserQuestion tool - Ask the user questions during execution.
 */

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface AskUserQuestionInput {
  questions: Question[];
  answers?: Record<string, string>;
  metadata?: {
    source?: string;
  };
}

// Callback type for handling user questions
export type AskUserHandler = (
  questions: Question[]
) => Promise<Record<string, string | string[]>>;

// Default handler that just returns empty answers (must be overridden)
let askUserHandler: AskUserHandler | null = null;

export const askUserQuestionTool: ToolDefinition = {
  name: 'AskUserQuestion',
  description: `Ask the user questions to gather information or preferences.

Use this tool when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices
4. Offer choices about direction

Usage notes:
- Users can always select "Other" for custom input
- Use multiSelect: true for non-mutually-exclusive choices
- Mark recommended options first with "(Recommended)" in label
- Keep headers short (max 12 chars)
- Provide 2-4 options per question
- Never include time estimates in options`,

  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Questions to ask the user (1-4 questions)',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The complete question to ask',
            },
            header: {
              type: 'string',
              description: 'Very short label (max 12 chars)',
            },
            options: {
              type: 'array',
              description: 'Available choices (2-4 options)',
              minItems: 2,
              maxItems: 4,
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Display text for this option',
                  },
                  description: {
                    type: 'string',
                    description: 'Explanation of what this option means',
                  },
                },
                required: ['label', 'description'],
                additionalProperties: false,
              },
            },
            multiSelect: {
              type: 'boolean',
              default: false,
              description: 'Allow selecting multiple options',
            },
          },
          required: ['question', 'header', 'options', 'multiSelect'],
          additionalProperties: false,
        },
      },
      answers: {
        type: 'object',
        description: 'User answers (populated by the system)',
        additionalProperties: { type: 'string' },
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata for tracking',
        properties: {
          source: {
            type: 'string',
            description: 'Identifier for the source of this question',
          },
        },
        additionalProperties: false,
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },

  async execute(input: unknown, _context: ToolContext): Promise<ToolResult> {
    const params = input as AskUserQuestionInput;

    // If no handler is set, return an error
    if (!askUserHandler) {
      return {
        content:
          'AskUserQuestion requires a handler to be set. ' +
          'This tool cannot be used without user interaction support.',
        is_error: true,
      };
    }

    try {
      // Call the handler to get user responses
      const answers = await askUserHandler(params.questions);

      // Format the response
      const formattedAnswers = Object.entries(answers)
        .map(([question, answer]) => {
          const answerText = Array.isArray(answer) ? answer.join(', ') : answer;
          return `Q: ${question}\nA: ${answerText}`;
        })
        .join('\n\n');

      return {
        content: `User responses:\n\n${formattedAnswers}`,
        is_error: false,
      };
    } catch (error) {
      return {
        content: `Error getting user input: ${(error as Error).message}`,
        is_error: true,
      };
    }
  },
};

/**
 * Set the handler for AskUserQuestion.
 * This must be set by the consuming application to handle user interaction.
 */
export function setAskUserHandler(handler: AskUserHandler): void {
  askUserHandler = handler;
}

/**
 * Clear the AskUserQuestion handler.
 */
export function clearAskUserHandler(): void {
  askUserHandler = null;
}
