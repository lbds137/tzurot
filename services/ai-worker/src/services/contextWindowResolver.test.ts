import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
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

  describe('provider-aware context source', () => {
    it('z.ai-direct: caps from the z.ai catalog without consulting OpenRouter', async () => {
      // The request was promoted onto the coding plan, so it runs on z.ai — use
      // z.ai's documented limit (glm-5.2 = 1M). No OpenRouter lookup at all.
      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5.2', contextWindowTokens: 900_000 }),
        AIProvider.ZaiCoding
      );

      expect(result).toBe(500_000); // 50% of z.ai's documented 1M
      expect(checkModelContextLength).not.toHaveBeenCalled();
    });

    it('z.ai-direct: a within-budget configured value passes through unchanged', async () => {
      // glm-5 caps at 100k (50% of z.ai's 200K); 50k is under that, so it's
      // returned as-is — the catalog path doesn't over-clamp legitimate configs.
      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5', contextWindowTokens: 50_000 }),
        AIProvider.ZaiCoding
      );

      expect(result).toBe(50_000);
      expect(checkModelContextLength).not.toHaveBeenCalled();
    });

    it('OpenRouter: caps from the OpenRouter cache, not the z.ai catalog', async () => {
      // Keyless fallthrough — glm-5.1 actually runs on OpenRouter, which lists
      // 202752, NOT z.ai's documented 200K. The cap must reflect the real
      // provider, so the OpenRouter value wins.
      vi.mocked(checkModelContextLength).mockResolvedValue(202_752);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5.1', contextWindowTokens: 150_000 }),
        AIProvider.OpenRouter
      );

      expect(result).toBe(101_376); // 50% of 202752 (OpenRouter), not 200000 (z.ai)
      expect(checkModelContextLength).toHaveBeenCalledWith('z-ai/glm-5.1');
    });

    it('OpenRouter: catalog safety-net clamps a z.ai-only model on a cache miss', async () => {
      // glm-5.2 isn't on OpenRouter — a keyless request 404s anyway, but the
      // resolver must still clamp (catalog fallback) rather than run unbounded.
      vi.mocked(checkModelContextLength).mockResolvedValue(null);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5.2', contextWindowTokens: 900_000 }),
        AIProvider.OpenRouter
      );

      expect(result).toBe(500_000); // catalog safety-net: 1M → 50%
      expect(checkModelContextLength).toHaveBeenCalledWith('z-ai/glm-5.2');
    });

    it('defaults to the OpenRouter path + catalog safety-net when provider is omitted', async () => {
      vi.mocked(checkModelContextLength).mockResolvedValue(null);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'z-ai/glm-5.2', contextWindowTokens: 900_000 })
      );

      expect(result).toBe(500_000);
      // Exactly one lookup: proves the OR path runs (vs the z.ai-direct test
      // where it doesn't) and guards against a future double-lookup.
      expect(checkModelContextLength).toHaveBeenCalledTimes(1);
    });

    it('uses the OpenRouter cache for non-catalog models', async () => {
      vi.mocked(checkModelContextLength).mockResolvedValue(200000);

      const result = await resolveEffectiveContextWindow(
        personality({ model: 'anthropic/claude-sonnet-4', contextWindowTokens: 150000 }),
        AIProvider.OpenRouter
      );

      expect(result).toBe(100000); // 50% of 200k
      expect(checkModelContextLength).toHaveBeenCalledWith('anthropic/claude-sonnet-4');
    });
  });
});
