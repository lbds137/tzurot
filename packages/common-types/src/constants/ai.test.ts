/**
 * Tests for AI constants and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  AIProvider,
  CHAT_CAPABLE_PROVIDERS,
  hasActiveChatCapableKey,
  isChatCapableProvider,
  isFreeModel,
  isFreeModelForUser,
  isRouterAliasModel,
  GUEST_MODE,
  buildModelInfoUrl,
  isZaiCodingPlanModel,
  stripZaiPrefix,
  toZaiWireModelId,
  getZaiCodingPlanContextLength,
  zaiCodingPlanModelCapabilities,
  zaiThinkingOffSupport,
  listZaiCodingPlanModels,
  toModelSlot,
  MODEL_SLOTS,
  DEFAULT_MODEL_SLOT,
  MODEL_SLOT_LABELS,
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

describe('MODEL_SLOT_LABELS', () => {
  it('has a non-empty label for every member of MODEL_SLOTS', () => {
    for (const slot of MODEL_SLOTS) {
      const label = MODEL_SLOT_LABELS[slot];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
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

    it('should map glm-5.3 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5.3', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5.3'
      );
    });

    it('should map glm-5-turbo to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-5-turbo', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-5-turbo'
      );
    });

    it('should map glm-5.3-flash to its vlm-section docs page', () => {
      // The page lives under guides/vlm/, not guides/llm/ — pinning the
      // section, since a family-name-derived llm/ URL would be a redirect
      // at best.
      expect(buildModelInfoUrl('glm-5.3-flash', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/vlm/glm-5.3-flash'
      );
    });

    it('should map glm-4.7 to its dedicated docs page', () => {
      expect(buildModelInfoUrl('glm-4.7', 'zai-coding')).toBe(
        'https://docs.z.ai/guides/llm/glm-4.7'
      );
    });

    it('falls back to the overview page for an id the plan no longer carries', () => {
      // glm-4.5-air was a catalog member until z.ai retired it (the id now
      // serves glm-4.7). With no entry there is no per-model page to link, so
      // the z.ai branch degrades to the devpack overview rather than emitting
      // a /guides/llm/glm-4.5-air URL that would 404.
      expect(buildModelInfoUrl('glm-4.5-air', 'zai-coding')).toBe(
        'https://docs.z.ai/devpack/overview'
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
    // Literal ids on purpose: a silent move of ZAI_FREE_TIER_MODEL must redden
    // this test rather than follow the constant into agreement with itself.
    expect(isFreeModelForUser('z-ai/glm-5.3-flash', true)).toBe(true);
    expect(isFreeModelForUser('glm-5.3-flash', true)).toBe(true);
    // Key-holders are billed on their own key — not free for them
    expect(isFreeModelForUser('z-ai/glm-5.3-flash', false)).toBe(false);
  });

  it('does NOT treat a PREVIOUSLY-held piggyback id as free for anyone', () => {
    // Each id the piggyback has held still resolves as a distinct PAID model on
    // OpenRouter with no :free variant, whatever z.ai reroutes it to upstream —
    // so honouring an old id here would hand guests a billable model.
    expect(isFreeModelForUser('z-ai/glm-4.5-air', true)).toBe(false);
    expect(isFreeModelForUser('glm-4.5-air', true)).toBe(false);
    expect(isFreeModelForUser('z-ai/glm-4.7', true)).toBe(false);
    expect(isFreeModelForUser('glm-4.7', true)).toBe(false);
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

describe('isChatCapableProvider', () => {
  it('classifies every AIProvider: LLM providers in, voice providers out', () => {
    expect(isChatCapableProvider(AIProvider.OpenRouter)).toBe(true);
    expect(isChatCapableProvider(AIProvider.ZaiCoding)).toBe(true);
    // Voice-only: ElevenLabs is synthesis/cloning/STT; a Mistral key authorizes
    // only /v1/audio/*. Neither can serve a chat generation.
    expect(isChatCapableProvider(AIProvider.ElevenLabs)).toBe(false);
    expect(isChatCapableProvider(AIProvider.Mistral)).toBe(false);
  });

  it('accepts raw provider strings (wire values) and rejects unknown ones', () => {
    expect(isChatCapableProvider('openrouter')).toBe(true);
    expect(isChatCapableProvider('zai-coding')).toBe(true);
    expect(isChatCapableProvider('elevenlabs')).toBe(false);
    expect(isChatCapableProvider('not-a-provider')).toBe(false);
    expect(isChatCapableProvider('')).toBe(false);
  });

  it('CHAT_CAPABLE_PROVIDERS holds exactly the LLM providers', () => {
    expect([...CHAT_CAPABLE_PROVIDERS].sort()).toEqual(
      [AIProvider.OpenRouter, AIProvider.ZaiCoding].sort()
    );
  });
});

describe('hasActiveChatCapableKey', () => {
  it('is true for an active OpenRouter or z.ai coding-plan key', () => {
    expect(hasActiveChatCapableKey([{ provider: AIProvider.OpenRouter, isActive: true }])).toBe(
      true
    );
    expect(hasActiveChatCapableKey([{ provider: AIProvider.ZaiCoding, isActive: true }])).toBe(
      true
    );
  });

  it('is false for a voice-only wallet (ElevenLabs / Mistral) — the guest case', () => {
    expect(hasActiveChatCapableKey([{ provider: AIProvider.ElevenLabs, isActive: true }])).toBe(
      false
    );
    expect(hasActiveChatCapableKey([{ provider: AIProvider.Mistral, isActive: true }])).toBe(false);
    expect(
      hasActiveChatCapableKey([
        { provider: AIProvider.ElevenLabs, isActive: true },
        { provider: AIProvider.Mistral, isActive: true },
      ])
    ).toBe(false);
  });

  it('requires the chat key to be ACTIVE (inactive keys buy nothing)', () => {
    expect(hasActiveChatCapableKey([{ provider: AIProvider.OpenRouter, isActive: false }])).toBe(
      false
    );
    // The conjunction, not either half: a deactivated chat key next to an
    // active voice key must still read as guest.
    expect(
      hasActiveChatCapableKey([
        { provider: AIProvider.OpenRouter, isActive: false },
        { provider: AIProvider.ElevenLabs, isActive: true },
      ])
    ).toBe(false);
  });

  it('finds the chat key among voice keys', () => {
    expect(
      hasActiveChatCapableKey([
        { provider: AIProvider.ElevenLabs, isActive: true },
        { provider: AIProvider.OpenRouter, isActive: true },
      ])
    ).toBe(true);
  });

  it('is false for an empty wallet', () => {
    expect(hasActiveChatCapableKey([])).toBe(false);
  });
});

describe('stripZaiPrefix', () => {
  it('lowercases and strips a leading z-ai/ prefix, leaving bare ids alone', () => {
    expect(stripZaiPrefix('z-ai/glm-5.3-flash')).toBe('glm-5.3-flash');
    expect(stripZaiPrefix('Z-AI/GLM-5.3-Flash')).toBe('glm-5.3-flash');
    expect(stripZaiPrefix('glm-5.3-flash')).toBe('glm-5.3-flash');
    expect(stripZaiPrefix('GLM-5.3-Flash')).toBe('glm-5.3-flash');
  });

  it('strips only from the front, and only this vendor', () => {
    // The catalog accessors and the footer's same-model check both rely on
    // this: a different vendor's id must survive intact, or an unrelated
    // model would be looked up (or rendered) as a z.ai one.
    expect(stripZaiPrefix('openai/gpt-4')).toBe('openai/gpt-4');
    expect(stripZaiPrefix('vendor/z-ai/glm-5')).toBe('vendor/z-ai/glm-5');
  });
});

describe('toZaiWireModelId', () => {
  it('strips a leading z-ai/ prefix while PRESERVING the case of the tail', () => {
    expect(toZaiWireModelId('z-ai/glm-5.3-Flash')).toBe('glm-5.3-Flash');
  });

  it('detects the prefix case-insensitively while preserving the tail case', () => {
    expect(toZaiWireModelId('Z-AI/GLM-5')).toBe('GLM-5');
  });

  it('leaves a bare id unchanged, in either case', () => {
    expect(toZaiWireModelId('glm-5')).toBe('glm-5');
    expect(toZaiWireModelId('GLM-5')).toBe('GLM-5');
  });

  it('strips only from the front, and only this vendor', () => {
    expect(toZaiWireModelId('openai/gpt-4')).toBe('openai/gpt-4');
    expect(toZaiWireModelId('vendor/z-ai/glm-5')).toBe('vendor/z-ai/glm-5');
  });

  it('differs from stripZaiPrefix on mixed-case input: case-preserving vs. lowercasing', () => {
    const mixedCase = 'Z-AI/GLM-5.3-Flash';
    expect(toZaiWireModelId(mixedCase)).toBe('GLM-5.3-Flash');
    expect(stripZaiPrefix(mixedCase)).toBe('glm-5.3-flash');
  });
});

describe('isZaiCodingPlanModel', () => {
  it('should accept all current coding-plan catalog entries', () => {
    // Iterates the catalog itself so a new entry can never silently fall out
    // of this test's coverage; meaningful (not circular) because the function
    // under test normalizes/prefix-strips rather than reading keys directly.
    const models = listZaiCodingPlanModels();
    expect(models.length).toBeGreaterThan(0);
    for (const entry of models) {
      expect(isZaiCodingPlanModel(entry.model)).toBe(true);
    }
  });

  it('should case-normalize the input before lookup', () => {
    // User-typed preset configs may use any case; the catalog entries are
    // canonical lowercase. This is the function's whole reason to exist
    // (rather than just exporting the array).
    expect(isZaiCodingPlanModel('GLM-5.1')).toBe(true);
    expect(isZaiCodingPlanModel('Glm-4.7')).toBe(true);
    expect(isZaiCodingPlanModel('GLM-5.2')).toBe(true);
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
  });

  it('reports the retired Air id as absent rather than 128K', () => {
    // Asserted, not merely deleted: every other catalog predicate is pinned
    // against this id, and leaving the membership half to an omission is the
    // one corner where "the retired id is really gone" would rest on nothing.
    // A null here is what sends the id to OpenRouter, where Air still is Air.
    expect(getZaiCodingPlanContextLength('glm-4.5-air')).toBeNull();
    expect(getZaiCodingPlanContextLength('z-ai/glm-4.5-air')).toBeNull();
    expect(isZaiCodingPlanModel('glm-4.5-air')).toBe(false);
    expect(isZaiCodingPlanModel('z-ai/glm-4.5-air')).toBe(false);
  });

  it('should return 1M for glm-5.2 (z.ai flagship; catalog is authoritative on z.ai-direct)', () => {
    // Load-bearing case: OpenRouter also lists glm-5.2, but z.ai-direct routing
    // never consults the OpenRouter cache — this catalog is its context-length
    // source, and z.ai's documented limit is what the model actually serves.
    expect(getZaiCodingPlanContextLength('glm-5.2')).toBe(1_000_000);
  });

  it('should return 1M for glm-5.3 (z.ai-only until the staggered OpenRouter listing lands)', () => {
    expect(getZaiCodingPlanContextLength('glm-5.3')).toBe(1_000_000);
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
      ['glm-4.7', 'glm-5', 'glm-5-turbo', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5.3-flash'].sort()
    );
    expect(byName.get('glm-5.2')?.contextLength).toBe(1_000_000);
    // z.ai-only entries must carry `released` — it is the only `created`
    // source for the /models recency sort until an OpenRouter listing exists.
    expect(byName.get('glm-5.3')?.released).toBe('2026-08-14');
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
  it('mirrors each entry’s modality flags, failing closed on omissions', () => {
    // An omitted flag must come back false — the vision gate fails closed
    // for every model that never declared the capability.
    for (const entry of listZaiCodingPlanModels()) {
      const caps = zaiCodingPlanModelCapabilities(entry.model);
      expect(caps).not.toBeNull();
      expect(caps).toMatchObject({
        supportsVision: entry.supportsVision ?? false,
        supportsImageGeneration: entry.supportsImageGeneration ?? false,
        supportsAudioInput: entry.supportsAudioInput ?? false,
        supportsAudioOutput: entry.supportsAudioOutput ?? false,
        contextLength: entry.contextLength,
        source: 'zai',
      });
    }
  });

  it('reports glm-5.3-flash vision-capable and its 5.3 sibling text-only', () => {
    // The mirror test above cannot fail on a wrong catalog value (it reads
    // the same entry it asserts against), so the two directions are pinned
    // explicitly: the one vision member, and a text-only sibling.
    expect(zaiCodingPlanModelCapabilities('glm-5.3-flash')?.supportsVision).toBe(true);
    expect(zaiCodingPlanModelCapabilities('glm-5.3')?.supportsVision).toBe(false);
    expect(zaiCodingPlanModelCapabilities('glm-5.3-flash')?.contextLength).toBe(1_000_000);
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

  it('reports every catalog model as reasoning-capable and maps its thinkingOff', () => {
    // The catalog is all GLM reasoning models; what differs between them is
    // only how far a request to turn thinking OFF is honored.
    for (const entry of listZaiCodingPlanModels()) {
      const caps = zaiCodingPlanModelCapabilities(entry.model);
      expect(caps?.supportsReasoning).toBe(true);
      expect(caps?.thinkingOff).toBe(entry.thinkingOff);
    }
  });
});

describe('zaiThinkingOffSupport', () => {
  it('reports the recorded support level per model', () => {
    // No current member reports 'honored' — glm-4.5-air was the only one, and
    // it left the catalog when z.ai retired the id. The level stays in the
    // union because it is a real z.ai behaviour a future model can report.
    expect(zaiThinkingOffSupport('glm-4.7')).toBe('unsupported');
    expect(zaiThinkingOffSupport('glm-5.2')).toBe('best-effort');
    expect(zaiThinkingOffSupport('glm-4.5-air')).toBeUndefined();
  });

  it('covers the whole GLM-5.x family as best-effort', () => {
    for (const model of ['glm-5', 'glm-5.1', 'glm-5.2', 'glm-5.3', 'glm-5-turbo']) {
      expect(zaiThinkingOffSupport(model)).toBe('best-effort');
    }
  });

  it('strips the z-ai/ prefix and case-normalizes before lookup', () => {
    expect(zaiThinkingOffSupport('z-ai/glm-4.7')).toBe('unsupported');
    expect(zaiThinkingOffSupport('Z-AI/GLM-4.7')).toBe('unsupported');
  });

  it('returns undefined for models outside the catalog', () => {
    // Undefined is "no data", never "thinking-off is honored" — the save-time
    // warnings must stay silent on an unknown model rather than guess.
    expect(zaiThinkingOffSupport('anthropic/claude-sonnet-4')).toBeUndefined();
    expect(zaiThinkingOffSupport('')).toBeUndefined();
  });
});

describe('isRouterAliasModel', () => {
  it('recognizes both router alias ids', () => {
    expect(isRouterAliasModel('openrouter/auto')).toBe(true);
    expect(isRouterAliasModel('openrouter/free')).toBe(true);
  });

  it('rejects a concrete model id', () => {
    expect(isRouterAliasModel('anthropic/claude-haiku-4.5')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isRouterAliasModel('')).toBe(false);
  });

  it('rejects a near-miss id that is not an exact match', () => {
    expect(isRouterAliasModel('openrouter/auto-v2')).toBe(false);
  });
});
