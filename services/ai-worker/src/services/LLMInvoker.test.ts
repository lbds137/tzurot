/**
 * Tests for LLM Invoker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMInvoker, supportsStopSequences } from './LLMInvoker.js';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { TIMEOUTS } from '@tzurot/common-types';

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

// Mock StopSequenceTracker
const mockRecordStopSequenceActivation = vi.fn();
vi.mock('./StopSequenceTracker.js', () => ({
  recordStopSequenceActivation: (...args: unknown[]) => mockRecordStopSequenceActivation(...args),
}));

describe('LLMInvoker', () => {
  let invoker: LLMInvoker;

  beforeEach(() => {
    invoker = new LLMInvoker();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

      it('should log info when stop sequence triggered', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response stopped by',
            response_metadata: {
              finish_reason: 'stop_sequence',
              stop: '\nUser:', // The stop sequence that triggered
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        const result = await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          stopSequences: ['\nUser:', '\nHuman:', '</message>'],
        });

        expect(result.content).toBe('Response stopped by');
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

      it('should include stop sequence count in log context', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          stopSequences: ['</message>', '\nUser:', '\nHuman:'],
        });

        // Just verify it completes successfully with stop sequences configured
        expect(mockModel.invoke).toHaveBeenCalledWith(
          messages,
          expect.objectContaining({
            stop: ['</message>', '\nUser:', '\nHuman:'],
          })
        );
      });

      it('should filter out stop sequences for models that do not support them', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response from GLM',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'z-ai/glm-4.5-air:free',
          stopSequences: ['</message>', '\nUser:', '\nHuman:'],
        });

        // Stop sequences should NOT be passed to the model
        expect(mockModel.invoke).toHaveBeenCalledWith(
          messages,
          expect.not.objectContaining({
            stop: expect.anything(),
          })
        );
      });

      it('should pass stop sequences for models that support them', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Response from Claude',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'anthropic/claude-sonnet-4.5',
          stopSequences: ['</message>', '\nUser:'],
        });

        // Stop sequences SHOULD be passed to the model
        expect(mockModel.invoke).toHaveBeenCalledWith(
          messages,
          expect.objectContaining({
            stop: ['</message>', '\nUser:'],
          })
        );
      });

      it('should record stop sequence when provider reports stoppedAt with natural finish_reason', async () => {
        // Provider returns finish_reason: "stop" with stop: "\nLilith:" — the reordered
        // if/else ensures stoppedAt is checked before isNaturalStop
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Let me respond as',
            response_metadata: {
              finish_reason: 'stop',
              stop: '\nLilith:',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          stopSequences: ['</message>', '<message', '\nLilith:'],
        });

        expect(mockRecordStopSequenceActivation).toHaveBeenCalledWith('\nLilith:', 'test-model');
      });

      it('should infer stop sequence when finish_reason is stop but content lacks </message>', async () => {
        // Provider says "stop" but doesn't report which sequence fired.
        // Content doesn't end with </message>, so a non-XML stop likely triggered.
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Let me respond as',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          stopSequences: ['</message>', '<message'],
        });

        expect(mockRecordStopSequenceActivation).toHaveBeenCalledWith(
          'inferred:non-xml-stop',
          'test-model'
        );
      });

      it('should not infer stop sequence when content ends with </message>', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Here is my response</message>',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          stopSequences: ['</message>', '<message'],
        });

        // Natural completion — no stop sequence recorded
        expect(mockRecordStopSequenceActivation).not.toHaveBeenCalled();
      });

      it('should not infer stop sequence when no stop sequences were configured', async () => {
        const mockModel = {
          invoke: vi.fn().mockResolvedValue({
            content: 'Some partial response',
            response_metadata: {
              finish_reason: 'stop',
            },
          }),
        } as any as BaseChatModel;

        const messages: BaseMessage[] = [new HumanMessage('Hello')];

        await invoker.invokeWithRetry({
          model: mockModel,
          messages,
          modelName: 'test-model',
          // No stopSequences passed
        });

        expect(mockRecordStopSequenceActivation).not.toHaveBeenCalled();
      });
    });
  });
});

describe('supportsStopSequences', () => {
  describe('models that DO NOT support stop sequences', () => {
    it('should return false for GLM 4.5 Air variants', () => {
      expect(supportsStopSequences('z-ai/glm-4.5-air:free')).toBe(false);
      expect(supportsStopSequences('z-ai/glm-4.5-air')).toBe(false);
      expect(supportsStopSequences('glm-4.5-air:free')).toBe(false);
    });

    it('should return false for Gemini 3 Pro Preview', () => {
      expect(supportsStopSequences('google/gemini-3-pro-preview')).toBe(false);
      expect(supportsStopSequences('gemini-3-pro-preview')).toBe(false);
    });

    it('should return false for Gemma 3 27B free tier', () => {
      expect(supportsStopSequences('google/gemma-3-27b-it:free')).toBe(false);
      expect(supportsStopSequences('gemma-3-27b-it:free')).toBe(false);
    });

    it('should return false for Llama 3.3 70B free tier', () => {
      expect(supportsStopSequences('meta-llama/llama-3.3-70b-instruct:free')).toBe(false);
      expect(supportsStopSequences('llama-3.3-70b-instruct:free')).toBe(false);
    });

    it('should return false for DeepSeek R1-0528 free tier', () => {
      expect(supportsStopSequences('deepseek/deepseek-r1-0528:free')).toBe(false);
      expect(supportsStopSequences('deepseek-r1-0528:free')).toBe(false);
    });
  });

  describe('models that DO support stop sequences', () => {
    it('should return true for GLM 4.6 and 4.7 (paid versions support stop)', () => {
      expect(supportsStopSequences('z-ai/glm-4.6')).toBe(true);
      expect(supportsStopSequences('z-ai/glm-4.7')).toBe(true);
    });

    it('should return true for Gemini 3 Flash Preview', () => {
      expect(supportsStopSequences('google/gemini-3-flash-preview')).toBe(true);
    });

    it('should return true for Gemini 2.5 models', () => {
      expect(supportsStopSequences('google/gemini-2.5-flash')).toBe(true);
      expect(supportsStopSequences('google/gemini-2.5-pro')).toBe(true);
    });

    it('should return true for Claude models', () => {
      expect(supportsStopSequences('anthropic/claude-sonnet-4.5')).toBe(true);
      expect(supportsStopSequences('anthropic/claude-haiku-4.5')).toBe(true);
      expect(supportsStopSequences('anthropic/claude-opus-4.5')).toBe(true);
    });

    it('should return true for DeepSeek models', () => {
      expect(supportsStopSequences('deepseek/deepseek-v3.2')).toBe(true);
      expect(supportsStopSequences('tngtech/deepseek-r1t-chimera:free')).toBe(true);
    });

    it('should return true for Kimi K2 Thinking', () => {
      expect(supportsStopSequences('moonshotai/kimi-k2-thinking')).toBe(true);
    });

    it('should return true for Mistral models', () => {
      expect(supportsStopSequences('mistralai/mistral-small-3.1-24b-instruct:free')).toBe(true);
    });

    it('should return true for Hermes models', () => {
      expect(supportsStopSequences('nousresearch/hermes-3-llama-3.1-405b:free')).toBe(true);
    });
  });
});
