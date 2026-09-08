import { describe, it, expect } from 'vitest';
import { LlmResponseError } from './LlmResponseError.js';

describe('LlmResponseError', () => {
  it('is an instanceof both Error and LlmResponseError', () => {
    const error = new LlmResponseError('boom');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LlmResponseError);
  });

  it('sets name to LlmResponseError', () => {
    const error = new LlmResponseError('boom');

    expect(error.name).toBe('LlmResponseError');
  });

  it('preserves the message', () => {
    const error = new LlmResponseError('LLM returned empty response');

    expect(error.message).toBe('LLM returned empty response');
  });

  it('carries routedModel and finishReason when the options bag supplies them', () => {
    const error = new LlmResponseError('boom', {
      routedModel: 'deepseek/deepseek-v3.2',
      finishReason: 'error',
    });

    expect(error.routedModel).toBe('deepseek/deepseek-v3.2');
    expect(error.finishReason).toBe('error');
  });

  it('leaves both fields undefined when the options bag is omitted entirely', () => {
    const error = new LlmResponseError('boom');

    expect(error.routedModel).toBeUndefined();
    expect(error.finishReason).toBeUndefined();
  });

  it('leaves both fields undefined when an empty options object is passed', () => {
    const error = new LlmResponseError('boom', {});

    expect(error.routedModel).toBeUndefined();
    expect(error.finishReason).toBeUndefined();
  });
});
