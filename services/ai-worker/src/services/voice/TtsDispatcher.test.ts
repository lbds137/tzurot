import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TtsProviderError,
  ApiErrorCategory,
  buildPreparedVoiceId,
  type AudioProviderId,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsCapabilities,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types';
import { dispatchTts, TtsDispatchError, type TtsProviderRegistry } from './TtsDispatcher.js';

// ===== Test fixtures ========================================================

function makeProvider(
  id: TtsProviderId,
  overrides: Partial<{
    isAvailable: boolean;
    canHandle: boolean;
    prepare: () => Promise<PreparedTts>;
    synthesize: () => Promise<Buffer>;
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
  return {
    id,
    displayName: id,
    capabilities,
    isAvailable: vi.fn(() => overrides.isAvailable ?? true),
    canHandle: vi.fn(() => overrides.canHandle ?? true),
    prepare: overrides.prepare ?? vi.fn(async () => buildPreparedVoiceId(id, `${id}-handle`)),
    synthesize: overrides.synthesize ?? vi.fn(async () => Buffer.from(`${id}-audio`)),
  };
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

  it('tries all available BYOK providers before self-hosted', async () => {
    const mistralFails = makeProvider('mistral', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'mistral', true, '429');
      }),
    });
    const elevenFails = makeProvider('elevenlabs', {
      synthesize: vi.fn(async () => {
        throw new TtsProviderError(ApiErrorCategory.RATE_LIMIT, 'elevenlabs', true, '429');
      }),
    });
    const selfHosted = makeProvider('self-hosted');

    const result = await dispatchTts({
      text: 'hi',
      resolvedConfig: mistralConfig,
      ctx: baseCtx,
      audioProviderKeys: audioKeysWithBoth,
      registry: makeRegistry([mistralFails, elevenFails, selfHosted]),
    });

    // Walk: mistral (primary, fails) → elevenlabs (fails) → self-hosted (success)
    expect(mistralFails.synthesize).toHaveBeenCalledTimes(1);
    expect(elevenFails.synthesize).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe('self-hosted');
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
