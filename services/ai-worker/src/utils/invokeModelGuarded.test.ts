/**
 * Guarded model invocation tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { invokeModelGuarded } from './invokeModelGuarded.js';
import { parseApiError } from './apiErrorParser.js';
import { ApiErrorCategory, ERROR_MESSAGES } from '@tzurot/common-types/constants/error';

type TestCallOptions = Partial<BaseChatModelCallOptions>;

function buildModel(mockGenerate: ReturnType<typeof vi.fn>): BaseChatModel {
  return { generate: mockGenerate } as unknown as BaseChatModel;
}

describe('invokeModelGuarded', () => {
  const messages = [new HumanMessage('hi')];

  it('returns the same message object generate resolved (happy path)', async () => {
    const sentinelMessage = new AIMessageChunk('hi there');
    const mockGenerate = vi.fn().mockResolvedValue({
      generations: [[{ text: 'hi there', message: sentinelMessage }]],
    });
    const model = buildModel(mockGenerate);

    const result = await invokeModelGuarded(model, messages);

    expect(result).toBe(sentinelMessage);
  });

  it('calls generate with the messages wrapped in an outer array, plus options and callbacks', async () => {
    const sentinelMessage = new AIMessageChunk('hi there');
    const mockGenerate = vi.fn().mockResolvedValue({
      generations: [[{ text: 'hi there', message: sentinelMessage }]],
    });
    const model = buildModel(mockGenerate);
    const options: TestCallOptions = { timeout: 5000 };

    await invokeModelGuarded(model, messages, options);

    expect(mockGenerate).toHaveBeenCalledWith([messages], options, options.callbacks);
  });

  it('rejects with EMPTY_RESPONSE when the prompt has zero choices', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ generations: [[]] });
    const model = buildModel(mockGenerate);

    await expect(invokeModelGuarded(model, messages)).rejects.toThrow(
      ERROR_MESSAGES.EMPTY_RESPONSE
    );
  });

  it('rejects with EMPTY_RESPONSE when there are no prompt entries at all', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ generations: [] });
    const model = buildModel(mockGenerate);

    await expect(invokeModelGuarded(model, messages)).rejects.toThrow(
      ERROR_MESSAGES.EMPTY_RESPONSE
    );
  });

  it('rejects with EMPTY_RESPONSE when the result omits generations entirely (malformed LLMResult)', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({});
    const model = buildModel(mockGenerate);

    await expect(invokeModelGuarded(model, messages)).rejects.toThrow(
      ERROR_MESSAGES.EMPTY_RESPONSE
    );
  });

  it('classifies the zero-choices-prompt rejection as EMPTY_RESPONSE via parseApiError', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ generations: [[]] });
    const model = buildModel(mockGenerate);

    let caught: unknown;
    try {
      await invokeModelGuarded(model, messages);
    } catch (error) {
      caught = error;
    }

    expect(parseApiError(caught).category).toBe(ApiErrorCategory.EMPTY_RESPONSE);
  });

  it('classifies the no-prompt-entries rejection as EMPTY_RESPONSE via parseApiError', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({ generations: [] });
    const model = buildModel(mockGenerate);

    let caught: unknown;
    try {
      await invokeModelGuarded(model, messages);
    } catch (error) {
      caught = error;
    }

    expect(parseApiError(caught).category).toBe(ApiErrorCategory.EMPTY_RESPONSE);
  });

  it('propagates a rejection from generate unchanged', async () => {
    const originalError = new Error('upstream failure');
    const mockGenerate = vi.fn().mockRejectedValue(originalError);
    const model = buildModel(mockGenerate);

    await expect(invokeModelGuarded(model, messages)).rejects.toBe(originalError);
  });
});
