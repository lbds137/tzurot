/**
 * Tests for AI constants and utilities
 */

import { describe, it, expect } from 'vitest';
import { isFreeModel, GUEST_MODE, buildModelInfoUrl } from './ai.js';

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
    expect(GUEST_MODE.DEFAULT_MODEL).toBe('google/gemma-3-27b-it:free');
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
    it('should map glm-4.5-air to the 4.5 family blog URL', () => {
      expect(buildModelInfoUrl('glm-4.5-air', 'zai-coding')).toBe('https://z.ai/blog/glm-4.5');
    });

    it('should map glm-4.7 to the 4.7 family blog URL', () => {
      expect(buildModelInfoUrl('glm-4.7', 'zai-coding')).toBe('https://z.ai/blog/glm-4.7');
    });

    it('should map glm-5.1 to the GLM-5 family blog URL', () => {
      expect(buildModelInfoUrl('glm-5.1', 'zai-coding')).toBe('https://z.ai/blog/glm-5');
    });

    it('should map glm-5-turbo to the GLM-5 family blog URL', () => {
      expect(buildModelInfoUrl('glm-5-turbo', 'zai-coding')).toBe('https://z.ai/blog/glm-5');
    });

    it('should fall back to the coding-plan overview for unknown z.ai models', () => {
      expect(buildModelInfoUrl('glm-7.0-future', 'zai-coding')).toBe(
        'https://docs.z.ai/devpack/overview'
      );
    });
  });

  describe('OpenRouter route (default)', () => {
    it('should build a URL-encoded OpenRouter model card link', () => {
      expect(buildModelInfoUrl('anthropic/claude-sonnet-4', 'openrouter')).toBe(
        'https://openrouter.ai/anthropic%2Fclaude-sonnet-4'
      );
    });

    it('should handle z-ai/-prefixed model names (post-fallthrough)', () => {
      // When ProviderRouter fallthrough fires, the effective model becomes
      // `z-ai/<model>` and the effective provider becomes `openrouter` — so
      // the URL should point to OpenRouter's page for that namespaced model,
      // NOT to z.ai (the request didn't actually hit z.ai's endpoint).
      expect(buildModelInfoUrl('z-ai/glm-4.7', 'openrouter')).toBe(
        'https://openrouter.ai/z-ai%2Fglm-4.7'
      );
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
