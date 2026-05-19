/**
 * Tests for AI constants and utilities
 */

import { describe, it, expect } from 'vitest';
import { isFreeModel, GUEST_MODE, buildModelInfoUrl, isZaiCodingPlanModel } from './ai.js';

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

  it('should handle edge cases', () => {
    expect(isFreeModel('')).toBe(false);
    expect(isFreeModel(':free')).toBe(true);
    expect(isFreeModel('model:FREE')).toBe(false); // case sensitive
  });
});

describe('GUEST_MODE', () => {
  it('should have a default free model configured', () => {
    expect(GUEST_MODE.DEFAULT_MODEL).toBe('google/gemma-4-31b-it:free');
    expect(isFreeModel(GUEST_MODE.DEFAULT_MODEL)).toBe(true);
  });

  it('should have all FREE_MODELS be actually free', () => {
    for (const model of GUEST_MODE.FREE_MODELS) {
      expect(isFreeModel(model)).toBe(true);
    }
  });

  it('should have a footer message', () => {
    expect(GUEST_MODE.FOOTER_MESSAGE).toContain('free');
  });
});

describe('buildModelInfoUrl', () => {
  describe('z.ai-coding direct route', () => {
    it('should map glm-5.1 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5.1', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.1'
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

describe('isZaiCodingPlanModel', () => {
  it('should accept all four current coding-plan catalog entries', () => {
    expect(isZaiCodingPlanModel('glm-5.1')).toBe(true);
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

  it('should reject models not in the catalog', () => {
    expect(isZaiCodingPlanModel('glm-99-future')).toBe(false);
    expect(isZaiCodingPlanModel('glm-4.5-flash')).toBe(false); // hallucinated name from PR #921
    expect(isZaiCodingPlanModel('claude-sonnet-4')).toBe(false);
    expect(isZaiCodingPlanModel('')).toBe(false);
  });
});
