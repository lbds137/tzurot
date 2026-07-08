/**
 * Tests for LLM Invoker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMInvoker } from './LLMInvoker.js';
import { RetryError } from '../utils/retry.js';
import { classifyQuotaFailure } from './quotaFallback.js';
import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ApiErrorType,
  ApiErrorCategory,
  ERROR_MESSAGES,
} from '@tzurot/common-types/constants/error';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';

// Mock ModelFactory
vi.mock('./ModelFactory.js', () => ({
  createChatModel: vi.fn(({ modelName }) => ({
    model: {
      invoke: vi.fn().mockResolvedValue({ content: 'Test response' }),
    } as any,
    modelName: modelName || 'openrouter/anthropic/claude-sonnet-4.5',
  })),
  getModelCacheKey: vi.fn(({ modelName, apiKey, temperature }) => {
    return `${modelName || 'default'}_${apiKey || 'default'}_${temperature ?? 'none'}`;
  }),
}));

// Spy on withRetry to verify options passed from LLMInvoker
const mockWithRetry = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('../utils/retry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/retry.js')>();
  return {
    ...actual,
    withRetry: (...args: unknown[]) => {
      mockWithRetry(...args);
      return (actual.withRetry as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// Spy on extractAndPopulateOpenRouterReasoning so we can assert the call-site
// wiring between model.invoke() and the helper. Without this test, a future
// refactor that reorders or removes the call would silently break upstream
// provider capture in /inspect with no CI signal (the helper's own unit tests
// cover its behavior, not its invocation point).
const mockExtractReasoning = vi.fn(<T>(message: T) => message);
vi.mock('./modelFactory/extractOpenRouterReasoning.js', () => ({
  extractAndPopulateOpenRouterReasoning: (msg: unknown) => mockExtractReasoning(msg),
}));

// Mock the rate-limit cache singleton so tests can assert cache-read/cache-write
// behavior at the LLMInvoker boundary without standing up a real Redis instance.
const mockIsRateLimited = vi.fn().mockResolvedValue({ rateLimited: false });
const mockMarkRateLimited = vi.fn().mockResolvedValue(undefined);
// Same for credit-exhaustion cache.
const mockIsCreditExhausted = vi.fn().mockResolvedValue({ exhausted: false });
const mockMarkCreditExhausted = vi.fn().mockResolvedValue(undefined);
vi.mock('../redis.js', () => ({
  rateLimitCache: {
    isRateLimited: (...args: unknown[]) => mockIsRateLimited(...args),
    markRateLimited: (...args: unknown[]) => mockMarkRateLimited(...args),
  },
  creditExhaustionCache: {
    isCreditExhausted: (...args: unknown[]) => mockIsCreditExhausted(...args),
    markCreditExhausted: (...args: unknown[]) => mockMarkCreditExhausted(...args),
  },
}));

describe('LLMInvoker', () => {
  let invoker: LLMInvoker;

  beforeEach(() => {
    invoker = new LLMInvoker();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // vi.restoreAllMocks() resets vi.spyOn mocks but does NOT reset
    // vi.fn() implementation overrides; reset mockExtractReasoning's
    // mockImplementation explicitly so call-order test setup doesn't
    // leak into subsequent tests.
    mockExtractReasoning.mockReset();
    mockExtractReasoning.mockImplementation(<T>(msg: T) => msg);
    // Same pattern for the rate-limit cache mocks: clearAllMocks +
    // restoreAllMocks erase the resolved-value defaults set at module
    // scope, so re-establish them between tests.
    mockIsRateLimited.mockReset();
    mockIsRateLimited.mockResolvedValue({ rateLimited: false });
    mockMarkRateLimited.mockReset();
    mockMarkRateLimited.mockResolvedValue(undefined);
    mockIsCreditExhausted.mockReset();
    mockIsCreditExhausted.mockResolvedValue({ exhausted: false });
    mockMarkCreditExhausted.mockReset();
    mockMarkCreditExhausted.mockResolvedValue(undefined);
  });

  describe('getModel', () => {
    it('should create and cache a new model', () => {
      const config = { modelName: 'test-model', apiKey: 'test-key', temperature: 0.8 };
      const result1 = invoker.getModel(config);
      const result2 = invoker.getModel(config);

      expect(result1).toBe(result2); // Same cached instance
      expect(result1.modelName).toBe('test-model');
    });

    it('should create different models for different configurations', () => {
      const result1 = invoker.getModel({ modelName: 'model-1', apiKey: 'key-1', temperature: 0.7 });
      const result2 = invoker.getModel({ modelName: 'model-2', apiKey: 'key-2', temperature: 0.9 });

      expect(result1).not.toBe(result2);
    });

    it('should work without temperature (model uses its own default)', () => {
      const result = invoker.getModel({ modelName: 'test-model' });

      expect(result).toBeDefined();
      expect(result.model).toBeDefined();
    });

    it('should handle empty config', () => {
      const result = invoker.getModel({});

      expect(result).toBeDefined();
      expect(result.modelName).toBeDefined();
    });

    it('should pass all sampling params to ModelFactory', () => {
      const config = {
        modelName: 'test-model',
        apiKey: 'test-key',
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        repetitionPenalty: 1.1,
        maxTokens: 2048,
      };

      const result = invoker.getModel(config);

      expect(result).toBeDefined();
      expect(result.modelName).toBe('test-model');
    });
  });

  describe('invokeWithRetry', () => {
    it('should invoke model successfully on first attempt', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'Success!' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [
        new SystemMessage('You are a helpful assistant'),
        new HumanMessage('Hello'),
      ];

      const result = await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      expect(result.content).toBe('Success!');
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      expect(mockModel.invoke).toHaveBeenCalledWith(messages, expect.any(Object));
    });

    it('should call extractAndPopulateOpenRouterReasoning with the model.invoke() result', async () => {
      // Regression guard: this is the integration point between
      // ChatOpenAI({__includeRawResponse:true}) (set in ModelFactory) and
      // the helper that reads __raw_response. If a future refactor reorders
      // or removes this call, upstream provider capture and reasoning
      // surfacing in /inspect would silently break.
      const responseMessage = { content: 'Reasoning was extracted', additional_kwargs: {} };
      const mockModel = {
        invoke: vi.fn().mockResolvedValue(responseMessage),
      } as any as BaseChatModel;

      await invoker.invokeWithRetry({
        model: mockModel,
        messages: [new HumanMessage('Hello')],
        modelName: 'test-model',
      });

      expect(mockExtractReasoning).toHaveBeenCalledTimes(1);
      expect(mockExtractReasoning).toHaveBeenCalledWith(responseMessage);
    });

    it('should call extractAndPopulateOpenRouterReasoning AFTER model.invoke() (correct ordering)', async () => {
      // Stronger guard: verify the call order. logFinishReason and the empty-
      // response retry guard read response.additional_kwargs.* fields that
      // the extractor populates, so the extractor MUST run before either of
      // those — otherwise the reasoning fields aren't yet attached when those
      // consumers read them.
      const callOrder: string[] = [];
      const responseMessage = { content: 'Hi', additional_kwargs: {} };
      const mockModel = {
        invoke: vi.fn().mockImplementation(async () => {
          callOrder.push('model.invoke');
          return responseMessage;
        }),
      } as any as BaseChatModel;
      mockExtractReasoning.mockImplementation(<T>(msg: T) => {
        callOrder.push('extractor');
        return msg;
      });

      await invoker.invokeWithRetry({
        model: mockModel,
        messages: [new HumanMessage('Hello')],
        modelName: 'test-model',
      });

      expect(callOrder).toEqual(['model.invoke', 'extractor']);
    });

    it('should pass getErrorLogContext as getErrorContext to withRetry', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'Success!' }),
      } as unknown as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          getErrorContext: expect.any(Function),
        })
      );
    });

    it('the 429-storm terminal error classifies quota even when the LAST attempt aborted', async () => {
      // The masked-as-timeout prod shape: an early attempt sees a clean 429
      // (the CAUSE), the final attempt dies of the per-attempt abort (the
      // SYMPTOM). The thrown RetryError must carry the 429 as lastError so
      // classifyQuotaFailure fires the reactive retarget downstream.
      vi.useFakeTimers();

      const rateLimited = new Error('429 Too Many Requests: rate limit exceeded');
      const aborted = Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce(rateLimited)
          .mockRejectedValueOnce(aborted)
          .mockRejectedValueOnce(aborted),
      } as any as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages: [new HumanMessage('Hello')],
        modelName: 'test-model',
      });
      const assertion = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertion;

      const thrown = (await promise.catch((e: unknown) => e)) as RetryError;
      expect(thrown.lastError).toBe(rateLimited);
      expect(classifyQuotaFailure(thrown)).toBe(ApiErrorCategory.RATE_LIMIT);

      vi.useRealTimers();
    });

    it('should retry on transient ECONNRESET error', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'Connection reset' })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // Fast-forward through retry delay
      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on transient ETIMEDOUT error', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'Timeout' })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on transient ENOTFOUND error', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ code: 'ENOTFOUND', message: 'Not found' })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should handle transient error in error message string', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce(new Error('Network error: ECONNRESET occurred'))
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on AbortError (DOMException from timeout)', async () => {
      vi.useFakeTimers();

      // Create a proper DOMException with name='AbortError'
      const abortError = new Error('This operation was aborted');
      abortError.name = 'AbortError';

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce(abortError)
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should fast-fail on permanent errors (no retry)', async () => {
      // Permanent errors like authentication errors should NOT be retried
      const mockModel = {
        invoke: vi.fn().mockRejectedValue(new Error('API key invalid')),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      // Should fail immediately without retrying
      await expect(
        invoker.invokeWithRetry({ model: mockModel, messages, modelName: 'test-model' })
      ).rejects.toThrow();

      // Only called once because permanent errors fast-fail
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });

    it('should fast-fail on 402 quota exceeded error', async () => {
      const mockModel = {
        invoke: vi.fn().mockRejectedValue({ status: 402, message: 'Quota exceeded' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await expect(
        invoker.invokeWithRetry({ model: mockModel, messages, modelName: 'test-model' })
      ).rejects.toThrow();

      // Only called once because quota exceeded is permanent
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });

    it('should fast-fail on daily limit error message', async () => {
      const mockModel = {
        invoke: vi.fn().mockRejectedValue(new Error('50 requests per day limit reached')),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await expect(
        invoker.invokeWithRetry({ model: mockModel, messages, modelName: 'test-model' })
      ).rejects.toThrow();

      // Only called once because daily limit is permanent
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries exhausted', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi.fn().mockRejectedValue({ code: 'ECONNRESET', message: 'Connection reset' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning
      const rejectionPromise = expect(promise).rejects.toThrow();

      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();

      // Await the rejection
      await rejectionPromise;

      // Should be called: RETRY_CONFIG.MAX_ATTEMPTS = 3 (1 initial + 2 retries)
      expect(mockModel.invoke).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should use exponential backoff for retries', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ code: 'ECONNRESET' })
          .mockRejectedValueOnce({ code: 'ECONNRESET' })
          .mockResolvedValueOnce({ content: 'Success' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // First retry: 2^0 * 1000ms = 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      // Second retry: 2^1 * 1000ms = 2000ms
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result.content).toBe('Success');
      expect(mockModel.invoke).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should respect global timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      // Mock TIMEOUTS.LLM_INVOCATION to a lower value to make the test faster
      // and allow the global timeout to trigger before all retry attempts complete
      const originalLLMTimeout = TIMEOUTS.LLM_INVOCATION;
      (TIMEOUTS as any).LLM_INVOCATION = 105000; // 105s

      try {
        // Mock a model that takes 70s per call and always fails with transient error
        // Timeline: globalTimeoutMs = 105000ms (mocked)
        // - Attempt 1 at 0ms: invoke (70s), fails, retry delay 1s -> elapsed 71s
        // - Attempt 2 at 71s: invoke (70s), fails, retry delay 2s -> elapsed 143s
        // - Attempt 3 at 143s: timeout check (143s >= 105s) -> THROWS global timeout
        const mockModel = {
          invoke: vi.fn().mockImplementation(
            () =>
              new Promise((_, reject) => {
                // eslint-disable-next-line no-restricted-syntax -- Mocked 70s model latency under vi.useFakeTimers(); flushed by runAllTimersAsync below, not a real delay
                setTimeout(() => reject({ code: 'ETIMEDOUT', message: 'Timeout' }), 70000);
              })
          ),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const promise = invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning
        const rejectionPromise = expect(promise).rejects.toThrow(/exceeded global timeout/i);

        // Fast-forward through all timers - should trigger global timeout before max retries
        await vi.runAllTimersAsync();

        // Await the rejection
        await rejectionPromise;
      } finally {
        // Restore the original timeout value
        (TIMEOUTS as any).LLM_INVOCATION = originalLLMTimeout;
        vi.useRealTimers();
      }
    });

    it('should pass timeout parameter to model invoke', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'Success' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await invoker.invokeWithRetry({ model: mockModel, messages, modelName: 'test-model' });

      expect(mockModel.invoke).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });

    it('should retry on empty string response', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockResolvedValueOnce({ content: '' }) // Empty string
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on whitespace-only string response', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockResolvedValueOnce({ content: '   \n\t  ' }) // Whitespace only
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on empty multimodal array response', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockResolvedValueOnce({ content: [] }) // Empty array
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on multimodal array with only empty text blocks', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockResolvedValueOnce({
            content: [{ text: '' }, { text: '  ' }, { text: '\n' }], // All empty/whitespace
          })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should accept multimodal array with valid text content', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({
          content: [{ text: 'Part 1' }, { text: ' Part 2' }],
        }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const result = await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      expect(result.content).toEqual([{ text: 'Part 1' }, { text: ' Part 2' }]);
      expect(mockModel.invoke).toHaveBeenCalledTimes(1); // No retry needed
    });

    it('should handle multimodal array with mixed content types', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({
          content: [
            { text: 'Text part' },
            { type: 'image', data: 'base64...' }, // Non-text content (no 'text' property)
          ],
        }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // Should succeed because there's at least some text content
      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries on persistent empty responses', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: '' }), // Always empty
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // Attach rejection handler BEFORE advancing timers
      const rejectionPromise = expect(promise).rejects.toThrow();

      await vi.runAllTimersAsync();

      await rejectionPromise;

      // Should retry max attempts (3)
      expect(mockModel.invoke).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should retry on censored response ("ext" from Gemini safety filters)', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockResolvedValueOnce({ content: 'ext' }) // Censored response
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should throw after max retries on persistent censored responses', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'ext' }), // Always censored
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      // Attach rejection handler BEFORE advancing timers
      // The retry service wraps errors in RetryError after exhausting attempts
      const rejectionPromise = expect(promise).rejects.toThrow(/failed after 3 attempts/);

      await vi.runAllTimersAsync();

      await rejectionPromise;

      // Should retry max attempts (3)
      expect(mockModel.invoke).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('should not retry on "ext" as part of valid response content', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'The file has a .ext extension' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const result = await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'test-model',
      });

      expect(result.content).toBe('The file has a .ext extension');
      expect(mockModel.invoke).toHaveBeenCalledTimes(1); // No retry needed
    });

    describe('reasoning model support', () => {
      it('should detect and log reasoning model type for o1 models', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({ content: 'Reasoning response' }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'openai/o1-preview',
        });

        expect(result.content).toBe('Reasoning response');
        expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      });

      it('should detect and log reasoning model type for Claude thinking models', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({ content: 'Claude thinking response' }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-3-7-sonnet:thinking',
        });

        expect(result.content).toBe('Claude thinking response');
        expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      });

      it('should NOT strip thinking tags (delegated to ResponsePostProcessor)', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: '<thinking>Let me think about this...</thinking>Here is my answer.',
            additional_kwargs: {},
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        // LLMInvoker no longer strips tags — ResponsePostProcessor handles extraction
        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-3-7-sonnet:thinking',
        });

        // Tags preserved for downstream extraction by ResponsePostProcessor
        expect(result.content).toBe(
          '<thinking>Let me think about this...</thinking>Here is my answer.'
        );
      });

      it('should preserve response if no thinking tags present', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Just a normal response',
            additional_kwargs: { key: 'value' },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-3-7-sonnet:thinking',
        });

        expect(result.content).toBe('Just a normal response');
        // Should return original response, not create new AIMessage
        expect(result.additional_kwargs).toEqual({ key: 'value' });
      });

      it('should preserve multimodal array content for reasoning model response', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: [{ text: '<thinking>Analyzing...</thinking>' }, { text: 'The answer is 42.' }],
            additional_kwargs: {},
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('What is 6*7?')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-3-7-sonnet:thinking',
        });

        // Content preserved as-is — ResponsePostProcessor handles extraction
        expect(result.content).toEqual([
          { text: '<thinking>Analyzing...</thinking>' },
          { text: 'The answer is 42.' },
        ]);
      });

      it('should handle array content blocks with non-text elements', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: [{ type: 'image', data: 'base64...' }, { text: 'Image description' }],
            additional_kwargs: {},
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Describe this')];

        // Use standard model - no thinking tag stripping
        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'openai/gpt-4',
        });

        // Should pass through unchanged for standard models
        expect(result.content).toEqual([
          { type: 'image', data: 'base64...' },
          { text: 'Image description' },
        ]);
      });

      it('should not strip thinking tags for standard (non-reasoning) models', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: '<thinking>This is valid content</thinking>',
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'openai/gpt-4',
        });

        // Standard models should preserve thinking tags
        expect(result.content).toBe('<thinking>This is valid content</thinking>');
      });

      it('should preserve Gemini thinking model content for downstream extraction', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: '<thinking>Working on it</thinking>The result is here.',
            additional_kwargs: {},
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        // Gemini thinking pattern — tags preserved for ResponsePostProcessor
        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'google/gemini-2.0-flash-thinking',
        });

        expect(result.content).toBe('<thinking>Working on it</thinking>The result is here.');
      });
    });

    describe('finish_reason logging', () => {
      /**
       * Tests for logFinishReason method - logs completion quality for diagnostics.
       * This helps identify models that fail to emit stop tokens (hallucinated turn bug).
       */

      it('should log debug when no response_metadata available', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response without metadata',
            // No response_metadata
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        // Should complete successfully even without metadata
        expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      });

      it('should log info with WARNING prefix when finish_reason is length', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Truncated response...',
            response_metadata: {
              finish_reason: 'length',
              usage: { prompt_tokens: 100, completion_tokens: 4096, total_tokens: 4196 },
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        expect(result.content).toBe('Truncated response...');
        expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      });

      it('should log debug when finish_reason is stop (natural completion)', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Complete response',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        expect(result.content).toBe('Complete response');
      });

      it('should log debug when finish_reason is end_turn (Anthropic)', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Complete response from Claude',
            response_metadata: {
              finish_reason: 'end_turn',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-sonnet',
        });

        expect(result.content).toBe('Complete response from Claude');
      });

      it('should log debug when finish_reason is STOP (uppercase from some providers)', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Complete response',
            response_metadata: {
              finish_reason: 'STOP',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'google/gemini-pro',
        });

        expect(result.content).toBe('Complete response');
      });

      it('should handle Anthropic stop_reason field name', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Complete response',
            response_metadata: {
              stop_reason: 'end_turn', // Anthropic uses stop_reason instead of finish_reason
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude',
        });

        expect(result.content).toBe('Complete response');
      });

      it('should handle Google finishReason camelCase field name', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Complete response',
            response_metadata: {
              finishReason: 'STOP', // Google uses camelCase
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'google/gemini-pro',
        });

        expect(result.content).toBe('Complete response');
      });

      it('throws retryable on finish_reason "error" — a provider failure inside a 200', async () => {
        // The prod shape: OpenRouter returns 200 with finish_reason 'error'
        // and partial (single-character) content when the upstream provider
        // dies mid-generation. The content passes the emptiness guard, so
        // without the error-finish guard it would be delivered and stored.
        vi.useFakeTimers();

        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: '.',
            response_metadata: {
              finish_reason: 'error',
              usage: { prompt_tokens: 54810, completion_tokens: 1 },
              // Post-extraction state: the OpenRouter extractor captured the
              // provider's failure detail before deleting __raw_response —
              // exercised here so the guard's warn-log detail path runs.
              openrouter: {
                providerError: { message: 'Upstream provider dropped the stream', code: 502 },
              },
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const promise = invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-5.2',
        });

        // Attach rejection handler BEFORE advancing timers. Retry exhaustion
        // wraps the underlying failure in RetryError — assert on lastError,
        // where the stable provider-failure message lives.
        const rejection = promise.catch((err: unknown) => err);
        await vi.runAllTimersAsync();
        const thrown = await rejection;

        expect(thrown).toBeInstanceOf(RetryError);
        expect(((thrown as RetryError).lastError as Error).message).toBe(
          ERROR_MESSAGES.PROVIDER_ERROR_FINISH
        );
        // Full retry budget consumed — the throw classifies retryable, so a
        // different upstream host gets a chance on each attempt.
        expect(mockModel.invoke).toHaveBeenCalledTimes(3);

        vi.useRealTimers();
      });

      it('recovers when a retry after an error finish succeeds', async () => {
        vi.useFakeTimers();

        const mockModel = {
          invoke: vi
            .fn()
            .mockResolvedValueOnce({
              content: '.',
              response_metadata: { finish_reason: 'error' },
            })
            .mockResolvedValueOnce({
              content: 'Full response from a healthier provider',
              response_metadata: { finish_reason: 'stop' },
            }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const promise = invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-5.2',
        });
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.content).toBe('Full response from a healthier provider');
        expect(mockModel.invoke).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      });

      it('does NOT throw on finish_reason "content_filter" (guard scoped to error only)', async () => {
        // content_filter is a policy outcome, not a provider failure — a
        // retry would not help, and its handling is a separate decision.
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Partial but deliverable response',
            response_metadata: { finish_reason: 'content_filter' },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        expect(result.content).toBe('Partial but deliverable response');
        expect(mockModel.invoke).toHaveBeenCalledTimes(1);
      });

      it('should log info for unknown finish_reason values', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response with unusual finish',
            response_metadata: {
              finish_reason: 'content_filter', // Unknown/unusual reason
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        expect(result.content).toBe('Response with unusual finish');
      });

      it('should include token usage in log context when available', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response with usage stats',
            response_metadata: {
              finish_reason: 'stop',
              usage: {
                prompt_tokens: 150,
                completion_tokens: 200,
                total_tokens: 350,
              },
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
        });

        expect(result.content).toBe('Response with usage stats');
      });
    });
  });

  describe('rate-limit cache integration', () => {
    it('skips the LLM call when cache says (cacheKeyId, model) is rate-limited', async () => {
      // Cache reports an active rate-limit window
      const cachedResetMs = Date.now() + 3600 * 1000;
      mockIsRateLimited.mockResolvedValueOnce({
        rateLimited: true,
        resetMs: cachedResetMs,
        ttlSeconds: 3600,
      });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn();
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      // Stronger assertion than `.toThrow()`: the synthetic short-circuit error
      // MUST carry the same shape downstream consumers see for real 429s. If
      // `shortCircuitOnCachedRateLimit` ever stops constructing this shape
      // (e.g., a refactor swaps the ApiError builder), every caller's error
      // handling silently regresses. The shape includes `info.rateLimitResetMs`
      // populated from the cache so callers can surface wait-time UX.
      await expect(
        invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-4.5-air:free',
          cacheKeyId: 'user:111111111111111111',
        })
      ).rejects.toMatchObject({
        message: 'Rate limit cached',
        info: expect.objectContaining({
          rateLimitResetMs: cachedResetMs,
          // The synthetic short-circuit MUST advertise PERMANENT + shouldRetry=false
          // so future callers using `shouldRetryError()` don't re-enter the cache
          // → throw → loop. The cache hit represents a deterministic block until
          // the reset window, not a transient error worth retrying.
          shouldRetry: false,
          type: ApiErrorType.PERMANENT,
          // Stable sentinel referenceId: a generated ID would point to a fake
          // error object with no upstream call to trace. The sentinel makes it
          // unambiguous in logs/support that the reference traces to cache logic.
          referenceId: 'rate-limit-cache-hit',
        }),
      });

      // model.invoke should NOT have been called — short-circuit happened first
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('skips cache integration entirely when cacheKeyId is empty', async () => {
      // Even if cache somehow says rate-limited, an empty cacheKeyId opts out
      mockIsRateLimited.mockResolvedValueOnce({
        rateLimited: true,
        resetMs: Date.now() + 3600 * 1000,
        ttlSeconds: 3600,
      });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn().mockResolvedValue({ content: 'ok' });
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.5-air:free',
        cacheKeyId: '',
      });

      expect(mockIsRateLimited).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('writes to cache on 429 with X-RateLimit-Reset header', async () => {
      vi.useFakeTimers();

      const resetMs = Date.now() + 3600 * 1000;
      const messages: BaseMessage[] = [new HumanMessage('test')];
      // Simulate a real LangChain 429 with the OpenRouter envelope shape
      const error = Object.assign(new Error('Rate limit exceeded'), {
        status: 429,
        error: {
          metadata: {
            headers: {
              'X-RateLimit-Reset': String(resetMs),
            },
          },
        },
      });
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.5-air:free',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      // Cache write now persists the original error context (category +
      // user message + technical message) so synthetic short-circuits at
      // read time can replay the exact context the user would have seen
      // on a real upstream 429. expect.objectContaining lets future
      // additions to the persisted context not break this assertion.
      expect(mockMarkRateLimited).toHaveBeenCalledWith(
        expect.objectContaining({
          cacheKeyId: 'user:111111111111111111',
          model: 'z-ai/glm-4.5-air:free',
          resetTimestampMs: resetMs,
          category: ApiErrorCategory.RATE_LIMIT,
          userMessage: expect.any(String),
          technicalMessage: expect.any(String),
        })
      );

      vi.useRealTimers();
    });

    it('falls back to a 15-minute cooldown when a 429 lacks a reset header', async () => {
      // Without this fallback, header-less 429s burned three full retry
      // attempts every time. Some upstream 429 paths (e.g., Google AI
      // Studio free-tier through OpenRouter) omit X-RateLimit-Reset
      // entirely. The default cooldown bounds the retry storm to one full
      // attempt + cached short-circuit until the cooldown expires.
      vi.useFakeTimers();
      const nowMs = Date.now();

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const error = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.5-air:free',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      // Fake-time advances during retries (initialDelay + backoff), so the
      // actual resetTimestampMs is `nowMs + retryDrift + 15min`. Assert the
      // call shape, then check resetTimestampMs falls within the expected
      // window (15min target + up to 60s of retry drift).
      expect(mockMarkRateLimited).toHaveBeenCalledTimes(1);
      const [callArgs] = mockMarkRateLimited.mock.calls[0];
      expect(callArgs).toMatchObject({
        cacheKeyId: 'user:111111111111111111',
        model: 'z-ai/glm-4.5-air:free',
        category: ApiErrorCategory.RATE_LIMIT,
      });
      expect(callArgs.resetTimestampMs).toBeGreaterThanOrEqual(nowMs + 15 * 60 * 1000);
      expect(callArgs.resetTimestampMs).toBeLessThanOrEqual(nowMs + 15 * 60 * 1000 + 60 * 1000);

      vi.useRealTimers();
    });

    it('does not write to cache for non-429 errors', async () => {
      vi.useFakeTimers();

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const error = Object.assign(new Error('Server error'), { status: 500 });
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.5-air:free',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockMarkRateLimited).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('credit-exhaustion cache integration', () => {
    it('skips the LLM call when cache says cacheKeyId is credit-exhausted', async () => {
      const exhaustedAtMs = Date.now() - 600 * 1000; // 10 min ago
      mockIsCreditExhausted.mockResolvedValueOnce({
        exhausted: true,
        exhaustedAtMs,
        ttlSeconds: 3000,
      });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn();
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      // Strong shape assertion: synthetic short-circuit MUST carry the
      // CREDIT_EXHAUSTION category and the stable sentinel referenceId.
      // A regression where the synthetic error loses these would silently
      // surface a generic-quota error to users instead of the sharper
      // "your account is out of credits" message.
      await expect(
        invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-4.7',
          cacheKeyId: 'user:111111111111111111',
        })
      ).rejects.toMatchObject({
        message: 'Credit exhaustion cached',
        info: expect.objectContaining({
          category: ApiErrorCategory.CREDIT_EXHAUSTION,
          shouldRetry: false,
          type: ApiErrorType.PERMANENT,
          referenceId: 'credit-exhaustion-cache-hit',
          // userMessage must explicitly match the CREDIT_EXHAUSTION entry,
          // not the generic QUOTA_EXCEEDED message — the throw site uses
          // an explicit override (not just spread inheritance) to keep
          // category and userMessage from drifting apart if the synthetic
          // message text or pattern matcher ever changes.
          userMessage: expect.stringContaining('https://openrouter.ai/settings/credits'),
        }),
      });

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('skips both caches entirely when cacheKeyId is empty', async () => {
      mockIsCreditExhausted.mockResolvedValueOnce({
        exhausted: true,
        exhaustedAtMs: Date.now() - 600 * 1000,
        ttlSeconds: 3000,
      });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn().mockResolvedValue({ content: 'ok' });
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.7',
        cacheKeyId: '',
      });

      expect(mockIsCreditExhausted).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalled();
    });

    it('writes to cache on account-level 402 ("never purchased credits")', async () => {
      vi.useFakeTimers();

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const error = Object.assign(
        new Error(
          '402 Insufficient credits. This account never purchased credits. Make sure your key is on the correct account or org, and if so, purchase more at https://openrouter.ai/settings/credits'
        ),
        { status: 402 }
      );
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.7',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockMarkCreditExhausted).toHaveBeenCalledWith({
        cacheKeyId: 'user:111111111111111111',
      });

      vi.useRealTimers();
    });

    it('does NOT write to cache on request-level 402 ("can only afford")', async () => {
      vi.useFakeTimers();

      const messages: BaseMessage[] = [new HumanMessage('test')];
      // Request-level 402 — different remediation (smaller max_tokens), not
      // an account-level credit-exhaustion. Caching this would block valid
      // smaller-budget retries.
      const error = Object.assign(
        new Error(
          '402 Insufficient credits. This request requested up to 65536 tokens, but can only afford 11111.'
        ),
        { status: 402 }
      );
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.7',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockMarkCreditExhausted).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does NOT write to cache for non-402 errors', async () => {
      vi.useFakeTimers();

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const error = Object.assign(new Error('Server error'), { status: 500 });
      const mockInvoke = vi.fn().mockRejectedValue(error);
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      const promise = invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.7',
        cacheKeyId: 'user:111111111111111111',
      });
      const assertion = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockMarkCreditExhausted).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('credit-exhaustion check runs BEFORE rate-limit check', async () => {
      // Both caches return hits. The credit-exhaustion error must surface
      // because it represents a worse (account-wide) failure mode than a
      // per-model rate-limit. Verified by the call order on the mocks.
      mockIsCreditExhausted.mockResolvedValueOnce({
        exhausted: true,
        exhaustedAtMs: Date.now() - 600 * 1000,
        ttlSeconds: 3000,
      });
      mockIsRateLimited.mockResolvedValueOnce({
        rateLimited: true,
        resetMs: Date.now() + 3600 * 1000,
        ttlSeconds: 3600,
      });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn();
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      await expect(
        invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-4.7',
          cacheKeyId: 'user:111111111111111111',
        })
      ).rejects.toMatchObject({
        info: expect.objectContaining({
          category: ApiErrorCategory.CREDIT_EXHAUSTION,
        }),
      });

      // The rate-limit check should NOT even fire — the credit-exhaustion
      // throw happens first and never falls through to the rate-limit guard.
      expect(mockIsCreditExhausted).toHaveBeenCalledTimes(1);
      expect(mockIsRateLimited).not.toHaveBeenCalled();
    });
  });

  describe('cacheKeyId invariant validation at invokeWithRetry call site', () => {
    // The producer-side `assertValidCacheKeyId` inside `deriveCacheKeyId` is
    // dormant against current outputs by construction, so it doesn't catch
    // callers that bypass the producer and pass arbitrary strings into
    // `InvokeWithRetryOptions.cacheKeyId`. The consumer-side guard inside
    // `invokeWithRetry`'s else branch closes that gap.
    it('does not throw on an invalid `cacheKeyId` shape — warn-only contract', async () => {
      // Cache reports no active block so the call proceeds past the
      // short-circuit guards and exercises the full validation + cache path.
      mockIsCreditExhausted.mockResolvedValueOnce({ exhausted: false });
      mockIsRateLimited.mockResolvedValueOnce({ rateLimited: false });

      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn().mockResolvedValue({ content: 'ok' });
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      await expect(
        invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-4.5-air:free',
          // Colon-bearing scope that violates the format invariant — this
          // is exactly the future-misuse case the consumer-side guard exists
          // to detect.
          cacheKeyId: 'org:my-team:special',
        })
      ).resolves.toBeDefined();

      // Cache calls still execute — the validator is a non-blocking sentinel,
      // not a control-flow guard. If a future refactor escalates the
      // assertion to a throw, this expectation surfaces the regression.
      expect(mockIsCreditExhausted).toHaveBeenCalledTimes(1);
      expect(mockIsRateLimited).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('does not invoke the validator when cacheKeyId is empty (cache opt-out path)', async () => {
      // The empty-string branch goes through the debug-log path, not the
      // else branch — so the consumer-side `assertValidCacheKeyId` call
      // does not fire. Verified by exercising the empty path and
      // confirming the cache calls don't happen (which would imply the
      // else branch wasn't taken).
      const messages: BaseMessage[] = [new HumanMessage('test')];
      const mockInvoke = vi.fn().mockResolvedValue({ content: 'ok' });
      const mockModel = { invoke: mockInvoke } as unknown as BaseChatModel;

      await invoker.invokeWithRetry({
        model: mockModel,
        messages,
        modelName: 'z-ai/glm-4.5-air:free',
        cacheKeyId: '',
      });

      expect(mockIsCreditExhausted).not.toHaveBeenCalled();
      expect(mockIsRateLimited).not.toHaveBeenCalled();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });
});
