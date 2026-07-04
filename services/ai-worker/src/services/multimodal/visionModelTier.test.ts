import { describe, it, expect } from 'vitest';

import { visionModelTier, VISION_MODEL_TIER } from './visionModelTier.js';

describe('visionModelTier', () => {
  it('ranks free models below paid ones', () => {
    // Free: the openrouter free router + any `:free`-suffixed model.
    expect(visionModelTier('openrouter/free')).toBe(VISION_MODEL_TIER.FREE);
    expect(visionModelTier('cohere/north-mini-code:free')).toBe(VISION_MODEL_TIER.FREE);
    expect(visionModelTier('google/gemma-4-31b-it:free')).toBe(VISION_MODEL_TIER.FREE);

    // Paid: everything else.
    expect(visionModelTier('qwen/qwen3.7-plus')).toBe(VISION_MODEL_TIER.PAID);
    expect(visionModelTier('anthropic/claude-sonnet-4')).toBe(VISION_MODEL_TIER.PAID);

    // The ordering the promotion logic relies on.
    expect(visionModelTier('qwen/qwen3.7-plus')).toBeGreaterThan(
      visionModelTier('openrouter/free')
    );
  });
});
