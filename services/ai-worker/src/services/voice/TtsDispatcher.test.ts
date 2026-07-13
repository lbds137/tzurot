import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import {
  buildPreparedVoiceId,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsCapabilities,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types/services/tts/TtsProvider';
import { TtsProviderError } from '@tzurot/common-types/services/tts/TtsProviderError';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';

// Hoisted logger spy so tests can pin the dispose-error logging contract.
// `vi.hoisted` is required because vi.mock factories run before plain const
// declarations.
const { mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

import { dispatchTts, TtsDispatchError, type TtsProviderRegistry } from './TtsDispatcher.js';
import { MistralReferenceAudioTooLongError } from './MistralTtsClient.js';

// ===== Test fixtures ========================================================

function makeProvider(
  id: TtsProviderId,
  overrides: Partial<{
    isAvailable: boolean;
    canHandle: boolean;
    prepare: () => Promise<PreparedTts>;
    synthesize: () => Promise<Buffer>;
    dispose: (handle: PreparedTts) => Promise<void>;
    capabilities: Partial<TtsCapabilities>;
  }> = {}
): TtsProvider {
  const capabilities: TtsCapabilities = {
    maxCharacters: 5000,
    requiresPrepare: true,
    supportsReferenceAudio: true,
    outputFormat: 'wav',
    ...overrides.capabilities,
  };
  const provider: TtsProvider = {
    id,
    displayName: id,
    capabilities,
    isAvailable: vi.fn(() => overrides.isAvailable ?? true),
    canHandle: vi.fn(() => overrides.canHandle ?? true),
    prepare: overrides.prepare ?? vi.fn(async () => buildPreparedVoiceId(id, `${id}-handle`)),
    synthesize: overrides.synthesize ?? vi.fn(async () => Buffer.from(`${id}-audio`)),
  };
  if (overrides.dispose !== undefined) {
    provider.dispose = vi.fn(overrides.dispose);
  }
  return provider;
}

function makeRegistry(providers: TtsProvider[]): TtsProviderRegistry {
  const byId = new Map(providers.map(p => [p.id, p]));
  return {
    getProvider: id => byId.get(id),
    listProviderIds: () => providers.map(p => p.id),
  };
}

const baseCtx: TtsContext = { slug: 'emily' };

const elevenlabsConfig: ResolvedTtsConfig = {
  provider: 'elevenlabs',
  modelId: 'eleven_v3',
  advancedParameters: {},
  source: 'user-personality',
};

const mistralConfig: ResolvedTtsConfig = {
  provider: 'mistral',
  modelId: 'voxtral-mini-tts-latest',
  advancedParameters: {},
  source: 'user-personality',
};

const selfHostedConfig: ResolvedTtsConfig = {
  provider: 'self-hosted',
  modelId: null,
  advancedParameters: {},
  source: 'free-default',
};

const audioKeysWithBoth: ReadonlyMap<AudioProviderId, string> = new Map([
  ['elevenlabs', 'sk-el'],
  ['mistral', 'sk-mi'],
]);
const audioKeysOnlyEleven: ReadonlyMap<AudioProviderId, string> = new Map([
  ['elevenlabs', 'sk-el'],
]);
const audioKeysEmpty: ReadonlyMap<AudioProviderId, string> = new Map();

beforeEach(() => {
  vi.clearAllMocks();
});

// ===== Happy path ===========================================================

describe('dispatchTts — primary provider success', () => {
  it('uses primary provider with the resolved config', async () => {
    const eleven = makeProvider('elevenlabs');
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hello',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });

    expect(result.providerUsed).toBe('elevenlabs');
    expect(result.usedFallback).toBe(false);
    expect(result.audioBuffer.toString()).toBe('elevenlabs-audio');
    expect(eleven.canHandle).toHaveBeenCalledWith(elevenlabsConfig, expect.any(Object));
    expect(selfHosted.synthesize).not.toHaveBeenCalled();
  });

  it('passes the BYOK key from audioProviderKeys into the provider ctx', async () => {
    const eleven = makeProvider('elevenlabs');
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: { slug: 'emily' }, // no byokKey on base ctx
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });

    const prepareCall = (eleven.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prepareCall.byokKey).toBe('sk-el');
    expect(prepareCall.slug).toBe('emily');
  });

  it('returns the provider capabilities outputFormat', async () => {
    const eleven = makeProvider('elevenlabs', { capabilities: { outputFormat: 'mp3' } });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });

    expect(result.outputFormat).toBe('mp3');
  });
});

// ===== Fallback chain construction ==========================================

describe('dispatchTts — chain construction', () => {
  it('skips primary if it lacks a BYOK key, falls back to self-hosted', async () => {
    const mistral = makeProvider('mistral');
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysEmpty,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
    expect(mistral.prepare).not.toHaveBeenCalled();
  });

  it('always tries self-hosted last as the safety net', async () => {
    const elevenFails = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.SERVER_ERROR, 'elevenlabs', true, '500 boom');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([elevenFails, selfHosted]),
    });

    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
  });

  it('synthetic config given to fallback names the fallback provider, not the original', async () => {
    const elevenFails = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'elevenlabs', true, '429');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([elevenFails, selfHosted]),
    });

    const selfHostedCanHandle = (selfHosted.canHandle as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // canHandle on self-hosted received a config naming itself, not 'elevenlabs'
    expect(selfHostedCanHandle.provider).toBe('self-hosted');
    expect(selfHostedCanHandle.modelId).toBe(null);
    expect(selfHostedCanHandle.source).toBe('hardcoded');
  });

  it('dedupes the chain — primary self-hosted does not retry self-hosted on failure', async () => {
    const failingSelfHosted = makeProvider('self-hosted', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.SERVER_ERROR, 'self-hosted', true, '503');
      }),
    });

    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: selfHostedConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysEmpty,
        registry: makeRegistry([failingSelfHosted]),
      })
    ).rejects.toBeInstanceOf(TtsDispatchError);

    expect(failingSelfHosted.synthesize).toHaveBeenCalledTimes(1);
  });

  it('self-hosted primary with paid keys present does NOT fall back to paid (no implicit BYOK billing)', async () => {
    // Symmetric to the paid-primary tests: a user whose primary is self-hosted
    // does not implicitly opt into ANY paid provider's billing, even if their
    // BYOK keys for Mistral/ElevenLabs are configured. With audioKeysEmpty the
    // BYOK key check would filter paid providers anyway — this test uses
    // audioKeysWithBoth so the gate is the chain-shape rule itself, not the
    // key-availability filter.
    const failingSelfHosted = makeProvider('self-hosted', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.SERVER_ERROR, 'self-hosted', true, '503');
      }),
    });
    const mistral = makeProvider('mistral');
    const elevenLabs = makeProvider('elevenlabs');

    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: selfHostedConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysWithBoth,
        registry: makeRegistry([failingSelfHosted, mistral, elevenLabs]),
      })
    ).rejects.toBeInstanceOf(TtsDispatchError);

    expect(failingSelfHosted.synthesize).toHaveBeenCalledTimes(1);
    expect(mistral.synthesize).not.toHaveBeenCalled();
    expect(elevenLabs.synthesize).not.toHaveBeenCalled();
  });

  it('paid primary failure falls through to self-hosted only (skips other paid)', async () => {
    // Paid → free only: Mistral fails, ElevenLabs MUST NOT be tried even if
    // available, self-hosted picks up. Cross-paid fallback would produce
    // unexpected billing for users who configured only Mistral.
    const mistralFails = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'mistral', true, '429');
      }),
    });
    const elevenLabs = makeProvider('elevenlabs');
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralFails, elevenLabs, selfHosted]),
    });

    expect(mistralFails.synthesize).toHaveBeenCalledTimes(1);
    expect(elevenLabs.synthesize).not.toHaveBeenCalled();
    expect(selfHosted.synthesize).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
  });

  it('paid primary failure (ElevenLabs side) also skips other paid (symmetry check)', async () => {
    // Documents the symmetric "paid → free only" rule: ElevenLabs primary
    // failure must NOT cascade through Mistral. Locks in the "vice versa"
    // claim in buildFallbackChain's docstring.
    const elevenFails = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'elevenlabs', true, '429');
      }),
    });
    const mistral = makeProvider('mistral');
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([elevenFails, mistral, selfHosted]),
    });

    expect(elevenFails.synthesize).toHaveBeenCalledTimes(1);
    expect(mistral.synthesize).not.toHaveBeenCalled();
    expect(selfHosted.synthesize).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
  });

  it('non-TtsProviderError from prepare() (e.g. MistralReferenceAudioTooLongError) falls through to self-hosted', async () => {
    // Documents the dispatcher's catch-block contract: anything that is not
    // a `TtsProviderError + !isFallbackEligible` returns `{ kind: 'failed' }`
    // and the chain continues. MistralReferenceAudioTooLongError is the
    // motivating case (deterministic input-shape rejection from pre-flight).
    const mistralRejects = makeProvider('mistral', {
      prepare: vi.fn(async () => {
        throw new MistralReferenceAudioTooLongError(31.78);
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralRejects, selfHosted]),
    });

    expect(mistralRejects.prepare).toHaveBeenCalledTimes(1);
    expect(selfHosted.synthesize).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
  });

  it('fallback ctx drops the primary provider modelId (regression: cross-provider leak)', async () => {
    // The primary's modelId is provider-specific and meaningless to fallbacks
    // (handing Mistral's "voxtral-mini-tts-2603" to ElevenLabs causes a 400).
    // The synthetic config on `attemptCandidate` already drops modelId from
    // the resolved-config side; this test locks the parallel ctx-path fix.
    const mistralFails = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'mistral', true, '429');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const ctxWithModelId: TtsContext = {
      slug: 'emily',
      modelId: 'voxtral-mini-tts-latest', // Mistral-specific
    };

    await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: ctxWithModelId,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralFails, selfHosted]),
    });

    // Mistral primary attempt SHOULD see the original modelId
    const mistralPrepareCall = (mistralFails.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mistralPrepareCall.modelId).toBe('voxtral-mini-tts-latest');

    // Self-hosted fallback attempt MUST NOT see the Mistral modelId
    const selfHostedPrepareCall = (selfHosted.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(selfHostedPrepareCall.modelId).toBeUndefined();
    const selfHostedSynthesizeCtx = (selfHosted.synthesize as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(selfHostedSynthesizeCtx.modelId).toBeUndefined();
  });

  it('throws TtsDispatchError when no providers available', async () => {
    // No registry, mistral chosen but no key
    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: mistralConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysEmpty,
        registry: makeRegistry([]),
      })
    ).rejects.toBeInstanceOf(TtsDispatchError);
  });

  it('throws TtsDispatchError with no-providers-available message when all isAvailable=false', async () => {
    // Providers ARE registered, but all return isAvailable: false (e.g.,
    // BYOK providers without keys + self-hosted with VOICE_ENGINE_URL unset).
    // This exercises the empty-chain branch via the isAvailable filter
    // rather than via an empty registry.
    const eleven = makeProvider('elevenlabs', { isAvailable: false });
    const mistral = makeProvider('mistral', { isAvailable: false });
    const selfHosted = makeProvider('self-hosted', { isAvailable: false });

    let caught: unknown;
    try {
      await dispatchTts({
        text: 'hi',
        resolvedConfig: mistralConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysWithBoth,
        registry: makeRegistry([eleven, mistral, selfHosted]),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TtsDispatchError);
    const dispatchError = caught as TtsDispatchError;
    // attempts is empty because nothing was tried — everything was filtered.
    expect(dispatchError.attempts).toHaveLength(0);
    // The early-empty-chain error includes a specific cause string,
    // distinct from the all-failed terminal throw.
    expect(dispatchError.message).toMatch(/No TTS providers available/);
    expect(dispatchError.message).toContain('emily'); // slug
    expect(dispatchError.message).toContain('mistral'); // resolved provider
    // Third-path cause string fires when registry + keys are both populated
    // but every isAvailable returns false — names the branch explicitly so
    // operators don't see a bare "no providers" message.
    expect(dispatchError.message).toMatch(
      /all registered providers rejected slug 'emily' via isAvailable/
    );
  });

  it('decorates empty-chain message with VOICE_ENGINE_URL hint when self-hosted absent from registry', async () => {
    // Registry has only BYOK providers, no self-hosted (simulates VOICE_ENGINE_URL unset).
    // No BYOK keys either → both providers filtered → empty chain.
    const eleven = makeProvider('elevenlabs');
    const mistral = makeProvider('mistral');

    let caught: unknown;
    try {
      await dispatchTts({
        text: 'hi',
        resolvedConfig: mistralConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysEmpty,
        registry: makeRegistry([eleven, mistral]),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TtsDispatchError);
    const err = caught as TtsDispatchError;
    expect(err.message).toMatch(/VOICE_ENGINE_URL not configured/);
    expect(err.message).toMatch(/no BYOK audio provider keys configured/);
  });

  it('decorates empty-chain message with only the BYOK hint when self-hosted IS registered', async () => {
    // Self-hosted IS in the registry (VOICE_ENGINE_URL set), but isAvailable
    // returns false (e.g., voice-engine probe failed). With no BYOK keys,
    // chain is empty — but the cause is BYOK-only, not voice-engine.
    const selfHosted = makeProvider('self-hosted', { isAvailable: false });

    let caught: unknown;
    try {
      await dispatchTts({
        text: 'hi',
        resolvedConfig: selfHostedConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysEmpty,
        registry: makeRegistry([selfHosted]),
      });
    } catch (error) {
      caught = error;
    }

    const err = caught as TtsDispatchError;
    expect(err.message).toMatch(/no BYOK audio provider keys configured/);
    // self-hosted IS registered, so don't claim VOICE_ENGINE_URL is missing
    expect(err.message).not.toMatch(/VOICE_ENGINE_URL not configured/);
  });
});

// ===== isFallbackEligible respect ===========================================

describe('dispatchTts — isFallbackEligible semantics', () => {
  it('propagates non-fallback-eligible errors immediately without trying next', async () => {
    const eleven = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(
          ApiErrorCategory.BAD_REQUEST,
          'elevenlabs',
          false,
          'text too long'
        );
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: elevenlabsConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysOnlyEleven,
        registry: makeRegistry([eleven, selfHosted]),
      })
    ).rejects.toMatchObject({
      name: 'TtsProviderError',
      category: ApiErrorCategory.BAD_REQUEST,
      isFallbackEligible: false,
    });

    expect(selfHosted.synthesize).not.toHaveBeenCalled();
  });

  it('falls back on isFallbackEligible: true errors', async () => {
    const eleven = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'elevenlabs', true, '429');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });
    expect(result.providerUsed).toBe('self-hosted');
  });

  it('treats plain Error (non-TtsProviderError) as fallback-eligible', async () => {
    const eleven = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new Error('network blip');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });
    expect(result.providerUsed).toBe('self-hosted');
  });

  it('threads the abort signal into every candidate ctx (the chunker check depends on it)', async () => {
    // Regression: buildCtxForProvider rebuilds the ctx per candidate and once
    // dropped `signal`, making the chunker's between-batch abort check dead
    // code in the real dispatch path. Assert the SAME signal instance reaches
    // both the BYOK branch (primary) and the non-BYOK branch (fallback).
    const controller = new AbortController();
    const eleven = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new Error('network blip');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: elevenlabsConfig,
      ctx: { ...baseCtx, signal: controller.signal },
      audioProviderKeys: audioKeysOnlyEleven,
      registry: makeRegistry([eleven, selfHosted]),
    });

    const elevenCtx = vi.mocked(eleven.synthesize).mock.calls[0]?.[2];
    const selfHostedCtx = vi.mocked(selfHosted.synthesize).mock.calls[0]?.[2];
    expect(elevenCtx?.signal).toBe(controller.signal);
    expect(selfHostedCtx?.signal).toBe(controller.signal);
  });

  it('does not fall back once the outer-budget signal aborts (post-timeout)', async () => {
    const controller = new AbortController();
    const budgetExpired = new Error('outer TTS budget expired');
    const eleven = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        // The outer budget expires while the primary synthesis is in flight;
        // the failure itself is a shape that would normally fall back.
        controller.abort(budgetExpired);
        throw new Error('network blip');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: elevenlabsConfig,
        ctx: { ...baseCtx, signal: controller.signal },
        audioProviderKeys: audioKeysOnlyEleven,
        registry: makeRegistry([eleven, selfHosted]),
      })
    ).rejects.toThrow('outer TTS budget expired');

    // No fresh synthesis may start for a result nobody will receive.
    expect(selfHosted.prepare).not.toHaveBeenCalled();
    expect(selfHosted.synthesize).not.toHaveBeenCalled();
  });
});

// ===== canHandle skip path ==================================================

describe('dispatchTts — canHandle filtering', () => {
  it('skips a provider whose canHandle returns false (no error recorded)', async () => {
    const mistral = makeProvider('mistral', { canHandle: false });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(mistral.prepare).not.toHaveBeenCalled();
    expect(result.providerUsed).toBe('self-hosted');
    // Skipped provider should NOT contribute to usedFallback's "primary failed" framing —
    // but the spec is "primary attempt didn't succeed" so usedFallback is true.
    expect(result.usedFallback).toBe(true);
  });
});

// ===== Aggregated error =====================================================

describe('TtsDispatchError', () => {
  it('aggregates all attempts into a single error when every provider fails', async () => {
    const mistralFails = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new Error('mistral down');
      }),
    });
    const selfHostedFails = makeProvider('self-hosted', {
      synthesize: vi.fn(async () => {
        throw new Error('self-hosted down');
      }),
    });

    let caught: unknown;
    try {
      await dispatchTts({
        text: 'hi',
        resolvedConfig: mistralConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysWithBoth,
        registry: makeRegistry([mistralFails, selfHostedFails]),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TtsDispatchError);
    const dispatchError = caught as TtsDispatchError;
    expect(dispatchError.attempts).toHaveLength(2);
    expect(dispatchError.attempts[0].provider).toBe('mistral');
    expect(dispatchError.attempts[1].provider).toBe('self-hosted');
    expect(dispatchError.message).toContain('mistral');
    expect(dispatchError.message).toContain('self-hosted');
  });
});

// ===== dispose() lifecycle ==================================================

describe('dispatchTts — provider.dispose() lifecycle', () => {
  it('calls dispose() with the prepared handle after successful synthesize', async () => {
    const dispose = vi.fn<(handle: PreparedTts) => Promise<void>>(async () => undefined);
    const mistral = makeProvider('mistral', { dispose });
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(dispose).toHaveBeenCalledTimes(1);
    // First arg is the handle returned by prepare()
    const disposedHandle = dispose.mock.calls[0][0];
    expect(disposedHandle).toMatchObject({ provider: 'mistral' });
  });

  it('calls dispose() even when synthesize fails (handle still cleaned up)', async () => {
    const dispose = vi.fn(async () => undefined);
    const mistralFails = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.SERVER_ERROR, 'mistral', true, '500');
      }),
      dispose,
    });
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralFails, selfHosted]),
    });

    // Mistral's dispose runs even though its synthesize threw
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call dispose() if prepare() itself threw (no handle to dispose)', async () => {
    const dispose = vi.fn(async () => undefined);
    const mistralPrepareFails = makeProvider('mistral', {
      prepare: vi.fn(async () => {
        throw new Error('prepare exploded');
      }),
      dispose,
    });
    const selfHosted = makeProvider('self-hosted');

    await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralPrepareFails, selfHosted]),
    });

    expect(dispose).not.toHaveBeenCalled();
  });

  it('dispose() errors are logged but do not mask the synthesize result', async () => {
    const dispose = vi.fn(async () => {
      throw new Error('dispose failed');
    });
    const mistral = makeProvider('mistral', { dispose });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('mistral');
    expect(result.audioBuffer.toString()).toBe('mistral-audio');
    // dispose was attempted even though it failed
    expect(dispose).toHaveBeenCalledTimes(1);
    // The dispose failure must hit the logger (not silently dropped) so
    // operators can debug a buggy dispose implementation. Pinning the
    // logging contract — a future refactor that drops the warn would
    // produce silent leak telemetry.
    const disposeWarnCall = mockLoggerWarn.mock.calls.find(call =>
      String(call[1]).includes('TtsProvider.dispose failed')
    );
    expect(disposeWarnCall).toBeDefined();
  });

  it('calls dispose() before rethrowing non-fallback-eligible TtsProviderError (rethrow path)', async () => {
    // The catch block rethrows when `isFallbackEligible: false`. JS/TS finally
    // semantics guarantee dispose() runs before the rethrow propagates, but a
    // test pins the contract — a future refactor that moves the cleanup out
    // of `finally` would silently break this guarantee.
    const dispose = vi.fn(async () => undefined);
    const mistralFatal = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(
          ApiErrorCategory.BAD_REQUEST,
          'mistral',
          false, // NOT fallback-eligible — dispatcher rethrows
          'text too long'
        );
      }),
      dispose,
    });
    const selfHosted = makeProvider('self-hosted');

    await expect(
      dispatchTts({
        text: 'hi',
        resolvedConfig: mistralConfig,
        ctx: baseCtx,
        audioProviderKeys: audioKeysWithBoth,
        registry: makeRegistry([mistralFatal, selfHosted]),
      })
    ).rejects.toBeInstanceOf(TtsProviderError);

    // dispose ran despite the rethrow propagating
    expect(dispose).toHaveBeenCalledTimes(1);
    // self-hosted was NOT tried (non-fallback-eligible aborts the chain)
    expect(selfHosted.synthesize).not.toHaveBeenCalled();
  });

  it('handles providers without dispose() (the optional method) gracefully', async () => {
    // Sanity check: providers that don't implement dispose still work — the
    // optional method must remain optional, not become a hard requirement.
    const mistral = makeProvider('mistral'); // no dispose
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('mistral');
    expect(mistral.dispose).toBeUndefined();
  });
});

describe('dispatchTts — diagnostic notices', () => {
  it('attaches a notice when MistralReferenceAudioTooLongError causes fallback', async () => {
    const mistral = makeProvider('mistral', {
      prepare: vi.fn(async () => {
        throw new MistralReferenceAudioTooLongError(45.7, 30);
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hello',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
    expect(result.notices).toEqual([
      `Voice reference for "${baseCtx.slug}" is 45.7s, exceeding Mistral's 30.0s limit. Mistral was skipped; consider re-uploading a shorter reference.`,
    ]);
  });

  it('omits notices on the happy path (no fallback)', async () => {
    const mistral = makeProvider('mistral');
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hello',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('mistral');
    expect(result.notices).toBeUndefined();
  });

  // Pin the contract that `buildAttemptNotice` only surfaces notices for
  // errors with explicit registration. A future contributor adding a new
  // error class without wiring it into the notice builder will see zero
  // notices in the success result — matching the "non-notable error" row
  // here. When a new notice class lands, add a row to `NOTICE_CASES` (with
  // expected presence) so the contract test fails until the wiring exists.
  describe('buildAttemptNotice extensibility contract', () => {
    interface NoticeCase {
      label: string;
      error: () => Error;
      expectsNotice: boolean;
    }

    const NOTICE_CASES: readonly NoticeCase[] = [
      {
        label: 'MistralReferenceAudioTooLongError → notice',
        error: () => new MistralReferenceAudioTooLongError(40.0, 30),
        expectsNotice: true,
      },
      {
        label: 'generic Error → no notice',
        error: () => new Error('boom'),
        expectsNotice: false,
      },
      {
        label: 'TypeError → no notice (not a known surfaceable class)',
        error: () => new TypeError('whatever'),
        expectsNotice: false,
      },
    ];

    NOTICE_CASES.forEach(({ label, error, expectsNotice }) => {
      it(label, async () => {
        const mistral = makeProvider('mistral', {
          prepare: vi.fn(async () => {
            throw error();
          }),
        });
        const selfHosted = makeProvider('self-hosted');

        const result = await dispatchTts({
          text: 'hello',
          resolvedConfig: mistralConfig,
          ctx: baseCtx,
          audioProviderKeys: audioKeysWithBoth,
          registry: makeRegistry([mistral, selfHosted]),
        });

        if (expectsNotice) {
          expect(result.notices).toBeDefined();
          expect(result.notices?.length).toBeGreaterThan(0);
        } else {
          expect(result.notices).toBeUndefined();
        }
      });
    });
  });

  it('omits notices when fallback is caused by a non-notable error', async () => {
    // Generic synthesize failure → fallback fires but no notice generated.
    // Bot owner doesn't need to see "Mistral generic-error fallback" because
    // (a) it's already in structured logs and (b) it's not actionable from
    // their end without more context.
    const mistral = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new Error('mistral 503');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hello',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistral, selfHosted]),
    });

    expect(result.providerUsed).toBe('self-hosted');
    expect(result.usedFallback).toBe(true);
    expect(result.notices).toBeUndefined();
  });
});
