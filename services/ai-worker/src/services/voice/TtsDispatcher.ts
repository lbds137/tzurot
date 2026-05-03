/**
 * TtsDispatcher
 *
 * Walks an ordered fallback chain of TTS providers and synthesizes audio.
 *
 * Built once per `TTSStep.process` call from:
 *   - `ResolvedTtsConfig` (from `TtsConfigResolver`) — names the **primary** provider
 *   - `TtsContext` — slug + optional `byokKey` + optional `modelId`
 *   - `audioProviderKeys` map — tells the dispatcher which BYOK providers have credentials
 *   - the provider registry — supplies the actual `TtsProvider` instances
 *
 * Walk semantics:
 *
 *   1. Build the chain: `[primary, ...remaining-available, self-hosted]`,
 *      deduped and filtered by `isAvailable(ctx)`. Self-hosted is always
 *      appended last as the safety net (assuming VOICE_ENGINE_URL is set —
 *      registry omits it otherwise).
 *
 *   2. For each candidate, call `prepare()` then `synthesize()`. The primary
 *      candidate sees the real `ResolvedTtsConfig`; fallback candidates see a
 *      synthetic "self-named" config (the resolved config's `modelId` and
 *      `advancedParameters` only apply to its own provider).
 *
 *   3. On any error:
 *      - If the error is a `TtsProviderError` with `isFallbackEligible: false`
 *        → propagate immediately. Input-shape problems (text too long, voice
 *        slug missing in gateway) won't be fixed by trying another provider.
 *      - Otherwise → record the failure, try the next candidate.
 *
 *   4. If all candidates fail, throw an aggregated error containing each
 *      candidate's failure for diagnostics.
 *
 * The dispatcher does NOT:
 *   - Apply output normalization (caller does, in TTSStep, after the buffer
 *     comes back). Keeps the dispatcher format-agnostic.
 *   - Enforce the outer 240s budget (caller does, with `Promise.race`).
 *   - Chunk long input (provider's responsibility per its capabilities).
 */

import {
  createLogger,
  TtsProviderError,
  type AudioProviderId,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types';

const logger = createLogger('TtsDispatcher');

/** Self-hosted is the always-last safety-net provider — referenced enough
 *  in this module that a constant beats the string-literal repetition. */
const SELF_HOSTED: TtsProviderId = 'self-hosted';

/** A provider id that requires a BYOK key — the dispatcher consults
 *  `audioProviderKeys` for these to gate availability. */
const BYOK_PROVIDERS: ReadonlySet<TtsProviderId> = new Set(['elevenlabs', 'mistral']);

/** Map from `TtsProviderId` to the matching `AudioProviderId` (currently
 *  identical strings, but kept explicit so a future divergence stays typed). */
const TTS_TO_AUDIO_PROVIDER: ReadonlyMap<TtsProviderId, AudioProviderId> = new Map([
  ['elevenlabs', 'elevenlabs'],
  ['mistral', 'mistral'],
]);

/**
 * The provider registry abstraction. The dispatcher never constructs providers
 * itself — `getProvider` returns a memoized instance from a module-level map
 * (see `ttsProviderRegistry.ts`, task #17). Decoupling the registry from the
 * dispatcher means tests can inject a stub registry without standing up real
 * providers.
 */
export interface TtsProviderRegistry {
  getProvider(id: TtsProviderId): TtsProvider | undefined;
  /** All registered provider ids in registration order. */
  listProviderIds(): readonly TtsProviderId[];
}

export interface DispatchOptions {
  /** The text to synthesize. Provider chunks if it exceeds capabilities.maxCharacters. */
  text: string;
  resolvedConfig: ResolvedTtsConfig;
  ctx: TtsContext;
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>;
  registry: TtsProviderRegistry;
}

export interface DispatchResult {
  audioBuffer: Buffer;
  /** Which provider actually produced the audio. Useful for cost telemetry. */
  providerUsed: TtsProviderId;
  /** Whether the primary provider was bypassed (fallback fired). */
  usedFallback: boolean;
  /** Output format from the provider's capabilities — TTSStep normalizes
   *  cross-provider differences before persisting to Redis. */
  outputFormat: 'mp3' | 'wav' | 'pcm' | 'opus';
}

/**
 * Aggregated error thrown when every provider in the chain fails. Carries
 * a structured `attempts` list so logs and tests can verify the walk shape.
 */
export class TtsDispatchError extends Error {
  constructor(
    public readonly attempts: { provider: TtsProviderId; error: unknown }[],
    message?: string
  ) {
    super(
      message ??
        `All TTS providers failed: ${attempts.map(a => `${a.provider}=${describeError(a.error)}`).join(', ')}`
    );
    this.name = 'TtsDispatchError';
    Object.setPrototypeOf(this, TtsDispatchError.prototype);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Build the ordered list of provider ids the dispatcher will attempt.
 *
 * Order:
 *   1. Primary (from resolved config) if available
 *   2. Other registered providers in registration order, available, not equal to primary
 *   3. `self-hosted` always last (deduped — if it's already in the list it stays at its earlier position)
 *
 * `isAvailable` and BYOK key presence are checked here so the walk loop is
 * a clean iteration.
 *
 * Note: if the primary provider is unavailable, the walk continues to BYOK
 * providers the user has configured, then self-hosted. A user whose primary
 * is self-hosted and whose `VOICE_ENGINE_URL` is unset will fall back to
 * BYOK providers (Mistral / ElevenLabs) if they have keys configured —
 * intentional graceful degradation, but callers should be aware that a
 * self-hosted-primary configuration can produce BYOK synthesis when the
 * voice-engine is misconfigured.
 */
function buildFallbackChain(
  resolvedConfig: ResolvedTtsConfig,
  ctx: TtsContext,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  registry: TtsProviderRegistry
): TtsProviderId[] {
  const isAvailable = (id: TtsProviderId): boolean => {
    const provider = registry.getProvider(id);
    if (provider === undefined) {
      return false;
    }
    if (BYOK_PROVIDERS.has(id)) {
      const audioId = TTS_TO_AUDIO_PROVIDER.get(id);
      if (audioId === undefined || !audioProviderKeys.has(audioId)) {
        return false;
      }
    }
    return provider.isAvailable(buildCtxForProvider(ctx, id, audioProviderKeys));
  };

  const chain: TtsProviderId[] = [];
  const seen = new Set<TtsProviderId>();

  const add = (id: TtsProviderId): void => {
    if (!seen.has(id) && isAvailable(id)) {
      chain.push(id);
      seen.add(id);
    }
  };

  add(resolvedConfig.provider);
  for (const id of registry.listProviderIds()) {
    if (id !== SELF_HOSTED) {
      add(id);
    }
  }
  add(SELF_HOSTED);

  return chain;
}

/**
 * Construct the ctx a specific provider should see — overlays the
 * provider-specific BYOK key if applicable. The caller-supplied ctx may carry
 * a `byokKey` set for the primary provider; for fallback providers we look up
 * their own key from the audioProviderKeys map (or leave it undefined).
 */
function buildCtxForProvider(
  baseCtx: TtsContext,
  providerId: TtsProviderId,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>
): TtsContext {
  if (!BYOK_PROVIDERS.has(providerId)) {
    return { slug: baseCtx.slug, modelId: baseCtx.modelId };
  }
  const audioId = TTS_TO_AUDIO_PROVIDER.get(providerId);
  const byokKey = audioId !== undefined ? audioProviderKeys.get(audioId) : undefined;
  return { slug: baseCtx.slug, modelId: baseCtx.modelId, byokKey };
}

/**
 * Synthetic config a fallback provider sees — names itself, no model
 * override, no advanced params. Source `hardcoded` distinguishes the
 * fallback path in logs.
 *
 * Fallback providers use their own defaults rather than inheriting the
 * primary's `modelId` / `advancedParameters` — a Mistral model string
 * would be meaningless to ElevenLabs or self-hosted, and provider-specific
 * advanced params (Mistral's voice_settings, ElevenLabs's stability) don't
 * cross provider boundaries either.
 */
function buildSyntheticConfigFor(providerId: TtsProviderId): ResolvedTtsConfig {
  return {
    provider: providerId,
    modelId: null,
    advancedParameters: {},
    source: 'hardcoded',
  };
}

/** Outcome of one provider attempt — keeps the main loop a clean switch. */
type AttemptOutcome =
  | { kind: 'success'; result: DispatchResult }
  | { kind: 'skip' }
  | { kind: 'failed'; error: unknown };

interface AttemptInput {
  candidateId: TtsProviderId;
  isPrimaryAttempt: boolean;
  options: DispatchOptions;
}

/**
 * Run one provider attempt. Returns the outcome; throws only on
 * non-fallback-eligible `TtsProviderError` (fatal — abort the chain).
 */
async function attemptCandidate(input: AttemptInput): Promise<AttemptOutcome> {
  const { candidateId, isPrimaryAttempt, options } = input;
  const { resolvedConfig, ctx, audioProviderKeys, registry } = options;

  const provider = registry.getProvider(candidateId);
  if (provider === undefined) {
    return { kind: 'skip' };
  }

  const candidateConfig = isPrimaryAttempt ? resolvedConfig : buildSyntheticConfigFor(candidateId);
  const candidateCtx = buildCtxForProvider(ctx, candidateId, audioProviderKeys);

  // Defensive backstop — `buildFallbackChain` already filters by `isAvailable`
  // and fallback synthetic configs name the candidate provider, so `canHandle`
  // returning false here implies an internal inconsistency (provider's own
  // canHandle disagrees with isAvailable/registration). Skip rather than
  // attempt the call.
  if (!provider.canHandle(candidateConfig, candidateCtx)) {
    logger.debug(
      { slug: ctx.slug, candidate: candidateId },
      'Provider canHandle returned false; skipping'
    );
    return { kind: 'skip' };
  }

  try {
    const handle: PreparedTts = await provider.prepare(candidateCtx);
    const audioBuffer = await provider.synthesize(options.text, handle, candidateCtx);
    const usedFallback = !isPrimaryAttempt;
    logger.info(
      {
        slug: ctx.slug,
        provider: candidateId,
        primary: resolvedConfig.provider,
        usedFallback,
        bytes: audioBuffer.length,
      },
      usedFallback ? 'TTS dispatched via fallback' : 'TTS dispatched via primary'
    );
    return {
      kind: 'success',
      result: {
        audioBuffer,
        providerUsed: candidateId,
        usedFallback,
        outputFormat: provider.capabilities.outputFormat,
      },
    };
  } catch (error) {
    if (error instanceof TtsProviderError && !error.isFallbackEligible) {
      logger.warn(
        { slug: ctx.slug, provider: candidateId, category: error.category, err: error },
        'TTS provider raised non-fallback-eligible error — aborting chain'
      );
      throw error;
    }
    logger.warn(
      { slug: ctx.slug, provider: candidateId, err: error },
      'TTS provider failed; attempting next in chain'
    );
    return { kind: 'failed', error };
  }
}

/**
 * Build the human-readable cause string for the empty-fallback-chain branch.
 *
 * Three failure modes are enumerated explicitly so production triage doesn't
 * have to guess from a bare "no providers" message:
 *   1. Self-hosted not registered (VOICE_ENGINE_URL unset)
 *   2. No BYOK audio-provider keys configured
 *   3. Both of the above are configured, but every provider's `isAvailable(ctx)`
 *      returned false for this specific slug (e.g., voice-engine probe failed)
 */
function describeEmptyChainCauses(
  ctx: TtsContext,
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
  registry: TtsProviderRegistry
): string {
  const causes: string[] = [];
  if (registry.getProvider(SELF_HOSTED) === undefined) {
    causes.push('VOICE_ENGINE_URL not configured (self-hosted unavailable)');
  }
  if (audioProviderKeys.size === 0) {
    causes.push('no BYOK audio provider keys configured');
  }
  if (causes.length === 0) {
    causes.push(`all registered providers rejected slug '${ctx.slug}' via isAvailable`);
  }
  return ` — ${causes.join('; ')}`;
}

/**
 * Walk the fallback chain and return the first successful synthesis result.
 *
 * Errors during one provider's attempt are caught and logged; the walk
 * continues to the next provider unless the error is a non-fallback-eligible
 * `TtsProviderError`, in which case it propagates immediately.
 */
export async function dispatchTts(options: DispatchOptions): Promise<DispatchResult> {
  const { resolvedConfig, ctx, audioProviderKeys, registry } = options;

  const chain = buildFallbackChain(resolvedConfig, ctx, audioProviderKeys, registry);
  if (chain.length === 0) {
    const causeDetail = describeEmptyChainCauses(ctx, audioProviderKeys, registry);
    throw new TtsDispatchError(
      [],
      `No TTS providers available for slug=${ctx.slug} (resolved=${resolvedConfig.provider})${causeDetail}`
    );
  }

  logger.debug(
    { slug: ctx.slug, primary: resolvedConfig.provider, chain },
    'TTS fallback chain built'
  );

  const attempts: { provider: TtsProviderId; error: unknown }[] = [];
  const primaryProviderId = resolvedConfig.provider;
  // Explicit flag so the "is this the primary attempt?" invariant doesn't
  // depend on `attempts.length === 0` (which silently breaks if a future
  // change records skips in `attempts` or if the chain is rebuilt to allow
  // a duplicate primary id).
  let primaryAttempted = false;

  for (const candidateId of chain) {
    const isPrimaryAttempt = !primaryAttempted && candidateId === primaryProviderId;
    if (candidateId === primaryProviderId) {
      primaryAttempted = true;
    }
    const outcome = await attemptCandidate({ candidateId, isPrimaryAttempt, options });

    if (outcome.kind === 'success') {
      return outcome.result;
    }
    if (outcome.kind === 'failed') {
      attempts.push({ provider: candidateId, error: outcome.error });
    }
    // 'skip' → just move on
  }

  throw new TtsDispatchError(attempts);
}
