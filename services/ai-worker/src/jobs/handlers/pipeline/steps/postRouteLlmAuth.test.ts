import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { ResolvedRoute } from '../../../../services/ProviderRouter.js';
import type { GuestOverrideResult } from './guestModeOverrides.js';
import { buildPostRouteLlmAuth, toResolvedAuth, type ResolvedLlmAuth } from './postRouteLlmAuth.js';

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
});

describe('toResolvedAuth', () => {
  const emptyAudioKeys: ReadonlyMap<AudioProviderId, string> = new Map();
  const sttDispatch: SttDispatch = { provider: 'voice-engine' };

  it('sets fallthroughTriggered: true on ResolvedAuth when true and omits it when false or undefined', () => {
    const baseLlmAuth = {
      resolvedApiKey: 'fixture-or-user',
      resolvedProvider: AIProvider.OpenRouter,
      isGuestMode: false,
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
