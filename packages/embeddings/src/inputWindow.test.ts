import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EMBEDDING_MAX_INPUT_TOKENS } from './constants.js';
import { describeInputOverflow } from './inputWindow.js';

describe('EMBEDDING_MAX_INPUT_TOKENS', () => {
  // The constant is a claim ABOUT the vendored model, so it is pinned to the
  // model's own config rather than to a literal. Swapping in a model with a
  // different window breaks this test instead of silently making every
  // overflow warn wrong — which is the failure mode that hides a truncation
  // bug rather than surfacing it.
  const modelDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'models',
    'Xenova',
    'bge-small-en-v1.5'
  );

  it('matches the vendored tokenizer_config model_max_length', () => {
    const config = JSON.parse(readFileSync(join(modelDir, 'tokenizer_config.json'), 'utf8')) as {
      model_max_length: number;
    };
    expect(EMBEDDING_MAX_INPUT_TOKENS).toBe(config.model_max_length);
  });

  it('matches the vendored model max_position_embeddings', () => {
    const config = JSON.parse(readFileSync(join(modelDir, 'config.json'), 'utf8')) as {
      max_position_embeddings: number;
    };
    expect(EMBEDDING_MAX_INPUT_TOKENS).toBe(config.max_position_embeddings);
  });
});

describe('describeInputOverflow', () => {
  it('returns undefined when the input fits', () => {
    expect(describeInputOverflow('short', 10)).toBeUndefined();
  });

  it('returns undefined exactly at the window', () => {
    // Boundary matters: the model reads all 512, so nothing was discarded.
    expect(describeInputOverflow('x'.repeat(2048), EMBEDDING_MAX_INPUT_TOKENS)).toBeUndefined();
  });

  it('reports one discarded token at one over the window', () => {
    const overflow = describeInputOverflow('x'.repeat(2052), EMBEDDING_MAX_INPUT_TOKENS + 1);
    expect(overflow?.discardedTokens).toBe(1);
  });

  it('returns undefined when the token count is unavailable', () => {
    // Counting is a diagnostic and degrades to undefined; treating unknown as
    // overflow would warn on every call the moment counting broke.
    expect(describeInputOverflow('x'.repeat(100_000), undefined)).toBeUndefined();
  });

  it('describes a real over-long query the way prod would see it', () => {
    // The measured prod case that motivated this: 8,462 chars / 2,093 tokens.
    const overflow = describeInputOverflow('x'.repeat(8462), 2093);

    expect(overflow).toEqual({
      inputTokens: 2093,
      maxInputTokens: 512,
      discardedTokens: 1581,
      discardedFraction: 0.755,
      inputChars: 8462,
      charsPerToken: 4.04,
    });
  });
});
