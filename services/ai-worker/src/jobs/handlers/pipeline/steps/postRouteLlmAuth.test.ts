import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { authCacheKeyId } from '../../../../services/effectiveTier.js';
import type { ResolvedRoute } from '../../../../services/ProviderRouter.js';
import { SYSTEM_CACHE_KEY_ID } from '../../../../services/RateLimitCache.js';
import type { KeyState } from '../../../../services/effectiveTier.js';
import type { GuestOverrideResult } from './guestModeOverrides.js';
import {
  buildGuestFallbackLlmAuth,
  buildPostRouteLlmAuth,
  toResolvedAuth,
  type ResolvedLlmAuth,
} from './postRouteLlmAuth.js';

const BASE_PERSONALITY = {
  id: 'p-1',
  name: 'Bot',
  displayName: 'Bot',
  slug: 'bot',
  systemPrompt: 'prompt',
  model: 'z-ai/glm-4.7',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 1000,
  contextWindowTokens: 8192,
} as LoadedPersonality;

describe('buildPostRouteLlmAuth', () => {
  it('carries fallthroughTriggered on the standard post-route return', () => {
    const route = {
      effectiveProvider: AIProvider.OpenRouter,
      effectiveModel: 'z-ai/glm-4.7',
      apiKey: 'fixture-or-user',
      source: 'user',
      isGuestMode: false,
      fallthroughTriggered: true,
      wasAutoPromoted: false,
    } satisfies ResolvedRoute;

    const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY);

    expect(llmAuth.resolvedApiKey).toBe('fixture-or-user');
    expect(llmAuth.resolvedProvider).toBe(AIProvider.OpenRouter);
    expect(llmAuth.isGuestMode).toBe(false);
    expect(llmAuth.fallthroughTriggered).toBe(true);
    expect(llmAuth.wasAutoPromoted).toBe(false);
  });

  it('carries fallthroughTriggered on the guest z.ai system-key upgrade arm', () => {
    const route = {
      effectiveProvider: AIProvider.OpenRouter,
      effectiveModel: 'z-ai/glm-5.3-flash',
      apiKey: 'fixture-or-system',
      source: 'system',
      isGuestMode: true,
      fallthroughTriggered: true,
      wasAutoPromoted: false,
    } satisfies ResolvedRoute;
    const upgradedPersonality = {
      ...BASE_PERSONALITY,
      model: 'glm-5.3-flash',
      provider: AIProvider.ZaiCoding,
    };
    const guest = {
      personality: upgradedPersonality,
      zaiSystemKey: 'fixture-zai-system',
    } satisfies GuestOverrideResult;

    const llmAuth = buildPostRouteLlmAuth(route, upgradedPersonality, guest);

    expect(llmAuth.resolvedApiKey).toBe('fixture-zai-system');
    expect(llmAuth.resolvedProvider).toBe(AIProvider.ZaiCoding);
    expect(llmAuth.isGuestMode).toBe(true);
    expect(llmAuth.fallthroughTriggered).toBe(true);
  });

  it('derives system provenance, free effectiveTier, and SYSTEM_CACHE_KEY_ID for a non-guest route on the system key', () => {
    const route = {
      effectiveProvider: AIProvider.OpenRouter,
      effectiveModel: 'z-ai/glm-4.7',
      apiKey: 'fixture-or-system',
      source: 'system',
      isGuestMode: false,
      fallthroughTriggered: false,
      wasAutoPromoted: false,
    } satisfies ResolvedRoute;

    const llmAuth = buildPostRouteLlmAuth(route, BASE_PERSONALITY);

    expect(llmAuth.keyProvenance).toBe('system');
    expect(llmAuth.effectiveTier).toBe('free');
    expect(authCacheKeyId(llmAuth, llmAuth.resolvedApiKey, 'user-123')).toBe(SYSTEM_CACHE_KEY_ID);
  });

  describe('demoted non-admitted arm (keyState + demotedSystemKey)', () => {
    const USER_ROUTE = {
      effectiveProvider: AIProvider.OpenRouter,
      effectiveModel: 'anthropic/claude-sonnet-4',
      apiKey: 'fixture-or-dead-user-key',
      source: 'user',
      isGuestMode: false,
      fallthroughTriggered: false,
      wasAutoPromoted: false,
    } satisfies ResolvedRoute;
    const FREE_PERSONALITY = {
      ...BASE_PERSONALITY,
      model: 'free/ladder-default:free',
    };

    it.each(['low-credit', 'invalid'] as const)(
      'swaps a %s key to full guest semantics on the system OpenRouter key',
      (keyState: KeyState) => {
        const llmAuth = buildPostRouteLlmAuth(
          USER_ROUTE,
          FREE_PERSONALITY,
          undefined,
          keyState,
          'fixture-system-openrouter-key'
        );

        expect(llmAuth.effectiveTier).toBe('free');
        expect(llmAuth.resolvedApiKey).toBe('fixture-system-openrouter-key');
        expect(llmAuth.resolvedProvider).toBe(AIProvider.OpenRouter);
        expect(llmAuth.keyProvenance).toBe('system');
        expect(llmAuth.isGuestMode).toBe(true);
        // The demoted request must never invoke on the dead route key: its
        // doom-cache bucket is the system bucket, not the user's.
        expect(authCacheKeyId(llmAuth, llmAuth.resolvedApiKey, 'user-123')).toBe(
          SYSTEM_CACHE_KEY_ID
        );
        // The route's pre-computed passthrough is dropped — its apiKey is the
        // same dead user credential.
        expect(llmAuth.wasAutoPromoted).toBeUndefined();
        expect(llmAuth.fallback).toBeUndefined();
      }
    );

    it('carries fallthroughTriggered and the guest denial pair on the demoted arm', () => {
      const guest: GuestOverrideResult = {
        personality: FREE_PERSONALITY,
        piggybackSkipped: true,
        piggybackModel: 'z-ai/glm-5.3-flash',
      };
      const llmAuth = buildPostRouteLlmAuth(
        { ...USER_ROUTE, fallthroughTriggered: true },
        FREE_PERSONALITY,
        guest,
        'invalid',
        'fixture-system-openrouter-key'
      );

      expect(llmAuth.fallthroughTriggered).toBe(true);
      expect(llmAuth.piggybackSkipped).toBe(true);
      expect(llmAuth.piggybackModel).toBe('z-ai/glm-5.3-flash');
    });

    it('keeps the standard shape when the demoted system key is unavailable (degraded to the old behavior)', () => {
      const llmAuth = buildPostRouteLlmAuth(
        USER_ROUTE,
        BASE_PERSONALITY,
        undefined,
        'invalid',
        undefined
      );

      expect(llmAuth.effectiveTier).toBe('free');
      expect(llmAuth.resolvedApiKey).toBe('fixture-or-dead-user-key');
      expect(llmAuth.keyProvenance).toBe('user');
      expect(llmAuth.isGuestMode).toBe(false);
    });

    it.each(['low-credit', 'invalid'] as const)(
      'D10: a %s key with a NON-free model never takes the demoted arm (demoted key unused)',
      (keyState: KeyState) => {
        const llmAuth = buildPostRouteLlmAuth(
          USER_ROUTE,
          { ...BASE_PERSONALITY, model: 'anthropic/claude-sonnet-4' },
          undefined,
          keyState,
          'fixture-system-openrouter-key'
        );

        expect(llmAuth.resolvedApiKey).toBe('fixture-or-dead-user-key');
        expect(llmAuth.resolvedApiKey).not.toBe('fixture-system-openrouter-key');
        expect(llmAuth.keyProvenance).toBe('user');
        expect(llmAuth.isGuestMode).toBe(false);
        expect(llmAuth.effectiveTier).toBe('free');
      }
    );

    it('keeps the standard shape when keyState is ok or omitted', () => {
      const okState = buildPostRouteLlmAuth(
        USER_ROUTE,
        BASE_PERSONALITY,
        undefined,
        'ok',
        'fixture-system-openrouter-key'
      );
      expect(okState.effectiveTier).toBe('paid');
      expect(okState.resolvedApiKey).toBe('fixture-or-dead-user-key');
      expect(okState.keyProvenance).toBe('user');

      const noState = buildPostRouteLlmAuth(
        USER_ROUTE,
        BASE_PERSONALITY,
        undefined,
        undefined,
        'fixture-system-openrouter-key'
      );
      expect(noState.effectiveTier).toBe('paid');
      expect(noState.resolvedApiKey).toBe('fixture-or-dead-user-key');
    });
  });
});

describe('buildGuestFallbackLlmAuth', () => {
  const FALLBACK_PERSONALITY = {
    id: 'p-2',
    name: 'Bot',
    displayName: 'Bot',
    slug: 'bot-2',
    systemPrompt: 'prompt',
    model: 'free/ladder-default:free',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 1000,
    contextWindowTokens: 8192,
  } as LoadedPersonality;

  it('an admitted piggyback carries the z.ai system key with system provenance on the coding provider', () => {
    const llmAuth = buildGuestFallbackLlmAuth({
      personality: FALLBACK_PERSONALITY,
      zaiSystemKey: 'fixture-zai-system',
    });

    expect(llmAuth.resolvedApiKey).toBe('fixture-zai-system');
    expect(llmAuth.resolvedProvider).toBe(AIProvider.ZaiCoding);
    expect(llmAuth.keyProvenance).toBe('system');
    expect(llmAuth.effectiveTier).toBe('free');
    expect(llmAuth.isGuestMode).toBe(true);
    expect(llmAuth.effectivePersonality).toBe(FALLBACK_PERSONALITY);
  });

  it('a non-admitted piggyback degrades to no credential at all (keyless guest arm)', () => {
    const llmAuth = buildGuestFallbackLlmAuth({ personality: FALLBACK_PERSONALITY });

    expect(llmAuth.resolvedApiKey).toBeUndefined();
    expect(llmAuth.resolvedProvider).toBeUndefined();
    expect(llmAuth.keyProvenance).toBe('none');
    expect(llmAuth.effectiveTier).toBe('free');
    expect(llmAuth.isGuestMode).toBe(true);
  });

  it('carries the quota-fallback announce when the guest ladder substituted the model', () => {
    const announce = {
      fromModel: 'anthropic/claude-sonnet-4',
      toModel: 'free/ladder-default:free',
      category: 'guest_mode',
      mode: 'proactive',
    } as const;
    const llmAuth = buildGuestFallbackLlmAuth({
      personality: FALLBACK_PERSONALITY,
      quotaFallback: announce,
    });

    expect(llmAuth.quotaFallback).toEqual(announce);
  });
});

describe('toResolvedAuth', () => {
  const emptyAudioKeys: ReadonlyMap<AudioProviderId, string> = new Map();
  const sttDispatch: SttDispatch = { provider: 'voice-engine' };

  it('sets fallthroughTriggered: true on ResolvedAuth when true and omits it when false or undefined', () => {
    const baseLlmAuth = {
      resolvedApiKey: 'fixture-or-user',
      resolvedProvider: AIProvider.OpenRouter,
      isGuestMode: false,
      keyProvenance: 'user',
      effectiveTier: 'paid',
      effectivePersonality: BASE_PERSONALITY,
    } satisfies ResolvedLlmAuth;

    const withFallthrough = toResolvedAuth(
      { ...baseLlmAuth, fallthroughTriggered: true },
      emptyAudioKeys,
      sttDispatch
    );
    expect(withFallthrough.fallthroughTriggered).toBe(true);

    const withFalse = toResolvedAuth(
      { ...baseLlmAuth, fallthroughTriggered: false },
      emptyAudioKeys,
      sttDispatch
    );
    expect(withFalse.fallthroughTriggered).toBeUndefined();
    expect(withFalse).not.toHaveProperty('fallthroughTriggered');

    const withUndefined = toResolvedAuth(baseLlmAuth, emptyAudioKeys, sttDispatch);
    expect(withUndefined.fallthroughTriggered).toBeUndefined();
    expect(withUndefined).not.toHaveProperty('fallthroughTriggered');
  });
});
