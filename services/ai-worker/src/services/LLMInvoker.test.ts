/**
 * Tests for LLM Invoker
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMInvoker } from './LLMInvoker.js';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

// Mock ModelFactory
vi.mock('./ModelFactory.js', () => ({
  createChatModel: vi.fn(({ modelName }) => ({
    model: {
      invoke: vi.fn().mockResolvedValue({ content: 'Test response' }),
    } as any,
    modelName: modelName || 'openrouter/anthropic/claude-sonnet-4.5',
  })),
  getModelCacheKey: vi.fn(({ modelName, apiKey, temperature }) => {
    return `${modelName || 'default'}_${apiKey || 'default'}_${temperature || 0.7}`;
  }),
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
      const result1 = invoker.getModel('test-model', 'test-key', 0.8);
      const result2 = invoker.getModel('test-model', 'test-key', 0.8);

      expect(result1).toBe(result2); // Same cached instance
      expect(result1.modelName).toBe('test-model');
    });

    it('should create different models for different configurations', () => {
      const result1 = invoker.getModel('model-1', 'key-1', 0.7);
      const result2 = invoker.getModel('model-2', 'key-2', 0.9);

      expect(result1).not.toBe(result2);
    });

    it('should use default temperature when not provided', () => {
      const result = invoker.getModel('test-model');

      expect(result).toBeDefined();
      expect(result.model).toBeDefined();
    });

    it('should handle undefined parameters', () => {
      const result = invoker.getModel();

      expect(result).toBeDefined();
      expect(result.modelName).toBeDefined();
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

      const result = await invoker.invokeWithRetry(mockModel, messages, 'test-model');

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

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

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

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

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

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

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

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on ABORTED error code', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ code: 'ABORTED', message: 'Request aborted' })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on ABORTED status', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce({ status: 'ABORTED', message: 'Request aborted' })
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should retry on ABORTED in error message', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi
          .fn()
          .mockRejectedValueOnce(new Error('Stream ABORTED by server'))
          .mockResolvedValueOnce({ content: 'Success after retry' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      await vi.runAllTimersAsync();

      const result = await promise;

      expect(result.content).toBe('Success after retry');
      expect(mockModel.invoke).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('should not retry on non-transient errors', async () => {
      const mockModel = {
        invoke: vi.fn().mockRejectedValue(new Error('API key invalid')),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await expect(invoker.invokeWithRetry(mockModel, messages, 'test-model')).rejects.toThrow(
        'API key invalid'
      );

      expect(mockModel.invoke).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries exhausted', async () => {
      vi.useFakeTimers();

      const mockModel = {
        invoke: vi.fn().mockRejectedValue({ code: 'ECONNRESET', message: 'Connection reset' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning
      const rejectionPromise = expect(promise).rejects.toThrow();

      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();

      // Await the rejection
      await rejectionPromise;

      // Should be called: initial + 2 retries = 3 times (based on RETRY_CONFIG.LLM_MAX_RETRIES = 2)
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

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

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
      vi.useFakeTimers();

      // Mock a model that takes 70s per call and always fails with transient error
      // Timeline with RETRY_CONFIG.LLM_GLOBAL_TIMEOUT = 120000ms:
      // - Attempt 0 at 0ms: invoke (70s), fails, retry delay 1s -> elapsed 71s
      // - Attempt 1 at 71s: invoke (70s), fails, retry delay 2s -> elapsed 143s
      // - Attempt 2 at 143s: timeout check (143s >= 120s) -> THROWS global timeout
      const mockModel = {
        invoke: vi.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              setTimeout(() => reject({ code: 'ETIMEDOUT', message: 'Timeout' }), 70000);
            })
        ),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      const promise = invoker.invokeWithRetry(mockModel, messages, 'test-model');

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning
      const rejectionPromise = expect(promise).rejects.toThrow(/global timeout exceeded/i);

      // Fast-forward through all timers - should trigger global timeout before max retries
      await vi.runAllTimersAsync();

      // Await the rejection
      await rejectionPromise;

      vi.useRealTimers();
    });

    it('should pass timeout parameter to model invoke', async () => {
      const mockModel = {
        invoke: vi.fn().mockResolvedValue({ content: 'Success' }),
      } as any as BaseChatModel;

      const messages: BaseMessage[] = [new HumanMessage('Hello')];

      await invoker.invokeWithRetry(mockModel, messages, 'test-model');

      expect(mockModel.invoke).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });
  });
});
