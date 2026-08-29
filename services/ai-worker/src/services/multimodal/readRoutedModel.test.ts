import { describe, it, expect } from 'vitest';
import { readRoutedModel } from './readRoutedModel.js';

describe('readRoutedModel', () => {
  it('returns the model_name string the LangChain converter populated', () => {
    // Shape mirrors what @langchain/openai builds for a non-streaming assistant
    // response: model_name assigned from the raw payload's top-level `model`.
    const metadata = {
      model_provider: 'openai',
      model_name: 'anthropic/claude-3.5-sonnet',
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };

    expect(readRoutedModel(metadata)).toBe('anthropic/claude-3.5-sonnet');
  });

  it('returns undefined when model_name is absent', () => {
    expect(readRoutedModel({ model_provider: 'openai' })).toBeUndefined();
  });

  it('returns undefined when response_metadata itself is absent', () => {
    expect(readRoutedModel(undefined)).toBeUndefined();
  });

  it('returns undefined when model_name is present but not a string', () => {
    expect(readRoutedModel({ model_name: 42 })).toBeUndefined();
    expect(readRoutedModel({ model_name: null })).toBeUndefined();
  });
});
