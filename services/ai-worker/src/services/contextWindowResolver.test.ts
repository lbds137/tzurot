import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoadedPersonality } from '@tzurot/common-types';
import { resolveEffectiveContextWindow } from './contextWindowResolver.js';
import { checkModelContextLength } from '../redis.js';

vi.mock('../redis.js', () => ({
  checkModelContextLength: vi.fn().mockResolvedValue(null),
}));

const personality = (overrides?: Partial<LoadedPersonality>): LoadedPersonality =>
  ({
    model: 'test/model',
    contextWindowTokens: 32768,
    ...overrides,
  }) as LoadedPersonality;

describe('resolveEffectiveContextWindow', () => {
  beforeEach(() => {
    vi.mocked(checkModelContextLength).mockResolvedValue(null);
  });

  it('clamps a configured value above the model cap', async () => {
    // The prod-incident shape: a 32k model configured at its full context length
    vi.mocked(checkModelContextLength).mockResolvedValue(32768);

    const result = await resolveEffectiveContextWindow(personality());

    expect(result).toBe(24576); // computeContextCap(32768) = 75%
  });

  it('passes through a configured value below the cap', async () => {
    vi.mocked(checkModelContextLength).mockResolvedValue(131072); // cap = 65536

    const result = await resolveEffectiveContextWindow(personality({ contextWindowTokens: 20000 }));

    expect(result).toBe(20000);
  });

  it('uses the configured value when the model limit is unknown', async () => {
    vi.mocked(checkModelContextLength).mockResolvedValue(null);

    const result = await resolveEffectiveContextWindow(personality());

    expect(result).toBe(32768);
  });

  it('looks up the personality model id', async () => {
    await resolveEffectiveContextWindow(personality({ model: 'some/model:free' }));

    // The raw ID (including :free) is passed through — suffix normalization
    // is ModelCapabilityChecker's responsibility, not the resolver's
    expect(checkModelContextLength).toHaveBeenCalledWith('some/model:free');
  });

  describe('z.ai coding-plan models', () => {
    it('clamps a z.ai-only model from the catalog even on a cache miss', async () => {
      // glm-5.2 (1M context) is NOT on OpenRouter, so checkModelContextLength
      // returns null. Without the catalog-first lookup this would resolve to
      // "unknown" and run unclamped — the exact overflow Fix C guards against.
      vi.mocked(checkModelContextLength).mockResolvedValue(null);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5.2', contextWindowTokens: 900_000 })
      );

      expect(result).toBe(500_000); // computeContextCap(1_000_000) = 50%
      // The catalog short-circuits before any Redis lookup.
      expect(checkModelContextLength).not.toHaveBeenCalled();
    });

    it('passes through a within-cap configured value for a z.ai model', async () => {
      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5', contextWindowTokens: 50_000 })
      );

      expect(result).toBe(50_000);
      expect(checkModelContextLength).not.toHaveBeenCalled();
    });

    it('falls back to the OpenRouter cache for non-catalog models', async () => {
      vi.mocked(checkModelContextLength).mockResolvedValue(200000);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'anthropic/claude-sonnet-4', contextWindowTokens: 150000 })
      );

      expect(result).toBe(100000); // 50% of 200k
      expect(checkModelContextLength).toHaveBeenCalledWith('anthropic/claude-sonnet-4');
    });
  });
});
