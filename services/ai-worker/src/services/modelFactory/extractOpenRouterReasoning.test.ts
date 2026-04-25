/**
 * Unit tests for extractAndPopulateOpenRouterReasoning.
 *
 * Pairs with the canary test (extractOpenRouterReasoning.canary.test.ts), which
 * verifies the LangChain `__includeRawResponse` contract end-to-end. THIS file
 * tests the helper's behavior on synthetic AIMessage shapes — exercising paths
 * the canary can't easily cover (defensive guards, error logging, memory hygiene
 * assertions, edge cases).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

// Capture the logger so we can assert on warn() calls
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

import { extractAndPopulateOpenRouterReasoning } from './extractOpenRouterReasoning.js';

describe('extractAndPopulateOpenRouterReasoning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Build a synthetic AIMessage with a __raw_response in additional_kwargs */
  function buildMessage(opts: {
    content?: string;
    rawResponse?: unknown;
    finishReason?: string;
    extraKwargs?: Record<string, unknown>;
  }): BaseMessage {
    return new AIMessage({
      content: opts.content ?? '',
      additional_kwargs: {
        ...(opts.rawResponse !== undefined ? { __raw_response: opts.rawResponse } : {}),
        ...opts.extraKwargs,
      },
      response_metadata:
        opts.finishReason !== undefined ? { finish_reason: opts.finishReason } : {},
    });
  }

  describe('happy path: structured reasoning', () => {
    it('populates additional_kwargs.reasoning from __raw_response.choices[0].message.reasoning', () => {
      const message = buildMessage({
        content: 'The answer is 42.',
        finishReason: 'stop',
        rawResponse: {
          provider: 'Parasail',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'The answer is 42.',
                reasoning: 'Computing 6 * 7 = 42 step by step',
                reasoning_details: [
                  { type: 'reasoning.text', text: 'Computing 6 * 7 = 42 step by step' },
                ],
              },
            },
          ],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.reasoning).toBe('Computing 6 * 7 = 42 step by step');
    });

    it('populates response_metadata.reasoning_details for the fallback path', () => {
      const message = buildMessage({
        content: 'The answer is 42.',
        finishReason: 'stop',
        rawResponse: {
          choices: [
            {
              message: {
                content: 'The answer is 42.',
                reasoning: 'Computing 6 * 7 = 42 step by step',
                reasoning_details: [
                  { type: 'reasoning.text', text: 'Computing 6 * 7 = 42 step by step' },
                ],
              },
            },
          ],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      const details = (message.response_metadata as Record<string, unknown>)
        .reasoning_details as unknown[];
      expect(Array.isArray(details)).toBe(true);
      expect(details).toHaveLength(1);
    });

    it('captures upstream provider name into response_metadata.openrouter.provider', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          provider: 'Chutes',
          choices: [{ message: { content: 'response', reasoning: 'thinking' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      const openrouter = (message.response_metadata as Record<string, unknown>).openrouter as {
        provider: string;
      };
      expect(openrouter.provider).toBe('Chutes');
    });

    it('captures apiMessageKeys (distinguishes structured-reasoning vs content-only responses)', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'response',
                refusal: null,
                reasoning: 'thinking',
                reasoning_details: [{ type: 'reasoning.text', text: 'thinking' }],
              },
            },
          ],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      const openrouter = (message.response_metadata as Record<string, unknown>).openrouter as {
        apiMessageKeys: string[];
      };
      expect(openrouter.apiMessageKeys).toEqual([
        'role',
        'content',
        'refusal',
        'reasoning',
        'reasoning_details',
      ]);
    });

    it('captures apiReasoningLength = string length when reasoning is populated', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: 'response', reasoning: 'abcdef' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      const openrouter = (message.response_metadata as Record<string, unknown>).openrouter as {
        apiReasoningLength: number;
      };
      expect(openrouter.apiReasoningLength).toBe(6);
    });

    it('captures apiReasoningLength = 0 when model returned no structured reasoning', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: 'response' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      const openrouter = (message.response_metadata as Record<string, unknown>).openrouter as {
        apiReasoningLength: number;
      };
      expect(openrouter.apiReasoningLength).toBe(0);
    });
  });

  describe('memory hygiene', () => {
    it('deletes __raw_response from additional_kwargs after extraction', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: 'response', reasoning: 'thinking' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.__raw_response).toBeUndefined();
    });

    it('preserves other additional_kwargs after deletion', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: 'response', reasoning: 'thinking' } }],
        },
        extraKwargs: { tool_calls: [], function_call: undefined },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.tool_calls).toEqual([]);
    });
  });

  describe('empty-content recovery (free-tier GLM "model put response in reasoning" case)', () => {
    it('promotes reasoning to content when content is empty', () => {
      const message = buildMessage({
        content: '',
        finishReason: 'stop',
        rawResponse: {
          choices: [
            {
              message: {
                content: '',
                reasoning: 'This is the actual response that the model misplaced',
              },
            },
          ],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.content).toBe('This is the actual response that the model misplaced');
    });

    it('does NOT also populate additional_kwargs.reasoning in the empty-content case (avoids audit-trail duplication)', () => {
      const message = buildMessage({
        content: '',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: '', reasoning: 'misplaced response' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.reasoning).toBeUndefined();
    });

    it('falls back to reasoning_details when reasoning string is absent', () => {
      const message = buildMessage({
        content: '',
        finishReason: 'stop',
        rawResponse: {
          choices: [
            {
              message: {
                content: '',
                reasoning_details: [{ type: 'reasoning.text', text: 'Recovered from details' }],
              },
            },
          ],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.content).toBe('Recovered from details');
    });

    it('leaves whitespace-only content unchanged when no reasoning available', () => {
      const message = buildMessage({
        content: '   ',
        finishReason: 'stop',
        rawResponse: {
          choices: [{ message: { content: '   ' } }],
        },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.content).toBe('   ');
    });
  });

  describe('stream-mode safety', () => {
    it('returns unchanged when both __raw_response and finish_reason are absent (partial chunk)', () => {
      const message = new AIMessage({
        content: 'partial',
        additional_kwargs: {},
        response_metadata: {},
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.content).toBe('partial');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('regression detection (loud warn on missing __raw_response)', () => {
    it('logs a warning when finish_reason is present but __raw_response is missing', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        // No rawResponse — simulating LangChain dropping the field
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalKwargsKeys: expect.any(Array),
          responseMetadataKeys: expect.arrayContaining(['finish_reason']),
        }),
        expect.stringContaining('Expected __raw_response')
      );
    });

    it('also handles finishReason (camelCase variant) for the regression-detection guard', () => {
      const message = new AIMessage({
        content: 'response',
        additional_kwargs: {},
        response_metadata: { finishReason: 'stop' },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('Expected __raw_response')
      );
    });

    it('passes through unchanged on regression (does not throw)', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
      });

      expect(() => extractAndPopulateOpenRouterReasoning(message)).not.toThrow();
      expect(message.content).toBe('response');
    });
  });

  describe('malformed __raw_response', () => {
    it('logs warn and cleans up when __raw_response is a non-object primitive', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: 'this is a string, not an object',
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ rawResponseType: 'string' }),
        expect.stringContaining('not an object')
      );
      expect(message.additional_kwargs.__raw_response).toBeUndefined();
    });

    it('cleans up __raw_response when choices array is missing', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: { not_choices: 'wrong shape' },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.__raw_response).toBeUndefined();
      expect(message.additional_kwargs.reasoning).toBeUndefined();
    });

    it('cleans up __raw_response when message is absent from first choice', () => {
      const message = buildMessage({
        content: 'response',
        finishReason: 'stop',
        rawResponse: { choices: [{ index: 0, finish_reason: 'stop' }] },
      });

      extractAndPopulateOpenRouterReasoning(message);

      expect(message.additional_kwargs.__raw_response).toBeUndefined();
    });
  });

  describe('defensive guards', () => {
    it('does not throw on null message', () => {
      expect(() =>
        extractAndPopulateOpenRouterReasoning(null as unknown as BaseMessage)
      ).not.toThrow();
    });

    it('does not throw on undefined message', () => {
      expect(() =>
        extractAndPopulateOpenRouterReasoning(undefined as unknown as BaseMessage)
      ).not.toThrow();
    });

    it('does not throw when additional_kwargs is undefined (test mock shape)', () => {
      const message = { content: 'foo', response_metadata: {} } as unknown as BaseMessage;
      expect(() => extractAndPopulateOpenRouterReasoning(message)).not.toThrow();
    });

    it('does not throw when response_metadata is undefined (test mock shape)', () => {
      const message = { content: 'foo', additional_kwargs: {} } as unknown as BaseMessage;
      expect(() => extractAndPopulateOpenRouterReasoning(message)).not.toThrow();
    });
  });
});
