/**
 * Tests for AI constants and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  isFreeModel,
  isFreeModelForUser,
  GUEST_MODE,
  buildModelInfoUrl,
  isZaiCodingPlanModel,
  getZaiCodingPlanContextLength,
  zaiCodingPlanModelCapabilities,
  listZaiCodingPlanModels,
  toModelSlot,
  MODEL_SLOTS,
  DEFAULT_MODEL_SLOT,
} from './ai.js';

describe('isFreeModel', () => {
  it('should return true for models ending with :free', () => {
    expect(isFreeModel('x-ai/grok-4.1-fast:free')).toBe(true);
    expect(isFreeModel('nvidia/nemotron-nano-12b-v2-vl:free')).toBe(true);
    expect(isFreeModel('tngtech/tng-r1t-chimera:free')).toBe(true);
  });

  it('should return false for paid models', () => {
    expect(isFreeModel('anthropic/claude-haiku-4.5')).toBe(false);
    expect(isFreeModel('openai/gpt-4o')).toBe(false);
    expect(isFreeModel('google/gemini-2.0-flash')).toBe(false);
  });

  it('should return false for models containing :free but not ending with it', () => {
    expect(isFreeModel('x-ai/grok-4.1-fast:free:extended')).toBe(false);
    expect(isFreeModel(':free/some-model')).toBe(false);
  });

  it('should recognize the OpenRouter free-model router (no :free suffix)', () => {
    expect(isFreeModel('openrouter/free')).toBe(true);
    // A model that merely ends in /free is NOT the router and not free.
    expect(isFreeModel('some-provider/free')).toBe(false);
    expect(isFreeModel('openrouter/auto')).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isFreeModel('')).toBe(false);
    expect(isFreeModel(':free')).toBe(true);
    expect(isFreeModel('model:FREE')).toBe(false); // case sensitive
  });
});

describe('toModelSlot', () => {
  it('narrows each known slot value through unchanged', () => {
    for (const slot of MODEL_SLOTS) {
      expect(toModelSlot(slot)).toBe(slot);
    }
  });

  it('floors an unrecognized value to the default (text) slot', () => {
    expect(toModelSlot('audio')).toBe(DEFAULT_MODEL_SLOT);
    expect(toModelSlot('')).toBe(DEFAULT_MODEL_SLOT);
    expect(toModelSlot('TEXT')).toBe(DEFAULT_MODEL_SLOT); // case-sensitive
  });
});

describe('GUEST_MODE', () => {
  it('should have a footer message', () => {
    expect(GUEST_MODE.FOOTER_MESSAGE).toContain('free');
  });
});

describe('buildModelInfoUrl', () => {
  describe('z.ai-coding direct route', () => {
    it('should map glm-5 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5', 'zai-coding')).toBe('https://docs.z.ai/guides/llm/glm-5');
    });

    it('should map glm-5.1 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5.1', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.1'
      );
    });

    it('should map glm-5.2 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5.2', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.2'
      );
    });

    it('should map glm-5-turbo to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5-turbo', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5-turbo'
      );
    });

    it('should map glm-4.7 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-4.7', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-4.7'
      );
    });

    it('should map glm-4.5-air to the parent glm-4.5 docs page (no per-Air page exists)', () => {
      // z.ai documents the Air variant on the same page as regular glm-4.5;
      // there is no dedicated /guides/llm/glm-4.5-air page (would 404).
      expect(buildModelInfoUrl('glm-4.5-air', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-4.5'
      );
    });

    it('should case-normalize the model name (user-typed preset configs)', () => {
      // The catalog keys are lowercase; user-typed configs may use any case.
      expect(buildModelInfoUrl('GLM-5.1', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.1'
      );
    });

    it('should strip the z-ai/ prefix before the catalog lookup', () => {
      // A `z-ai/`-prefixed model can reach the z.ai branch (e.g. an auto-promotion
      // fallback whose model retains the prefix). The prefix must be stripped so
      // the dedicated docs page resolves instead of the generic overview fallback.
      expect(buildModelInfoUrl('z-ai/glm-5.2', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.2'
      );
    });

    it('should fall back to the coding-plan overview for unknown z.ai models', () => {
      // Defensive: shouldn't fire for promoted routes (promotion requires
      // catalog membership), but covers stale/manual `provider: 'zai-coding'`
      // configs that reach buildModelInfoUrl with an unknown model name.
      expect(buildModelInfoUrl('glm-99-future', 'zai-coding')).toBe(
        'https://docs.z.ai/devpack/overview'
      );
    });
  });

  describe('OpenRouter route (default)', () => {
    it('should build an OpenRouter model card link with literal / between path segments', () => {
      // OpenRouter's path-based routing wants the `/` between namespace and
      // model unencoded (path hierarchy). Segment-internal special chars still
      // get escaped, but the namespace boundary stays a literal slash.
      expect(buildModelInfoUrl('anthropic/claude-sonnet-4', 'openrouter')).toBe(
        'https://openrouter.ai/anthropic/claude-sonnet-4'
      );
    });

    it('should handle z-ai/-prefixed model names (post-fallthrough)', () => {
      // When ProviderRouter fallthrough fires, the effective model becomes
      // `z-ai/<model>` and the effective provider becomes `openrouter` — so
      // the URL should point to OpenRouter's page for that namespaced model,
      // NOT to z.ai (the request didn't actually hit z.ai's endpoint).
      expect(buildModelInfoUrl('z-ai/glm-4.7', 'openrouter')).toBe(
        'https://openrouter.ai/z-ai/glm-4.7'
      );
    });

    it('should still encode segment-internal unsafe characters', () => {
      // Slashes between segments stay literal, but unsafe chars within a
      // segment (spaces, brackets, query separators) must still be escaped.
      expect(buildModelInfoUrl('vendor/model with space', 'openrouter')).toBe(
        'https://openrouter.ai/vendor/model%20with%20space'
      );
    });

    it('should escape `..` segments to defeat path traversal', () => {
      // Per 00-critical.md SSRF defense-in-depth rule — the model name
      // ultimately comes from a downstream API response, but defense-in-depth
      // requires encoding all dynamic URL segments. `encodeURIComponent('..')`
      // returns `..` unchanged (dot is URL-safe), so a literal `..` segment
      // would produce a traversal path. We escape the dots explicitly.
      const url = buildModelInfoUrl('anthropic/../evil', 'openrouter');
      expect(url).not.toContain('../');
      expect(url).toBe('https://openrouter.ai/anthropic/%2E%2E/evil');
    });

    it('should escape standalone `.` segments too', () => {
      // Same defense as `..` — a `.` segment is interpreted as "current
      // directory" in path resolution; encode it so the URL can't navigate.
      const url = buildModelInfoUrl('vendor/./model', 'openrouter');
      expect(url).toBe('https://openrouter.ai/vendor/%2E/model');
    });

    it('should fall back to OpenRouter URL when provider is undefined', () => {
      expect(buildModelInfoUrl('gpt-4', undefined)).toBe('https://openrouter.ai/gpt-4');
    });

    it('should fall back to OpenRouter URL for unknown providers', () => {
      // Defensive: keeps historical behavior if a new provider is added to
      // the enum but this helper isn't updated.
      expect(buildModelInfoUrl('some-model', 'unknown-future-provider')).toBe(
        'https://openrouter.ai/some-model'
      );
    });
  });
});

describe('isFreeModelForUser', () => {
  it('treats the piggyback model as free for GUESTS only', () => {
    expect(isFreeModelForUser('z-ai/glm-4.5-air', true)).toBe(true);
    expect(isFreeModelForUser('glm-4.5-air', true)).toBe(true);
    // Key-holders are billed on their own key — not free for them
    expect(isFreeModelForUser('z-ai/glm-4.5-air', false)).toBe(false);
  });

  it('literal free models are free for every audience', () => {
    expect(isFreeModelForUser('x-ai/grok-4.1-fast:free', true)).toBe(true);
    expect(isFreeModelForUser('x-ai/grok-4.1-fast:free', false)).toBe(true);
    expect(isFreeModelForUser('openrouter/free', false)).toBe(true);
  });

  it('paid models are never free', () => {
    expect(isFreeModelForUser('anthropic/claude-sonnet-4', true)).toBe(false);
    expect(isFreeModelForUser('anthropic/claude-sonnet-4', false)).toBe(false);
  });
});

describe('isZaiCodingPlanModel', () => {
  it('should accept all current coding-plan catalog entries', () => {
    expect(isZaiCodingPlanModel('glm-5')).toBe(true);
    expect(isZaiCodingPlanModel('glm-5.1')).toBe(true);
    expect(isZaiCodingPlanModel('glm-5.2')).toBe(true);
    expect(isZaiCodingPlanModel('glm-5-turbo')).toBe(true);
    expect(isZaiCodingPlanModel('glm-4.7')).toBe(true);
    expect(isZaiCodingPlanModel('glm-4.5-air')).toBe(true);
  });

  it('should case-normalize the input before lookup', () => {
    // User-typed preset configs may use any case; the catalog entries are
    // canonical lowercase. This is the function's whole reason to exist
    // (rather than just exporting the array).
    expect(isZaiCodingPlanModel('GLM-5.1')).toBe(true);
    expect(isZaiCodingPlanModel('Glm-4.7')).toBe(true);
    expect(isZaiCodingPlanModel('GLM-4.5-AIR')).toBe(true);
  });

  it('should accept the routable z-ai/-prefixed slug form (what validation surfaces receive)', () => {
    // The catalog keys are bare, but user-facing config values carry the
    // routable prefix — the predicate must accept both, like every other
    // catalog accessor.
    expect(isZaiCodingPlanModel('z-ai/glm-5.2')).toBe(true);
    expect(isZaiCodingPlanModel('Z-AI/GLM-5')).toBe(true);
    expect(isZaiCodingPlanModel('z-ai/not-a-real-model')).toBe(false);
  });

  it('should reject models not in the catalog', () => {
    expect(isZaiCodingPlanModel('glm-99-future')).toBe(false);
    expect(isZaiCodingPlanModel('glm-4.5-flash')).toBe(false); // hallucinated name from PR #921
    expect(isZaiCodingPlanModel('claude-sonnet-4')).toBe(false);
    expect(isZaiCodingPlanModel('')).toBe(false);
  });
});

describe('getZaiCodingPlanContextLength', () => {
  it('should return the catalog context length for bare model names', () => {
    // Values are z.ai's documented Context Length capability-card numbers.
    expect(getZaiCodingPlanContextLength('glm-5')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('glm-5.1')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('glm-5-turbo')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('glm-4.7')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('glm-4.5-air')).toBe(128_000);
  });

  it('should return 1M for glm-5.2 (z.ai-only flagship, not on OpenRouter)', () => {
    // This is the load-bearing case: glm-5.2 never appears in the OpenRouter
    // model cache, so the catalog is the ONLY context-length source for it.
    expect(getZaiCodingPlanContextLength('glm-5.2')).toBe(1_000_000);
  });

  it('should strip the z-ai/ prefix before lookup', () => {
    // Config validation and the runtime clamp pass the prefixed form; the
    // catalog keys are bare.
    expect(getZaiCodingPlanContextLength('z-ai/glm-5')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('z-ai/glm-5.2')).toBe(1_000_000);
  });

  it('should case-normalize before lookup', () => {
    expect(getZaiCodingPlanContextLength('GLM-5')).toBe(200_000);
    expect(getZaiCodingPlanContextLength('Z-AI/GLM-5.2')).toBe(1_000_000);
  });

  it('should return null for models not in the catalog', () => {
    expect(getZaiCodingPlanContextLength('glm-99-future')).toBeNull();
    expect(getZaiCodingPlanContextLength('z-ai/glm-99-future')).toBeNull();
    expect(getZaiCodingPlanContextLength('anthropic/claude-sonnet-4')).toBeNull();
    expect(getZaiCodingPlanContextLength('')).toBeNull();
  });
});

describe('listZaiCodingPlanModels', () => {
  it('returns every catalog model with its metadata', () => {
    const models = listZaiCodingPlanModels();
    const byName = new Map(models.map(m => [m.model, m]));
    // The catalog lineup per docs.z.ai/devpack/overview.
    expect([...byName.keys()].sort()).toEqual(
      ['glm-4.5-air', 'glm-4.7', 'glm-5', 'glm-5-turbo', 'glm-5.1', 'glm-5.2'].sort()
    );
    expect(byName.get('glm-5.2')?.contextLength).toBe(1_000_000);
    expect(byName.get('glm-4.5-air')?.contextLength).toBe(128_000);
  });

  it('returns bare keys (no z-ai/ prefix) and a docs URL per model', () => {
    for (const entry of listZaiCodingPlanModels()) {
      expect(entry.model.startsWith('z-ai/')).toBe(false);
      expect(entry.docsUrl).toMatch(/^https:\/\/docs\.z\.ai\//);
    }
  });

  it('is consistent with getZaiCodingPlanContextLength for each entry', () => {
    for (const entry of listZaiCodingPlanModels()) {
      expect(getZaiCodingPlanContextLength(entry.model)).toBe(entry.contextLength);
    }
  });
});

describe('zaiCodingPlanModelCapabilities', () => {
  it('returns a text-only capability shape for every current catalog model', () => {
    // All z.ai coding-plan models are text-only today, so every flag is false
    // and the vision gate fails closed for them.
    for (const entry of listZaiCodingPlanModels()) {
      const caps = zaiCodingPlanModelCapabilities(entry.model);
      expect(caps).not.toBeNull();
      expect(caps).toMatchObject({
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        contextLength: entry.contextLength,
        source: 'zai',
      });
    }
  });

  it('strips the z-ai/ prefix and case-normalizes before lookup', () => {
    expect(zaiCodingPlanModelCapabilities('z-ai/glm-5.2')?.contextLength).toBe(1_000_000);
    expect(zaiCodingPlanModelCapabilities('Z-AI/GLM-5.2')?.source).toBe('zai');
  });

  it('returns null for models not in the catalog', () => {
    expect(zaiCodingPlanModelCapabilities('glm-99-future')).toBeNull();
    expect(zaiCodingPlanModelCapabilities('anthropic/claude-sonnet-4')).toBeNull();
    expect(zaiCodingPlanModelCapabilities('')).toBeNull();
  });
});
